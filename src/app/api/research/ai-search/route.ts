import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { generateJSONWithUsage, HAIKU } from '@/lib/claude'
import { checkCredits, deductCredits } from '@/lib/credits'
import { searchAcademic, type AcademicSearchResult } from '@/lib/academic-search'
import { buildResearchPrompt } from '@/lib/prompts/research'

interface AISearchQuery {
  text: string
  providers?: string[]
  reasoning?: string
}

interface AISearchResponse {
  queries: AISearchQuery[]
  suggestedTypes?: string[]
}

/**
 * POST /api/research/ai-search
 * AI-assisted search: generates optimized queries from natural language, then searches.
 * Body: { description: string, projectId?: string }
 * Costs credits (~5, uses Haiku).
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()
    const userId = session.user.id
    const { description, projectId } = (await req.json()) as {
      description: string
      projectId?: string
    }

    if (!description?.trim()) {
      return NextResponse.json({ error: 'description is required' }, { status: 400 })
    }

    // Credit check
    const credits = await checkCredits(userId, 'research_ai_search')
    if (!credits.allowed) {
      return NextResponse.json(
        { error: 'Insufficient credits', balance: credits.balance, cost: credits.estimatedCost },
        { status: 402 }
      )
    }

    // Build project context if projectId provided
    let projectContext: { topic?: string; existingBibliography?: string[] } | undefined

    if (projectId) {
      const project = await prisma.project.findFirst({
        where: { id: projectId, userId },
        select: { title: true, description: true },
      })

      if (project) {
        const existingBibs = await prisma.bibliography.findMany({
          where: { projectId },
          select: { authorSurname: true, title: true },
          take: 30,
        })

        projectContext = {
          topic: `${project.title}${project.description ? ` — ${project.description}` : ''}`,
          existingBibliography: existingBibs.map((b) => `${b.authorSurname}, ${b.title}`),
        }
      }
    }

    // Generate search queries with AI
    const { system, user } = buildResearchPrompt(description, projectContext)

    const aiResult = await generateJSONWithUsage<AISearchResponse>(user, system, { model: HAIKU })

    // Deduct credits
    await deductCredits(
      userId,
      'research_ai_search',
      aiResult.inputTokens,
      aiResult.outputTokens,
      'haiku',
      { projectId }
    )

    const queries = aiResult.data.queries || []

    // Run all generated queries in parallel
    const allResults: AcademicSearchResult[] = []
    const searchPromises = queries.map((q) =>
      searchAcademic({
        query: q.text,
        providers: q.providers,
        limit: 5,
      })
    )

    const settled = await Promise.allSettled(searchPromises)
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        allResults.push(...r.value.results)
      }
    }

    // Deduplicate across all query results
    const seen = new Map<string, boolean>()
    const deduplicated: AcademicSearchResult[] = []

    for (const result of allResults) {
      const doiKey = result.doi?.toLowerCase()
      const titleKey = `${result.title.toLowerCase().slice(0, 60)}|${result.authorSurname.toLowerCase()}`

      if (doiKey && seen.has(doiKey)) continue
      if (seen.has(titleKey)) continue

      if (doiKey) seen.set(doiKey, true)
      seen.set(titleKey, true)
      deduplicated.push(result)
    }

    // Mark already-in-library
    if (deduplicated.length > 0) {
      const titles = deduplicated.map((r) => r.title)
      const existingEntries = await prisma.libraryEntry.findMany({
        where: { userId, title: { in: titles } },
        select: { title: true, authorSurname: true },
      })

      const existingSet = new Set(
        existingEntries.map((e) => `${e.title.toLowerCase()}|${e.authorSurname.toLowerCase()}`)
      )

      for (const result of deduplicated) {
        const key = `${result.title.toLowerCase()}|${result.authorSurname.toLowerCase()}`
        result.alreadyInLibrary = existingSet.has(key)
      }
    }

    return NextResponse.json({
      queries: queries.map((q) => ({ text: q.text, reasoning: q.reasoning })),
      results: deduplicated,
      suggestedTypes: aiResult.data.suggestedTypes,
      creditsUsed: true,
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/research/ai-search]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
