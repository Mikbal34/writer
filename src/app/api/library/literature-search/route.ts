import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { generateJSONWithUsage, HAIKU } from '@/lib/claude'
import { checkCredits, deductCredits } from '@/lib/credits'
import { searchAcademic, type AcademicSearchResult } from '@/lib/academic-search'
import { buildResearchPrompt } from '@/lib/prompts/research'

interface LiteratureSearchFilters {
  type?: 'kitap' | 'makale' | 'tez'
  yearFrom?: number
  yearTo?: number
  requirePdf?: boolean // default true — user wants usable content
}

interface AIQuery {
  text: string
  providers?: string[]
  reasoning?: string
}

interface AIResponse {
  queries: AIQuery[]
}

interface ScoringResponse {
  scores: Array<{ id: string; score: number; reason?: string }>
}

const CACHE_TTL_DAYS = 7

function hashQuery(query: string, filters: LiteratureSearchFilters): string {
  const key = JSON.stringify({
    q: query.trim().toLowerCase(),
    t: filters.type ?? null,
    yf: filters.yearFrom ?? null,
    yt: filters.yearTo ?? null,
    pdf: filters.requirePdf ?? true,
  })
  return createHash('sha256').update(key).digest('hex')
}

/**
 * POST /api/library/literature-search
 * Body: { query: string, filters?: LiteratureSearchFilters }
 * Returns the ranked & scored top results. Results are not yet saved —
 * the UI picks what to add via /api/library/bulk-add-from-search.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()
    const userId = session.user.id
    const { query, filters = {} } = (await req.json()) as {
      query: string
      filters?: LiteratureSearchFilters
    }

    if (!query?.trim()) {
      return NextResponse.json({ error: 'query is required' }, { status: 400 })
    }

    const requirePdf = filters.requirePdf ?? true
    const effectiveFilters = { ...filters, requirePdf }
    const queryHash = hashQuery(query, effectiveFilters)

    // ── Cache lookup ────────────────────────────────────────────────
    const cached = await prisma.literatureSearchCache.findFirst({
      where: { userId, queryHash, expiresAt: { gt: new Date() } },
    })
    if (cached) {
      return NextResponse.json({
        results: cached.results,
        cached: true,
        queries: [],
      })
    }

    // ── Credit check ────────────────────────────────────────────────
    const credits = await checkCredits(userId, 'research_ai_search')
    if (!credits.allowed) {
      return NextResponse.json(
        { error: 'Insufficient credits', balance: credits.balance, cost: credits.estimatedCost },
        { status: 402 }
      )
    }

    // ── 1. AI query expansion (Haiku, ~5 credits) ────────────────────
    const { system, user } = buildResearchPrompt(query)
    const expansion = await generateJSONWithUsage<AIResponse>(user, system, { model: HAIKU })
    await deductCredits(userId, 'research_ai_search', expansion.inputTokens, expansion.outputTokens, 'haiku', {
      stage: 'query_expansion',
    })
    const queries = expansion.data.queries ?? []

    if (queries.length === 0) {
      queries.push({ text: query })
    }

    // ── 2. Parallel multi-provider search ────────────────────────────
    const searchPromises = queries.map((q) =>
      searchAcademic({
        query: q.text,
        providers: q.providers,
        type: filters.type,
        yearFrom: filters.yearFrom,
        yearTo: filters.yearTo,
        limit: 10,
      })
    )
    const settled = await Promise.allSettled(searchPromises)
    const raw: AcademicSearchResult[] = []
    for (const r of settled) {
      if (r.status === 'fulfilled') raw.push(...r.value.results)
    }

    // ── 3. Dedupe (DOI first, title+author fallback) ─────────────────
    const seen = new Set<string>()
    const deduped: AcademicSearchResult[] = []
    for (const result of raw) {
      const doiKey = result.doi?.toLowerCase()
      const titleKey = `${result.title.toLowerCase().slice(0, 60)}|${result.authorSurname.toLowerCase()}`
      if (doiKey && seen.has(doiKey)) continue
      if (seen.has(titleKey)) continue
      if (doiKey) seen.add(doiKey)
      seen.add(titleKey)
      deduped.push(result)
    }

    // ── 4. Optional PDF availability filter ──────────────────────────
    let candidates = deduped
    if (requirePdf) {
      const withPdf = deduped.filter((r) => !!r.openAccessUrl)
      // If the filter would empty the list, fall back to the full list so we
      // can still surface results (flagged as "pdf not found").
      candidates = withPdf.length > 0 ? withPdf : deduped
    }

    // Cap at 30 before scoring — Haiku cost grows with abstract volume
    candidates = candidates.slice(0, 30)

    // ── 5. Already-in-library flag ───────────────────────────────────
    if (candidates.length > 0) {
      const titles = candidates.map((r) => r.title)
      const existing = await prisma.libraryEntry.findMany({
        where: { userId, title: { in: titles } },
        select: { title: true, authorSurname: true },
      })
      const existingSet = new Set(
        existing.map((e) => `${e.title.toLowerCase()}|${e.authorSurname.toLowerCase()}`)
      )
      for (const r of candidates) {
        const key = `${r.title.toLowerCase()}|${r.authorSurname.toLowerCase()}`
        r.alreadyInLibrary = existingSet.has(key)
      }
    }

    // ── 6. Haiku abstract-based relevance scoring ────────────────────
    const scored = await scoreCandidates(userId, query, candidates)

    // ── 7. Rank: 0.6 × relevance + 0.25 × citation_norm + 0.15 × recency ──
    const maxCitation = Math.max(1, ...scored.map((r) => r.citationCount ?? 0))
    const thisYear = new Date().getFullYear()
    const ranked = scored
      .map((r) => {
        const rel = r.relevanceScore ?? 5
        const citNorm = (r.citationCount ?? 0) / maxCitation
        const yearNum = r.year ? parseInt(r.year, 10) : thisYear - 30
        const age = Math.max(0, thisYear - yearNum)
        const recency = Math.max(0, 1 - age / 30)
        const score = rel * 0.6 + citNorm * 10 * 0.25 + recency * 10 * 0.15
        return { ...r, _finalScore: score }
      })
      .sort((a, b) => b._finalScore - a._finalScore)
      .slice(0, 15)

    // ── 8. Cache the ranked results ──────────────────────────────────
    const expiresAt = new Date(Date.now() + CACHE_TTL_DAYS * 24 * 60 * 60 * 1000)
    await prisma.literatureSearchCache.upsert({
      where: { userId_queryHash: { userId, queryHash } },
      create: {
        userId,
        queryHash,
        query,
        filters: effectiveFilters as object,
        results: ranked as unknown as object,
        expiresAt,
      },
      update: {
        results: ranked as unknown as object,
        createdAt: new Date(),
        expiresAt,
      },
    })

    return NextResponse.json({
      results: ranked,
      cached: false,
      queries: queries.map((q) => ({ text: q.text, reasoning: q.reasoning })),
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library/literature-search]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** Haiku reads abstracts and scores each candidate 0-10 against the query. */
async function scoreCandidates(
  userId: string,
  query: string,
  candidates: AcademicSearchResult[]
): Promise<Array<AcademicSearchResult & { relevanceScore?: number }>> {
  if (candidates.length === 0) return []

  // Build a compact payload: id + short abstract/title
  const payload = candidates.map((r, i) => ({
    id: String(i),
    title: r.title,
    authors: r.authors.slice(0, 3).join(', '),
    year: r.year,
    abstract: (r.abstract ?? '').slice(0, 500),
  }))

  const system = `You are a research assistant. Score each candidate's relevance to the user's query on a 0-10 integer scale, where:
- 10 = highly relevant, directly addresses the query
- 7-9 = strongly relevant
- 4-6 = tangentially relevant
- 1-3 = weakly related
- 0 = not relevant

Respond with JSON only, matching this schema:
{"scores":[{"id":"0","score":9},{"id":"1","score":4}, ...]}

Do not include explanations in the output. Score every candidate.`

  const userPrompt = `Query: "${query}"

Candidates:
${JSON.stringify(payload, null, 2)}`

  try {
    const result = await generateJSONWithUsage<ScoringResponse>(userPrompt, system, { model: HAIKU })
    await deductCredits(userId, 'research_ai_search', result.inputTokens, result.outputTokens, 'haiku', {
      stage: 'scoring',
    })

    const scoreById = new Map<string, number>()
    for (const s of result.data.scores ?? []) {
      const v = typeof s.score === 'number' ? Math.max(0, Math.min(10, s.score)) : 5
      scoreById.set(s.id, v)
    }

    return candidates.map((r, i) => ({
      ...r,
      relevanceScore: scoreById.get(String(i)) ?? 5,
    }))
  } catch (err) {
    console.warn('[literature-search] scoring failed, using default scores:', err)
    return candidates.map((r) => ({ ...r, relevanceScore: 5 }))
  }
}
