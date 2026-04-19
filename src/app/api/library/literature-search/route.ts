import { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { generateJSONWithUsage, HAIKU } from '@/lib/claude'
import { checkCredits, deductCredits } from '@/lib/credits'
import {
  searchAcademic,
  type AcademicSearchResult,
  type SearchParams as AcademicSearchParams,
} from '@/lib/academic-search'
import { buildResearchPrompt } from '@/lib/prompts/research'

interface LiteratureSearchFilters {
  type?: 'kitap' | 'makale' | 'tez'
  yearFrom?: number
  yearTo?: number
  requirePdf?: boolean
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
const TOP_N_RESULTS = 25
const PER_PROVIDER_LIMIT = 12
const SCORING_CAP = 40

const ALL_PROVIDERS = [
  'openalex',
  'semantic_scholar',
  'crossref',
  'google_books',
  'arxiv',
  'pmc',
  'doaj',
  'biorxiv',
] as const

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
 *
 * Body: { query, filters? }
 * Returns an SSE stream that emits:
 *   - {type:'cached', results}            → cache hit, done
 *   - {type:'expanding'}                  → Haiku query expansion started
 *   - {type:'queries', queries:[...]}     → expanded queries ready
 *   - {type:'provider_start', provider}   → began hitting provider
 *   - {type:'provider_done', provider, count}
 *   - {type:'dedupe', before, after}
 *   - {type:'pdf_filter', kept, total}
 *   - {type:'scoring', total}             → Haiku abstract scoring started
 *   - {type:'results', results:[...]}     → final ranked list
 *   - {type:'error', message}             → fatal
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
      return new Response(JSON.stringify({ error: 'query is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const requirePdf = filters.requirePdf ?? true
    const effectiveFilters = { ...filters, requirePdf }
    const queryHash = hashQuery(query, effectiveFilters)

    // ── Cache lookup (fast path) ─────────────────────────────────────
    const cached = await prisma.literatureSearchCache.findFirst({
      where: { userId, queryHash, expiresAt: { gt: new Date() } },
    })
    if (cached) {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder()
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'cached', results: cached.results })}\n\n`)
          )
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      })
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        },
      })
    }

    // ── Credit preflight ─────────────────────────────────────────────
    const credits = await checkCredits(userId, 'research_ai_search')
    if (!credits.allowed) {
      return new Response(
        JSON.stringify({ error: 'Insufficient credits', balance: credits.balance, cost: credits.estimatedCost }),
        { status: 402, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // ── SSE stream ───────────────────────────────────────────────────
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (payload: Record<string, unknown>) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
          } catch {
            // downstream closed — ignore
          }
        }
        const done = () => {
          try {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
          } catch {
            // already closed
          }
        }

        try {
          // Step 1 — Haiku query expansion.
          emit({ type: 'expanding' })
          const { system, user } = buildResearchPrompt(query)
          const expansion = await generateJSONWithUsage<AIResponse>(user, system, { model: HAIKU })
          await deductCredits(
            userId,
            'research_ai_search',
            expansion.inputTokens,
            expansion.outputTokens,
            'haiku',
            { stage: 'query_expansion' }
          ).catch(() => {})
          const queries = (expansion.data.queries ?? []).length > 0
            ? expansion.data.queries
            : [{ text: query } as AIQuery]
          emit({
            type: 'queries',
            queries: queries.map((q) => ({ text: q.text, reasoning: q.reasoning })),
          })

          // Step 2 — fan out across every provider for every expanded query,
          // but emit one completion event per provider so the UI can light
          // them up one by one. Each provider sees all queries merged so the
          // progress bar advances 8 times (not 8 × queries.length).
          const providerResults = new Map<string, AcademicSearchResult[]>()
          for (const p of ALL_PROVIDERS) providerResults.set(p, [])

          const providerPromises: Promise<void>[] = []
          for (const providerName of ALL_PROVIDERS) {
            emit({ type: 'provider_start', provider: providerName })
            providerPromises.push(
              (async () => {
                const bucket: AcademicSearchResult[] = []
                for (const q of queries) {
                  try {
                    const params: AcademicSearchParams = {
                      query: q.text,
                      providers: [providerName],
                      type: filters.type,
                      yearFrom: filters.yearFrom,
                      yearTo: filters.yearTo,
                      limit: PER_PROVIDER_LIMIT,
                    }
                    const { results } = await searchAcademic(params)
                    bucket.push(...results)
                  } catch {
                    // single-provider/query failures are expected for niche
                    // endpoints (bioRxiv fuzzy, etc.) — swallow and continue
                  }
                }
                providerResults.set(providerName, bucket)
                emit({ type: 'provider_done', provider: providerName, count: bucket.length })
              })()
            )
          }

          await Promise.all(providerPromises)

          // Step 3 — flatten + dedupe.
          const raw: AcademicSearchResult[] = []
          for (const list of providerResults.values()) raw.push(...list)

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
          emit({ type: 'dedupe', before: raw.length, after: deduped.length })

          // Step 4 — PDF filter.
          let candidates = deduped
          if (requirePdf) {
            const withPdf = deduped.filter((r) => !!r.openAccessUrl)
            candidates = withPdf.length > 0 ? withPdf : deduped
            emit({ type: 'pdf_filter', kept: withPdf.length, total: deduped.length })
          }

          candidates = candidates.slice(0, SCORING_CAP)

          // Step 5 — already-in-library flag.
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

          // Step 6 — Haiku abstract scoring.
          emit({ type: 'scoring', total: candidates.length })
          const scored = await scoreCandidates(userId, query, candidates)

          // Step 7 — final ranking (weighted blend).
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
            .slice(0, TOP_N_RESULTS)

          // Step 8 — persist cache.
          const expiresAt = new Date(Date.now() + CACHE_TTL_DAYS * 24 * 60 * 60 * 1000)
          await prisma.literatureSearchCache
            .upsert({
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
            .catch(() => {})

          emit({ type: 'results', results: ranked })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          console.error('[literature-search stream] failed:', err)
          emit({ type: 'error', message })
        } finally {
          done()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    console.error('[POST /api/library/literature-search]', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

/** Haiku reads abstracts and scores each candidate 0-10 against the query. */
async function scoreCandidates(
  userId: string,
  query: string,
  candidates: AcademicSearchResult[]
): Promise<Array<AcademicSearchResult & { relevanceScore?: number }>> {
  if (candidates.length === 0) return []

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
    }).catch(() => {})

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
