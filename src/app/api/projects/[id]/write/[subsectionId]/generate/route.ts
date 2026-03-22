import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { streamChatWithUsage } from '@/lib/claude'
import { checkCredits, deductCredits } from '@/lib/credits'
import { buildSessionContext } from '@/lib/prompts/session-context'
import { getWritingPrompt } from '@/lib/prompts/writing'

type RouteContext = { params: Promise<{ id: string; subsectionId: string }> }

// ---------------------------------------------------------------------------
// RAG: fetch relevant chunks for the subsection
// ---------------------------------------------------------------------------
interface RagChunk {
  content: string
  pageNumber: number | null
  sourceTitle: string
}

async function fetchRagChunks(
  projectId: string,
  subsection: { title: string; description: string | null; keyPoints: string[] }
): Promise<RagChunk[]> {
  const queryTerms = [subsection.title, ...(subsection.keyPoints ?? [])]
    .join(' ')
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 3)
    .slice(0, 10)

  if (queryTerms.length === 0) return []

  try {
    const chunks = await prisma.$queryRaw<
      Array<{ content: string; pageNumber: number | null; filename: string }>
    >`
      SELECT sc.content, sc."pageNumber", s.filename
      FROM "SourceChunk" sc
      JOIN "Source" s ON sc."sourceId" = s.id
      WHERE s."projectId" = ${projectId}
        AND sc.embedding IS NOT NULL
      ORDER BY sc.embedding <-> (
        SELECT embedding FROM "SourceChunk"
        WHERE content ILIKE ${'%' + queryTerms[0] + '%'}
          AND embedding IS NOT NULL
        LIMIT 1
      )
      LIMIT 8
    `

    return chunks.map((c) => ({
      content: c.content,
      pageNumber: c.pageNumber,
      sourceTitle: c.filename,
    }))
  } catch {
    try {
      const conditions = queryTerms.slice(0, 3).map((term) => ({
        content: { contains: term, mode: 'insensitive' as const },
      }))

      const chunks = await prisma.sourceChunk.findMany({
        where: {
          source: { projectId },
          OR: conditions,
        },
        include: { source: { select: { filename: true } } },
        take: 8,
      })

      return chunks.map((c) => ({
        content: c.content,
        pageNumber: c.pageNumber,
        sourceTitle: c.source.filename,
      }))
    } catch {
      return []
    }
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
      select: { id: true },
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

    // RAG chunks
    const ragChunks = await fetchRagChunks(projectId, subsection)
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

    // Stream response via SSE
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          await prisma.subsection.update({
            where: { id: subsectionId },
            data: { status: 'in_progress' },
          })

          const result = await streamChatWithUsage(
            [{ role: 'user', content: fullUserPrompt }],
            systemPromptParts,
            (chunk) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: chunk })}\n\n`))
            }
          )

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
            { projectId, subsectionId }
          )

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ done: true, wordCount, sessionId: writingSession.id, creditsUsed, balance: newBalance })}\n\n`
            )
          )
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch (streamErr) {
          await prisma.writingSession.update({
            where: { id: writingSession.id },
            data: { status: 'failed' },
          }).catch(() => {})

          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: String(streamErr) })}\n\n`)
          )
          controller.close()
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
