import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { generateJSONWithUsage, HAIKU } from '@/lib/claude'
import { checkCredits, deductCredits } from '@/lib/credits'

type RouteContext = { params: Promise<{ id: string }> }

const ENRICHABLE_FIELDS = [
  'authorSurname',
  'authorName',
  'title',
  'shortTitle',
  'editor',
  'translator',
  'publisher',
  'publishPlace',
  'year',
  'volume',
  'edition',
  'journalName',
  'journalVolume',
  'journalIssue',
  'pageRange',
  'doi',
  'url',
] as const

type EnrichableField = (typeof ENRICHABLE_FIELDS)[number]

interface EnrichResult {
  suggestions: Partial<Record<EnrichableField, string>>
}

// POST /api/bibliography/[id]/enrich
export async function POST(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const entry = await prisma.bibliography.findFirst({
      where: { id, project: { userId: session.user.id } },
    })

    if (!entry) {
      return NextResponse.json(
        { error: 'Bibliography entry not found' },
        { status: 404 }
      )
    }

    // Collect current field values
    const currentFields: Record<string, string | null> = {}
    for (const field of ENRICHABLE_FIELDS) {
      currentFields[field] = (entry as Record<string, unknown>)[field] as string | null
    }

    // If there's a linked source, grab chunk text for context
    let sourceText = ''
    if (entry.sourceId) {
      const chunks = await prisma.sourceChunk.findMany({
        where: { sourceId: entry.sourceId },
        orderBy: { chunkIndex: 'asc' },
        select: { content: true },
      })
      const joined = chunks.map((c: { content: string }) => c.content).join('\n')
      sourceText = joined.slice(0, 8000)
    }

    // Identify which fields are empty
    const emptyFields = ENRICHABLE_FIELDS.filter(
      (f) => !currentFields[f] || currentFields[f]!.trim() === ''
    )

    if (emptyFields.length === 0) {
      return NextResponse.json({ suggestions: {} })
    }

    // Build prompt
    const filledEntries = Object.entries(currentFields)
      .filter(([, v]) => v && v.trim() !== '')
      .map(([k, v]) => `  ${k}: "${v}"`)
      .join('\n')

    const prompt = [
      `You need to fill in the missing fields of a bibliography record.`,
      ``,
      `Entry type (entryType): ${entry.entryType}`,
      ``,
      `Currently filled fields:`,
      filledEntries || '  (no fields are filled)',
      ``,
      `Empty fields to fill: ${emptyFields.join(', ')}`,
      ``,
      sourceText
        ? `Text extracted from PDF (content of this source):\n---\n${sourceText}\n---`
        : `No PDF is linked to this record. Use the available information (author, title, etc.) to fill the missing fields.`,
      ``,
      `Rules:`,
      `- Only suggest values for the empty fields listed above.`,
      `- Do not include already-filled fields.`,
      `- Do not include fields you are not confident about (leave as null / do not add to JSON).`,
      `- Return only a JSON object: { "suggestions": { "field": "value", ... } }`,
      `- Values must be strings.`,
    ].join('\n')

    // Credit check
    const credits = await checkCredits(session.user.id, 'bibliography_enrich')
    if (!credits.allowed) {
      return NextResponse.json(
        { error: 'Insufficient credits', balance: credits.balance, cost: credits.estimatedCost },
        { status: 402 }
      )
    }

    const aiResult = await generateJSONWithUsage<EnrichResult>(
      prompt,
      'You are a bibliography expert. You specialize in completing bibliographic records for academic sources. You are familiar with Turkish, Arabic, and multilingual sources.',
      { model: HAIKU }
    )

    await deductCredits(
      session.user.id,
      'bibliography_enrich',
      aiResult.inputTokens,
      aiResult.outputTokens,
      { bibliographyId: id }
    )

    const result = aiResult.data

    // Safety: only return suggestions for fields that were actually empty
    const filtered: Partial<Record<EnrichableField, string>> = {}
    if (result.suggestions) {
      for (const field of emptyFields) {
        const val = result.suggestions[field]
        if (val && typeof val === 'string' && val.trim() !== '') {
          filtered[field] = val.trim()
        }
      }
    }

    return NextResponse.json({ suggestions: filtered })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/bibliography/[id]/enrich]', err)
    return NextResponse.json(
      { error: 'Failed to enrich bibliography entry' },
      { status: 500 }
    )
  }
}
