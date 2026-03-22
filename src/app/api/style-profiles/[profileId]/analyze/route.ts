import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { generateJSONWithUsage, HAIKU } from '@/lib/claude'
import { checkCredits, deductCredits } from '@/lib/credits'
import type { StyleProfile } from '@/types/project'

type RouteContext = { params: Promise<{ profileId: string }> }

const STYLE_ANALYSIS_SYSTEM = `You are an expert literary analyst specialising in academic and scholarly writing styles.
Analyse the provided writing sample and return a JSON object with these fields:
{
  "sentenceLength": "short" | "medium" | "long" | "varied",
  "tone": "formal" | "semi-formal" | "conversational",
  "terminologyDensity": "low" | "medium" | "high",
  "voicePreference": "active" | "passive" | "mixed",
  "paragraphStructure": "topic-sentence-first" | "inductive" | "deductive" | "mixed",
  "transitionPatterns": ["list of common transition phrases used"],
  "formality": 1-10,
  "usesFirstPerson": true | false,
  "citationStyle": "inline-footnote" | "parenthetical" | "endnote-heavy" | "light",
  "paragraphLength": "short" | "medium" | "long",
  "usesBlockQuotes": true | false,
  "rhetoricalApproach": "argumentative" | "descriptive" | "analytical" | "comparative",
  "additionalNotes": "brief notes about the style"
}
Respond with valid JSON only. No markdown fences, no explanation.`

// POST /api/style-profiles/[profileId]/analyze
// Body: { sampleText: string }
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
    const sampleText = body.sampleText

    if (!sampleText || typeof sampleText !== 'string' || sampleText.trim().length < 50) {
      return NextResponse.json(
        { error: 'Please provide at least 50 characters of sample text.' },
        { status: 400 }
      )
    }

    const credits = await checkCredits(session.user.id, 'style_analyze')
    if (!credits.allowed) {
      return NextResponse.json(
        { error: 'Insufficient credits', balance: credits.balance, cost: credits.estimatedCost },
        { status: 402 }
      )
    }

    const prompt = `Analyse the following writing sample and return a StyleProfile JSON object:\n\n---\n${sampleText}\n---`
    const result = await generateJSONWithUsage<StyleProfile>(prompt, STYLE_ANALYSIS_SYSTEM, { model: HAIKU })

    await deductCredits(
      session.user.id,
      'style_analyze',
      result.inputTokens,
      result.outputTokens,
      'haiku',
      { styleProfileId: profileId }
    )

    // Save the profile
    await prisma.userStyleProfile.update({
      where: { id: profileId },
      data: { profile: result.data as object },
    })

    return NextResponse.json({ styleProfile: result.data })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/style-profiles/[profileId]/analyze]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
