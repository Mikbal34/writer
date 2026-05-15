/**
 * POST /api/style/analyze
 *
 * Lightweight Writing Twin extractor used by the new-project wizard's
 * onboarding step (StyleLearning). Unlike /api/style-profiles/[id]/analyze
 * this route does NOT persist anything — it just returns the inferred
 * WritingTwinProfile so the wizard can carry it into the create call.
 *
 * Pipeline matches the persistent analyser:
 *   1. JS-side text statistics (sentence/paragraph distributions,
 *      transition frequencies, deductive/inductive cue ratios).
 *   2. Claude Sonnet with extended thinking — commits to concrete
 *      values when patterns are visible; falls back to varied/mixed
 *      only when the distribution is genuinely flat.
 *
 * Accepts either { samples: string[] } (up to 5) or legacy
 * { text | sampleText | data.sampleText | data.sample }.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";
import { generateJSONExtendedWithUsage, generateJSONWithUsage, SONNET, HAIKU } from "@/lib/claude";
import { checkCredits, deductCredits } from "@/lib/credits";
import type { WritingTwinProfile } from "@/types/project";
import { combineStats, computeTextStats, type TextStats } from "@/lib/text-stats";

const STYLE_ANALYSIS_SYSTEM = `You are an expert literary analyst extracting a writer's *Writing Twin*.
The Twin captures only the *stable* parts of someone's voice — what
stays the same whether they write a thesis or a popular essay.

You will receive:
- One or more raw writing samples in the author's own words.
- Objective text statistics computed beforehand (sentence-length
  distributions, paragraph-length distributions, transition phrase
  frequencies, deductive/inductive cue counts, voice/person markers).
  Trust these numbers — they are factual, not interpretive.

Output JSON only, matching this shape:
{
  "sentenceLength": "short" | "medium" | "long" | "varied",
  "paragraphStructure": "topic-sentence-first" | "inductive" | "deductive" | "mixed",
  "transitionPatterns": [ ...5-12 phrases the author actually used... ],
  "rhetoricalApproach": "argumentative" | "descriptive" | "analytical" | "comparative",
  "additionalNotes": "1-2 sentences about distinctive habits not captured above"
}

CORE RULES:

1. COMMIT when you see a pattern. Mixed/varied are last-resort labels.

2. Map sentence length from the stats:
     avgSentenceWords < 15  → "short"
     15-22                  → "medium"
     > 22                   → "long"
   Use "varied" ONLY when shortSentencePct AND longSentencePct are BOTH
   ≥30%.

3. transitionPatterns MUST be drawn from the "topTransitions" list in
   the stats block. Don't invent phrases.

4. paragraphStructure rules:
     deductiveCueHitPct ≥ 25%               → "deductive"
     inductiveCueHitPct ≥ 25%               → "inductive"
     topicSentenceFirstPct ≥ 50% (others < 25%) → "topic-sentence-first"
     otherwise                              → "mixed"

5. CROSS-CHECK additionalNotes against the structured fields before
   answering — they must agree.

6. With multiple samples, commit only when ≥2 agree.

7. Do NOT infer tone, formality, terminology density, voice preference,
   paragraph length, block-quote habit, or first-person usage. Those
   are project-scoped knobs gathered elsewhere.

Respond with valid JSON only. No markdown fences, no commentary.`;

function fmtStats(s: TextStats): string {
  return JSON.stringify(
    {
      paragraphCount: s.paragraphCount,
      sentenceCount: s.sentenceCount,
      wordCount: s.wordCount,
      avgSentenceWords: s.avgSentenceWords,
      medianSentenceWords: s.medianSentenceWords,
      shortSentencePct: s.shortSentencePct,
      longSentencePct: s.longSentencePct,
      avgParagraphSentences: s.avgParagraphSentences,
      shortParagraphPct: s.shortParagraphPct,
      longParagraphPct: s.longParagraphPct,
      topicSentenceFirstPct: s.topicSentenceFirstPct,
      deductiveCueHitPct: s.deductiveCueHitPct,
      inductiveCueHitPct: s.inductiveCueHitPct,
      firstPersonHits: s.firstPersonHits,
      passiveLikeHits: s.passiveLikeHits,
      topTransitions: s.topTransitions,
    },
    null,
    2,
  );
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth();
    const body = await req.json();

    const samplesIn: string[] = Array.isArray(body.samples)
      ? body.samples.filter((s: unknown) => typeof s === "string")
      : typeof body.text === "string"
        ? [body.text]
        : typeof body.sampleText === "string"
          ? [body.sampleText]
          : typeof body.data?.sampleText === "string"
            ? [body.data.sampleText]
            : typeof body.data?.sample === "string"
              ? [body.data.sample]
              : [];

    const samples = samplesIn.map((s) => s.trim()).filter((s) => s.length >= 50);
    if (samples.length === 0) {
      return NextResponse.json(
        { error: "Lütfen en az 50 karakter uzunluğunda bir yazı örneği gönder." },
        { status: 400 },
      );
    }
    if (samples.length > 5) {
      return NextResponse.json(
        { error: "En fazla 5 örnek metin gönderilebilir." },
        { status: 400 },
      );
    }

    const credits = await checkCredits(session.user.id, "style_analyze");
    if (!credits.allowed) {
      return NextResponse.json(
        { error: "Insufficient credits", balance: credits.balance, cost: credits.estimatedCost },
        { status: 402 },
      );
    }

    const perSample = samples.map((s) => computeTextStats(s));
    const combined = combineStats(perSample);

    const sampleBlocks = samples
      .map(
        (s, i) =>
          `--- SAMPLE ${i + 1} (${perSample[i].wordCount} words, ${perSample[i].sentenceCount} sentences) ---\n${s}\n--- END SAMPLE ${i + 1} ---`,
      )
      .join("\n\n");
    const statsBlock = [
      "--- COMBINED STATS (across all samples) ---",
      fmtStats(combined),
      ...(perSample.length > 1
        ? perSample.map(
            (s, i) => `--- STATS — SAMPLE ${i + 1} ---\n${fmtStats(s)}`,
          )
        : []),
    ].join("\n\n");

    const prompt = `Extract the WritingTwinProfile for this author.

${statsBlock}

${sampleBlocks}

Now produce the JSON.`;

    // Fallback ladder: Sonnet+thinking → Sonnet → Haiku. We always want
    // to return *some* profile rather than a 500 when Anthropic is
    // briefly overloaded.
    let result: Awaited<ReturnType<typeof generateJSONExtendedWithUsage<WritingTwinProfile>>>;
    let modelUsed: 'sonnet' | 'haiku' = 'sonnet';
    try {
      result = await generateJSONExtendedWithUsage<WritingTwinProfile>(
        prompt,
        STYLE_ANALYSIS_SYSTEM,
        { model: SONNET, thinkingBudgetTokens: 8000, maxTokens: 16384 },
      );
    } catch (extendedErr) {
      console.warn('[style/analyze] Sonnet thinking failed, retrying without thinking', extendedErr);
      try {
        result = await generateJSONWithUsage<WritingTwinProfile>(
          prompt,
          STYLE_ANALYSIS_SYSTEM,
          { model: SONNET },
        );
      } catch (sonnetErr) {
        console.warn('[style/analyze] Sonnet plain failed, falling back to Haiku', sonnetErr);
        result = await generateJSONWithUsage<WritingTwinProfile>(
          prompt,
          STYLE_ANALYSIS_SYSTEM,
          { model: HAIKU },
        );
        modelUsed = 'haiku';
      }
    }

    await deductCredits(
      session.user.id,
      "style_analyze",
      result.inputTokens,
      result.outputTokens,
      modelUsed,
      { sampleCount: samples.length },
    );

    // Returns the bare profile fields so older wizard code that did
    // `const profile = await res.json()` keeps working. Stats attached
    // alongside for the UI's optional "what we measured" panel.
    return NextResponse.json({ ...result.data, stats: combined });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/style/analyze]", errMsg, err);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
