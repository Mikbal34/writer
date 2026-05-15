/**
 * POST /api/style-profiles/[profileId]/analyze
 *
 * Extracts a WritingTwinProfile from one or more user writing samples.
 *
 * Pipeline (new, 2026-05 rewrite):
 *   1. Compute objective text statistics (avg sentence length, paragraph
 *      length, transition frequencies, deductive/inductive cue ratios)
 *      in JS — give Claude raw numbers to anchor against instead of
 *      guessing.
 *   2. Send samples + stats to Claude Sonnet with extended thinking
 *      enabled. The system prompt instructs the model to commit to a
 *      concrete value when even one sample shows a clear pattern, and
 *      to mark fields "varied"/"mixed" only as a last resort. Notes
 *      and structured fields must agree (no "deductive" in notes plus
 *      "mixed" in paragraphStructure).
 *   3. Persist the result and return it.
 *
 * Accepts either `samples: string[]` (preferred) or legacy `sampleText`.
 * Multi-sample synthesis: a trait is committed when ≥2 samples agree;
 * when only one sample is provided the single-sample logic applies.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { generateJSONExtendedWithUsage, SONNET } from '@/lib/claude'
import { checkCredits, deductCredits } from '@/lib/credits'
import type { WritingTwinProfile } from '@/types/project'
import { combineStats, computeTextStats, type TextStats } from '@/lib/text-stats'

type RouteContext = { params: Promise<{ profileId: string }> }

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

CORE RULES — read carefully, the previous version of this prompt
defaulted to "varied"/"mixed" too eagerly and produced mush:

1. COMMIT when you see a pattern. If the stats show >50% of paragraphs
   start with a topic sentence, paragraphStructure is "topic-sentence-first",
   not "mixed". If the deductive-cue-hit-pct is ≥25%, paragraphStructure
   leans "deductive". Mixed/varied are last-resort labels — only use them
   when the distribution genuinely has no centre.

2. Map sentence length from the stats, not gut feel:
     avgSentenceWords < 15  → "short"
     15-22                  → "medium"
     > 22                   → "long"
   Use "varied" ONLY when shortSentencePct AND longSentencePct are BOTH
   ≥30% (i.e. genuinely bimodal — neither short nor long dominates).

3. transitionPatterns MUST be drawn from the "Top transitions observed"
   list in the stats block. Don't invent phrases. Quote them verbatim
   exactly as the author wrote them (preserving Turkish diacritics).

4. paragraphStructure rules:
     deductiveCueHitPct ≥ 25%               → "deductive"
     inductiveCueHitPct ≥ 25%               → "inductive"
     topicSentenceFirstPct ≥ 50% (and the two above < 25%) → "topic-sentence-first"
     otherwise                              → "mixed"

5. rhetoricalApproach: pick the dominant strategy you observe in the
   prose. If the samples build arguments via cause-effect and counter-
   examples, it's "analytical". If they describe phenomena without
   strong claim-evidence chains, "descriptive". Avoid "argumentative"
   for academic Turkish unless there's explicit thesis-rebuttal back-
   and-forth.

6. CROSS-CHECK: before finalising, re-read your additionalNotes against
   the structured fields. They MUST agree. If your notes say "the author
   writes in numbered, deductive points", paragraphStructure CANNOT be
   "mixed" — fix one or the other so they match.

7. When multiple samples are provided, only commit to a structured value
   when ≥2 samples agree (or the stats consensus supports it). If the
   samples diverge, that's a legitimate "varied"/"mixed".

8. Do NOT infer tone, formality, terminology density, voice preference,
   paragraph length, block-quote habit, or first-person usage. Those
   are project-scoped knobs and gathered elsewhere.

Respond with valid JSON only. No markdown fences, no commentary.`

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
  )
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { profileId } = await ctx.params

    const profile = await prisma.userStyleProfile.findFirst({
      where: { id: profileId, userId: session.user.id },
      select: { id: true },
    })
    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const body = await req.json()

    // Backward compat: { sampleText } and forward path: { samples: string[] }.
    const samplesIn: string[] = Array.isArray(body.samples)
      ? body.samples.filter((s: unknown) => typeof s === 'string')
      : typeof body.sampleText === 'string'
        ? [body.sampleText]
        : []

    const samples = samplesIn.map((s) => s.trim()).filter((s) => s.length >= 50)
    if (samples.length === 0) {
      return NextResponse.json(
        { error: 'Lütfen en az 50 karakter uzunluğunda bir yazı örneği gönder.' },
        { status: 400 },
      )
    }
    if (samples.length > 5) {
      return NextResponse.json(
        { error: 'En fazla 5 örnek metin gönderilebilir.' },
        { status: 400 },
      )
    }

    const credits = await checkCredits(session.user.id, 'style_analyze')
    if (!credits.allowed) {
      return NextResponse.json(
        { error: 'Insufficient credits', balance: credits.balance, cost: credits.estimatedCost },
        { status: 402 },
      )
    }

    // 1. Per-sample stats + combined stats.
    const perSample = samples.map((s) => computeTextStats(s))
    const combined = combineStats(perSample)

    // 2. Build the prompt with stats + samples.
    const sampleBlocks = samples
      .map((s, i) => {
        return `--- SAMPLE ${i + 1} (${perSample[i].wordCount} words, ${perSample[i].sentenceCount} sentences) ---\n${s}\n--- END SAMPLE ${i + 1} ---`
      })
      .join('\n\n')

    const statsBlock = [
      '--- COMBINED STATS (across all samples) ---',
      fmtStats(combined),
      ...(perSample.length > 1
        ? perSample.map(
            (s, i) =>
              `--- STATS — SAMPLE ${i + 1} ---\n${fmtStats(s)}`,
          )
        : []),
    ].join('\n\n')

    const prompt = `Extract the WritingTwinProfile for this author.

${statsBlock}

${sampleBlocks}

Now produce the JSON.`

    // 3. Sonnet + extended thinking. Budget 8k thinking tokens — enough
    // for the model to walk through the stats and cross-check the
    // structured fields against its own notes before answering.
    const result = await generateJSONExtendedWithUsage<WritingTwinProfile>(
      prompt,
      STYLE_ANALYSIS_SYSTEM,
      { model: SONNET, thinkingBudgetTokens: 8000, maxTokens: 16384 },
    )

    await deductCredits(
      session.user.id,
      'style_analyze',
      result.inputTokens,
      result.outputTokens,
      'sonnet',
      { styleProfileId: profileId, sampleCount: samples.length },
    )

    await prisma.userStyleProfile.update({
      where: { id: profileId },
      data: { profile: result.data as object },
    })

    return NextResponse.json({
      styleProfile: result.data,
      // Stats are useful for the UI to show "we counted X transitions,
      // Y avg sentence length" alongside the AI's conclusion.
      stats: combined,
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/style-profiles/[profileId]/analyze]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
