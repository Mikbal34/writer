import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { streamChatWithUsage } from '@/lib/claude'
import { checkCredits, deductCredits } from '@/lib/credits'
import { buildSessionContext } from '@/lib/prompts/session-context'
import { getWritingPrompt } from '@/lib/prompts/writing'
import { startJob, completeJob, failJob } from '@/lib/jobs'

type RouteContext = { params: Promise<{ id: string; subsectionId: string }> }

// ---------------------------------------------------------------------------
// RAG: fetch relevant chunks for the subsection
// ---------------------------------------------------------------------------
interface RagChunk {
  content: string
  pageNumber: number | null
  sourceTitle: string
}

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? 'http://localhost:8000'
const TOP_PROJECT_CHUNKS = 4
const TOP_LIBRARY_CHUNKS = 4

async function embedQueryText(text: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${PYTHON_SERVICE_URL}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: [text] }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { embeddings: number[][] }
    return data.embeddings?.[0] ?? null
  } catch {
    return null
  }
}

async function fetchRagChunks(
  projectId: string,
  subsectionId: string,
  subsection: { title: string; description: string | null; keyPoints: string[] }
): Promise<RagChunk[]> {
  const queryText = [subsection.title, subsection.description, ...(subsection.keyPoints ?? [])]
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .join(' — ')
    .trim()

  if (queryText.length === 0) return []

  // Subsection-scoped: only look inside bibliographies the AI explicitly
  // mapped to THIS subsection during roadmap planning. Falls back to
  // project-wide search when the subsection has no mappings yet.
  const mappedBibs = await prisma.sourceMapping.findMany({
    where: { subsectionId },
    select: { bibliography: { select: { id: true, sourceId: true, libraryEntryId: true } } },
  })
  const bibIds = mappedBibs.map((m) => m.bibliography.id)
  const mappedSourceIds = mappedBibs
    .map((m) => m.bibliography.sourceId)
    .filter((id): id is string => !!id)
  const mappedLibraryEntryIds = mappedBibs
    .map((m) => m.bibliography.libraryEntryId)
    .filter((id): id is string => !!id)

  const hasSubsectionScope = bibIds.length > 0

  // Ideal path: embed the subsection query, then semantic-search both tables.
  const queryVector = await embedQueryText(queryText)

  if (queryVector) {
    const vecLiteral = JSON.stringify(queryVector)

    // Project sources (proje-specific PDF chunks). Narrow to sources mapped
    // to this subsection when we have mappings; else fall back to project
    // scope so a subsection with no mappings still has something to cite.
    const projectChunks = hasSubsectionScope && mappedSourceIds.length > 0
      ? await prisma.$queryRaw<Array<{ content: string; pageNumber: number | null; sourceTitle: string }>>`
          SELECT sc.content,
                 sc."pageNumber",
                 COALESCE(b.title, s.filename) as "sourceTitle"
          FROM "SourceChunk" sc
          JOIN "Source" s ON sc."sourceId" = s.id
          LEFT JOIN "Bibliography" b ON sc."bibliographyId" = b.id
          WHERE s.id = ANY(${mappedSourceIds}::text[])
            AND sc.embedding IS NOT NULL
          ORDER BY sc.embedding <-> ${vecLiteral}::vector
          LIMIT ${TOP_PROJECT_CHUNKS}
        `.catch(() => [])
      : hasSubsectionScope
      ? [] // subsection has mappings but none of them have uploaded Source files
      : await prisma.$queryRaw<Array<{ content: string; pageNumber: number | null; sourceTitle: string }>>`
          SELECT sc.content,
                 sc."pageNumber",
                 COALESCE(b.title, s.filename) as "sourceTitle"
          FROM "SourceChunk" sc
          JOIN "Source" s ON sc."sourceId" = s.id
          LEFT JOIN "Bibliography" b ON sc."bibliographyId" = b.id
          WHERE s."projectId" = ${projectId}
            AND sc.embedding IS NOT NULL
          ORDER BY sc.embedding <-> ${vecLiteral}::vector
          LIMIT ${TOP_PROJECT_CHUNKS}
        `.catch(() => [])

    // Library entries linked via Bibliography. Same logic: narrow to those
    // mapped to this subsection; fall back to project scope otherwise.
    const libraryChunks = hasSubsectionScope && mappedLibraryEntryIds.length > 0
      ? await prisma.$queryRaw<Array<{ content: string; pageNumber: number | null; sourceTitle: string }>>`
          SELECT lc.content,
                 lc."pageNumber",
                 le.title as "sourceTitle"
          FROM "LibraryChunk" lc
          JOIN "LibraryEntry" le ON lc."libraryEntryId" = le.id
          WHERE le.id = ANY(${mappedLibraryEntryIds}::text[])
            AND lc.embedding IS NOT NULL
          ORDER BY lc.embedding <-> ${vecLiteral}::vector
          LIMIT ${TOP_LIBRARY_CHUNKS}
        `.catch(() => [])
      : hasSubsectionScope
      ? []
      : await prisma.$queryRaw<Array<{ content: string; pageNumber: number | null; sourceTitle: string }>>`
          SELECT lc.content,
                 lc."pageNumber",
                 le.title as "sourceTitle"
          FROM "LibraryChunk" lc
          JOIN "LibraryEntry" le ON lc."libraryEntryId" = le.id
          WHERE le.id IN (
            SELECT DISTINCT b."libraryEntryId"
            FROM "Bibliography" b
            WHERE b."projectId" = ${projectId}
              AND b."libraryEntryId" IS NOT NULL
          )
          AND lc.embedding IS NOT NULL
          ORDER BY lc.embedding <-> ${vecLiteral}::vector
          LIMIT ${TOP_LIBRARY_CHUNKS}
        `.catch(() => [])

    const merged = [...projectChunks, ...libraryChunks]
    if (merged.length > 0) return merged
  }

  // Fallback path: crude keyword search across both tables when the embed
  // call fails (e.g. Python service unreachable).
  const queryTerms = queryText
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 3)
    .slice(0, 3)

  if (queryTerms.length === 0) return []

  try {
    const conditions = queryTerms.map((term) => ({
      content: { contains: term, mode: 'insensitive' as const },
    }))

    const sourceFilter = hasSubsectionScope && mappedSourceIds.length > 0
      ? { sourceId: { in: mappedSourceIds }, OR: conditions }
      : hasSubsectionScope
      ? null
      : { source: { projectId }, OR: conditions }

    const libraryFilter = hasSubsectionScope && mappedLibraryEntryIds.length > 0
      ? { libraryEntryId: { in: mappedLibraryEntryIds }, OR: conditions }
      : hasSubsectionScope
      ? null
      : {
          OR: conditions,
          libraryEntry: { bibliographies: { some: { projectId } } },
        }

    const [projectChunks, libraryChunks] = await Promise.all([
      sourceFilter
        ? prisma.sourceChunk.findMany({
            where: sourceFilter,
            include: {
              source: { select: { filename: true } },
              bibliography: { select: { title: true } },
            },
            take: TOP_PROJECT_CHUNKS,
          })
        : Promise.resolve([]),
      libraryFilter
        ? prisma.libraryChunk.findMany({
            where: libraryFilter,
            include: { libraryEntry: { select: { title: true } } },
            take: TOP_LIBRARY_CHUNKS,
          })
        : Promise.resolve([]),
    ])

    return [
      ...projectChunks.map((c) => ({
        content: c.content,
        pageNumber: c.pageNumber,
        sourceTitle: c.bibliography?.title ?? c.source.filename,
      })),
      ...libraryChunks.map((c) => ({
        content: c.content,
        pageNumber: c.pageNumber,
        sourceTitle: c.libraryEntry.title,
      })),
    ]
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// POST /api/projects/[id]/write/[subsectionId]/generate
// Streams AI-generated content via SSE.
// ---------------------------------------------------------------------------
export async function POST(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id: projectId, subsectionId } = await ctx.params

    // Verify project ownership
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: session.user.id },
      select: { id: true, projectType: true },
    })
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Verify subsection belongs to project
    const subsection = await prisma.subsection.findFirst({
      where: {
        id: subsectionId,
        section: { chapter: { projectId } },
      },
    })
    if (!subsection) {
      return NextResponse.json({ error: 'Subsection not found' }, { status: 404 })
    }

    // Build writing context
    const writingCtx = await buildSessionContext(subsectionId)
    const { systemPromptParts, userPrompt } = getWritingPrompt(writingCtx)

    // RAG chunks — skip for non-academic projects
    const needsSources = project.projectType === 'ACADEMIC'
    const ragChunks = needsSources ? await fetchRagChunks(projectId, subsectionId, subsection) : []
    const ragBlock =
      ragChunks.length > 0
        ? `\n\nRELEVANT SOURCE EXCERPTS:\n${ragChunks
            .map(
              (c, i) =>
                `[Excerpt ${i + 1}] Source: "${c.sourceTitle}" (p.${c.pageNumber ?? '?'})\n${c.content}`
            )
            .join('\n\n')}`
        : ''

    const fullUserPrompt = userPrompt + ragBlock

    // Create writing session record
    const writingSession = await prisma.writingSession.create({
      data: {
        subsectionId,
        context: {
          position: writingCtx.position,
          sourcesCount: writingCtx.sources.length,
          ragChunksCount: ragChunks.length,
        } as unknown as object,
        sourcesUsed: writingCtx.sources.map((s) => ({
          bibliographyId: s.bibliographyId,
          title: s.title,
        })) as unknown as object,
        promptSent: fullUserPrompt,
        status: 'streaming',
      },
    })

    // Credit check
    const credits = await checkCredits(session.user.id, 'write_subsection_alt')
    if (!credits.allowed) {
      return NextResponse.json(
        { error: 'Insufficient credits', balance: credits.balance, cost: credits.estimatedCost },
        { status: 402 }
      )
    }

    // Create a BackgroundJob so the bell can surface progress / completion.
    const jobId = await startJob({
      userId: session.user.id,
      type: 'subsection',
      title: subsection.title,
      projectId,
      subsectionId,
      resultUrl: `/projects/${projectId}/write?subsection=${subsectionId}`,
      message: 'Yazılıyor…',
    })

    // Detached LLM worker — keeps running even if the client disconnects.
    // We buffer chunks so the SSE stream (if still connected) can emit them,
    // but the work itself is not tied to the request lifecycle.
    let bufferedText = ''
    let finalResult:
      | { fullText: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }
      | null = null
    let workError: string | null = null
    let workDone = false
    let creditInfo: { newBalance: number; creditsUsed: number } | null = null

    // Kick off the LLM work. We intentionally do NOT await this; it runs
    // alongside the SSE controller below and survives client disconnect.
    const workPromise = (async () => {
      try {
        await prisma.subsection.update({
          where: { id: subsectionId },
          data: { status: 'in_progress' },
        })

        const result = await streamChatWithUsage(
          [{ role: 'user', content: fullUserPrompt }],
          systemPromptParts,
          (chunk) => {
            bufferedText += chunk
          }
        )
        finalResult = result

        const wordCount = result.fullText.trim().split(/\s+/).filter(Boolean).length

        await prisma.subsection.update({
          where: { id: subsectionId },
          data: {
            content: result.fullText,
            wordCount,
            status: 'completed',
          },
        })

        await prisma.writingSession.update({
          where: { id: writingSession.id },
          data: {
            responseReceived: result.fullText,
            status: 'completed',
          },
        })

        const { newBalance, creditsUsed } = await deductCredits(
          session.user.id,
          'write_subsection_alt',
          result.inputTokens,
          result.outputTokens,
          'sonnet',
          { projectId, subsectionId },
          { read: result.cacheReadTokens, creation: result.cacheCreationTokens }
        )
        creditInfo = { newBalance, creditsUsed }

        await completeJob(jobId, { message: `${wordCount} kelime yazıldı` })
      } catch (err) {
        workError = err instanceof Error ? err.message : String(err)
        await prisma.writingSession
          .update({ where: { id: writingSession.id }, data: { status: 'failed' } })
          .catch(() => {})
        await prisma.subsection
          .update({ where: { id: subsectionId }, data: { status: 'pending' } })
          .catch(() => {})
        await failJob(jobId, workError).catch(() => {})
      } finally {
        workDone = true
      }
    })()

    // Surface unhandled rejections to the log (the promise is intentionally
    // not awaited by the response path).
    workPromise.catch((err) => console.error('[generate] detached worker:', err))

    // SSE stream: polls the buffer every 80ms and enqueues any new text.
    // If the client disconnects, enqueue throws — we swallow the error and
    // the loop exits, but the workPromise keeps running until completion.
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        let sentChars = 0
        let connected = true
        const tryEnqueue = (payload: string): boolean => {
          if (!connected) return false
          try {
            controller.enqueue(encoder.encode(payload))
            return true
          } catch {
            connected = false
            return false
          }
        }

        while (connected) {
          if (bufferedText.length > sentChars) {
            const delta = bufferedText.slice(sentChars)
            sentChars = bufferedText.length
            if (!tryEnqueue(`data: ${JSON.stringify({ delta })}\n\n`)) break
          }
          if (workDone) break
          await new Promise((r) => setTimeout(r, 80))
        }

        if (!connected) {
          // Client left. Work continues; the bell will announce completion.
          return
        }

        if (workError) {
          tryEnqueue(`data: ${JSON.stringify({ error: workError })}\n\n`)
        } else if (finalResult) {
          const wordCount = finalResult.fullText.trim().split(/\s+/).filter(Boolean).length
          tryEnqueue(
            `data: ${JSON.stringify({
              done: true,
              wordCount,
              sessionId: writingSession.id,
              creditsUsed: creditInfo?.creditsUsed,
              balance: creditInfo?.newBalance,
            })}\n\n`
          )
          tryEnqueue('data: [DONE]\n\n')
        }
        try {
          controller.close()
        } catch {
          // already closed
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/projects/[id]/write/[subsectionId]/generate]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
