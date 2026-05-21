/**
 * POST /api/style/eval — internal writing-twin evaluation.
 *
 * Measures how well the current twin reproduces an author's voice:
 * generate a passage using ONLY the abstract profile (the way the
 * live writing pipeline applies voice today — no few-shot), then
 * compare its deterministic style features against the author's
 * real StyleSample text. Returns a 0-100 match score + per-feature
 * breakdown + an optional LLM voice-match judge.
 *
 * Baseline now; when few-shot exemplar injection lands we re-run
 * and compare match scores. Admin-secret guarded, not user-facing.
 *
 * Body: { profileId?, topic?, fewShot?: boolean }
 *   - profileId: defaults to the profile with the most samples
 *   - fewShot: if true, also inject the author's samples as
 *     exemplars (lets us A/B baseline vs few-shot in one place)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateJSONWithUsage, SONNET, HAIKU } from "@/lib/claude";
import { computeStyleFeatures, compareStyle } from "@/lib/style-features";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NEUTRAL_TOPIC =
  "the tension between preserving tradition and adapting to change";

interface ProfileRow {
  id: string;
  name: string;
  profile: Record<string, unknown> | null;
}
interface SampleRow {
  content: string;
  wordCount: number;
}

function buildVoiceInstruction(profile: Record<string, unknown> | null): string {
  if (!profile) return "(no profile fields available)";
  const lines: string[] = [];
  const p = profile;
  if (p.tone) lines.push(`- Tone: ${p.tone}`);
  if (typeof p.formality === "number") lines.push(`- Formality: ${p.formality}/10`);
  if (p.sentenceLength) lines.push(`- Sentence length: ${p.sentenceLength}`);
  if (p.paragraphStructure) lines.push(`- Paragraph structure: ${p.paragraphStructure}`);
  if (p.rhetoricalApproach) lines.push(`- Rhetorical approach: ${p.rhetoricalApproach}`);
  if (Array.isArray(p.transitionPatterns) && p.transitionPatterns.length > 0)
    lines.push(`- Transition phrases: ${(p.transitionPatterns as string[]).join(", ")}`);
  if (p.additionalNotes) lines.push(`- Notes: ${p.additionalNotes}`);
  return lines.length > 0 ? lines.join("\n") : "(no profile fields available)";
}

export async function POST(req: NextRequest) {
  const adminSecret = process.env.ADMIN_SESSION_SECRET;
  const secret = req.headers.get("x-admin-secret");
  if (!adminSecret || secret !== adminSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    profileId?: string;
    topic?: string;
    fewShot?: boolean;
  };
  const topic = body.topic ?? NEUTRAL_TOPIC;

  // Resolve a profile that actually has samples (default: the most).
  let profile: ProfileRow | undefined;
  if (body.profileId) {
    const [row] = await prisma.$queryRawUnsafe<ProfileRow[]>(
      `SELECT id, name, profile FROM "UserStyleProfile" WHERE id = $1`,
      body.profileId,
    );
    profile = row;
  } else {
    const [row] = await prisma.$queryRawUnsafe<ProfileRow[]>(`
      SELECT pr.id, pr.name, pr.profile
      FROM "UserStyleProfile" pr
      JOIN "StyleSample" s ON s."profileId" = pr.id
      GROUP BY pr.id, pr.name, pr.profile
      ORDER BY COUNT(s.id) DESC
      LIMIT 1
    `);
    profile = row;
  }
  if (!profile) {
    return NextResponse.json(
      { error: "no style profile with samples found" },
      { status: 404 },
    );
  }

  const samples = await prisma.$queryRawUnsafe<SampleRow[]>(
    `SELECT content, "wordCount" FROM "StyleSample" WHERE "profileId" = $1 ORDER BY "wordCount" DESC`,
    profile.id,
  );
  if (samples.length === 0) {
    return NextResponse.json(
      { error: `profile "${profile.name}" has no samples to compare against` },
      { status: 400 },
    );
  }

  const referenceText = samples.map((s) => s.content).join("\n\n");
  const referenceFeatures = computeStyleFeatures(referenceText);

  // Voice instruction = the abstract profile (current pipeline). In
  // few-shot mode we additionally show the real samples as exemplars.
  const voiceBlock = buildVoiceInstruction(profile.profile);
  const exemplarBlock = body.fewShot
    ? `\n\nHere are real passages by this author — MATCH this voice (rhythm, sentence shape, register, punctuation habits):\n\n"""\n${samples
        .map((s) => s.content.slice(0, 900))
        .join('\n\n"""\n\n"""\n')}\n"""`
    : "";

  const systemPrompt =
    "You are a ghostwriter reproducing a specific author's writing voice. " +
    "Write in the SAME language as the author's samples. Produce ONE " +
    "cohesive academic passage of ~250 words on the given topic, in the " +
    "author's voice. No headings, no lists, no citations — just prose.\n\n" +
    `AUTHOR VOICE PROFILE:\n${voiceBlock}${exemplarBlock}\n\n` +
    'Output ONLY JSON: { "passage": "..." }';

  const gen = await generateJSONWithUsage<{ passage?: string }>(
    `Topic: ${topic}\n\nWrite the ~250-word passage now, in the author's language and voice.`,
    systemPrompt,
    { model: SONNET },
  );
  const generated = (gen.data?.passage ?? "").trim();
  if (!generated) {
    return NextResponse.json({ error: "generation failed" }, { status: 502 });
  }

  const generatedFeatures = computeStyleFeatures(generated);
  const comparison = compareStyle(referenceFeatures, generatedFeatures);

  // LLM voice-match judge (noisy, complementary to the deterministic score).
  let judge: Record<string, unknown> | null = null;
  try {
    const judgeRes = await generateJSONWithUsage<Record<string, unknown>>(
      `AUTHOR'S REAL WRITING:\n"""${samples[0].content.slice(0, 1200)}"""\n\n` +
        `CANDIDATE PASSAGE (possibly by the same author, possibly not):\n"""${generated}"""\n\n` +
        `Did the same author write the candidate? Judge ONLY voice/style ` +
        `(rhythm, sentence shape, register, diction, punctuation habits), NOT topic.`,
      'You are a forensic stylometry expert. Output ONLY JSON: ' +
        '{ "voiceMatch": n (0-10), "reason": "one sentence on what matches or differs" }',
      { model: HAIKU },
    );
    judge = judgeRes.data ?? null;
  } catch {
    judge = null;
  }

  return NextResponse.json({
    profile: { id: profile.id, name: profile.name },
    mode: body.fewShot ? "few-shot" : "baseline (abstract profile)",
    topic,
    sampleCount: samples.length,
    referenceWords: referenceFeatures.totalWords,
    matchScore: comparison.matchScore,
    judge,
    perFeature: comparison.perFeature,
    generatedPreview: generated.slice(0, 300),
  });
}
