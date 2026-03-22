import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { streamChat } from '@/lib/claude'
import type {
  WritingContext,
  PrevNextSubsection,
  SourceMappingInfo,
  PositionInfo,
  StyleProfile,
} from '@/types/project'

type RouteContext = { params: Promise<{ id: string }> }

// ---------------------------------------------------------------------------
// Build the system prompt from the full writing context
// ---------------------------------------------------------------------------
function buildSystemPrompt(ctx: WritingContext): string {
  const style = ctx.styleProfile
  const lang = ctx.citationFormat

  const styleInstructions = style
    ? `
STYLE PROFILE:
- Sentence length: ${style.sentenceLength ?? 'varied'}
- Tone: ${style.tone ?? 'formal'}
- Terminology density: ${style.terminologyDensity ?? 'medium'}
- Voice preference: ${style.voicePreference ?? 'mixed'}
- Paragraph structure: ${style.paragraphStructure ?? 'topic-sentence-first'}
- Formality (1-10): ${style.formality ?? 7}
- Uses first person: ${style.usesFirstPerson ? 'yes' : 'no'}
- Citation style: ${style.citationStyle ?? 'inline-footnote'}
- Paragraph length: ${style.paragraphLength ?? 'medium'}
- Rhetorical approach: ${style.rhetoricalApproach ?? 'analytical'}
${style.additionalNotes ? `- Notes: ${style.additionalNotes}` : ''}
`
    : ''

  const guidelinesBlock = ctx.writingGuidelines
    ? `\nWRITING GUIDELINES:\n${JSON.stringify(ctx.writingGuidelines, null, 2)}\n`
    : ''

  const sourcesBlock =
    ctx.sources.length > 0
      ? `
AVAILABLE SOURCES FOR THIS SUBSECTION:
${ctx.sources
  .map(
    (s) =>
      `- [${s.priority.toUpperCase()}] ${s.authorSurname}${s.authorName ? ', ' + s.authorName : ''}: "${s.title}"` +
      ` (${s.year ?? '?'}${s.publisher ? ', ' + s.publisher : ''})` +
      (s.relevance ? `\n  Relevance: ${s.relevance}` : '') +
      (s.howToUse ? `\n  How to use: ${s.howToUse}` : '')
  )
  .join('\n')}
`
      : ''

  return `You are an expert academic writer tasked with writing a specific subsection of a scholarly book.

CITATION FORMAT: ${lang}

BOOK CONTEXT:
- Chapter: ${ctx.chapter.title} (Chapter ${ctx.chapter.number})
- Section: ${ctx.section.title} (${ctx.section.sectionId})
- Subsection: ${ctx.subsection.title} (${ctx.subsection.subsectionId})
${ctx.prevSubsection ? `- Previous subsection: "${ctx.prevSubsection.title}" (${ctx.prevSubsection.subsectionId})` : ''}
${ctx.nextSubsection ? `- Next subsection: "${ctx.nextSubsection.title}" (${ctx.nextSubsection.subsectionId})` : ''}
${ctx.position.sectionFirst ? '- This is the FIRST subsection of its section.' : ''}
${ctx.position.sectionLast ? '- This is the LAST subsection of its section.' : ''}
${ctx.position.chapterFirst ? '- This is the FIRST subsection of the chapter.' : ''}
${ctx.position.chapterLast ? '- This is the LAST subsection of the chapter.' : ''}
${styleInstructions}${guidelinesBlock}${sourcesBlock}
INSTRUCTIONS:
- Write ONLY the content for this specific subsection.
- Do not include headings/titles for the subsection itself (they are rendered separately).
- Integrate sources naturally using ${lang} citation format.
- Maintain academic register and scholarly tone throughout.
- Ensure smooth transitions with the surrounding subsections.
- Estimated length: ${ctx.subsection.estimatedPages ?? 1} page(s).`
}

function buildUserPrompt(ctx: WritingContext, ragChunks: RagChunk[]): string {
  const ragBlock =
    ragChunks.length > 0
      ? `\n\nRELEVANT SOURCE EXCERPTS (use these as primary references):\n${ragChunks
          .map(
            (c, i) =>
              `[Excerpt ${i + 1}] Source: "${c.sourceTitle}" (p.${c.pageNumber ?? '?'})\n${c.content}`
          )
          .join('\n\n')}`
      : ''

  return `Write the academic content for the following subsection:

SUBSECTION: ${ctx.subsection.title} (${ctx.subsection.subsectionId})
DESCRIPTION: ${ctx.subsection.description ?? 'See key points below'}
WHAT TO WRITE: ${ctx.subsection.whatToWrite ?? 'Develop the topic based on the key points'}

KEY POINTS TO COVER:
${(ctx.subsection.keyPoints ?? []).map((p, i) => `${i + 1}. ${p}`).join('\n')}

WRITING STRATEGY: ${ctx.subsection.writingStrategy ?? 'Standard academic exposition'}${ragBlock}

Write the full subsection content now:`
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface RagChunk {
  content: string
  pageNumber: number | null
  sourceTitle: string
}

// ---------------------------------------------------------------------------
// RAG: fetch relevant chunks from the DB using a simple keyword search
// (Full vector search requires the pgvector extension and raw SQL;
//  this fallback uses text similarity when embedding is not available.)
// ---------------------------------------------------------------------------
async function fetchRagChunks(
  projectId: string,
  subsection: { title: string; description: string | null; keyPoints: string[] }
): Promise<RagChunk[]> {
  // Build a search query from key points and title
  const queryTerms = [subsection.title, ...(subsection.keyPoints ?? [])]
    .join(' ')
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 3)
    .slice(0, 10)

  if (queryTerms.length === 0) return []

  try {
    // Attempt vector similarity search via raw SQL (requires pgvector)
    // Falls back to keyword search if this fails
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
    // Fallback: keyword search across chunks
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
// POST /api/subsections/[id]/write
// Streams the Claude writing response via Server-Sent Events.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    // ------------------------------------------------------------------
    // 1. Load the subsection and verify ownership
    // ------------------------------------------------------------------
    const subsection = await prisma.subsection.findFirst({
      where: {
        id,
        section: { chapter: { project: { userId: session.user.id } } },
      },
      include: {
        sourceMappings: {
          include: { bibliography: true },
        },
        section: {
          include: {
            subsections: { orderBy: { sortOrder: 'asc' } },
            chapter: {
              include: {
                sections: {
                  orderBy: { sortOrder: 'asc' },
                  include: {
                    subsections: { orderBy: { sortOrder: 'asc' } },
                  },
                },
                project: {
                  select: {
                    id: true,
                    citationFormat: true,
                    styleProfile: true,
                    writingGuidelines: true,
                    language: true,
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!subsection) {
      return NextResponse.json({ error: 'Subsection not found' }, { status: 404 })
    }

    const section = subsection.section
    const chapter = section.chapter
    const project = chapter.project

    // ------------------------------------------------------------------
    // 2. Compute position / prev / next
    // ------------------------------------------------------------------
    // Flatten all subsections across all sections of the chapter in order
    const allSubsectionsInChapter = chapter.sections.flatMap((sec) => sec.subsections)
    const currentIndex = allSubsectionsInChapter.findIndex((s) => s.id === id)

    const sectionSubsections = section.subsections
    const indexInSection = sectionSubsections.findIndex((s) => s.id === id)

    const position: PositionInfo = {
      sectionFirst: indexInSection === 0,
      sectionLast: indexInSection === sectionSubsections.length - 1,
      chapterFirst: currentIndex === 0,
      chapterLast: currentIndex === allSubsectionsInChapter.length - 1,
    }

    const prevRaw = currentIndex > 0 ? allSubsectionsInChapter[currentIndex - 1] : null
    const nextRaw =
      currentIndex < allSubsectionsInChapter.length - 1
        ? allSubsectionsInChapter[currentIndex + 1]
        : null

    function toPrevNext(raw: typeof prevRaw): PrevNextSubsection | null {
      if (!raw) return null
      // Find which section this belongs to
      const sec = chapter.sections.find((s) => s.subsections.some((ss) => ss.id === raw.id))
      return {
        subsectionId: raw.subsectionId,
        title: raw.title,
        sectionTitle: sec?.title ?? '',
        chapterTitle: chapter.title,
      }
    }

    // ------------------------------------------------------------------
    // 3. Build source mapping info
    // ------------------------------------------------------------------
    const sources: SourceMappingInfo[] = subsection.sourceMappings.map((sm) => ({
      bibliographyId: sm.bibliographyId,
      authorSurname: sm.bibliography.authorSurname,
      authorName: sm.bibliography.authorName,
      title: sm.bibliography.title,
      shortTitle: sm.bibliography.shortTitle,
      entryType: sm.bibliography.entryType,
      year: sm.bibliography.year,
      publisher: sm.bibliography.publisher,
      publishPlace: sm.bibliography.publishPlace,
      relevance: sm.relevance,
      priority: sm.priority,
      howToUse: sm.howToUse,
    }))

    // ------------------------------------------------------------------
    // 4. RAG chunk retrieval
    // ------------------------------------------------------------------
    const ragChunks = await fetchRagChunks(project.id, subsection)

    // ------------------------------------------------------------------
    // 5. Assemble writing context
    // ------------------------------------------------------------------
    const writingCtx: WritingContext = {
      // The Prisma query result is structurally compatible but TypeScript
      // can't verify this without a generated client; cast through unknown.
      subsection: subsection as unknown as WritingContext['subsection'],
      section: section as unknown as WritingContext['section'],
      chapter: chapter as unknown as WritingContext['chapter'],
      position,
      prevSubsection: toPrevNext(prevRaw),
      nextSubsection: toPrevNext(nextRaw),
      sources,
      citationFormat: project.citationFormat,
      styleProfile: project.styleProfile as Partial<StyleProfile> | null,
      writingGuidelines: project.writingGuidelines
        ? typeof project.writingGuidelines === 'string'
          ? project.writingGuidelines
          : JSON.stringify(project.writingGuidelines)
        : null,
    }

    const systemPrompt = buildSystemPrompt(writingCtx)
    const userPrompt = buildUserPrompt(writingCtx, ragChunks)

    // ------------------------------------------------------------------
    // 6. Create a WritingSession record (pending) so we can update it later
    // ------------------------------------------------------------------
    const writingSession = await prisma.writingSession.create({
      data: {
        subsectionId: id,
        // Prisma Json fields require casting through unknown
        context: {
          position,
          prevSubsection: toPrevNext(prevRaw),
          nextSubsection: toPrevNext(nextRaw),
          sourcesCount: sources.length,
          ragChunksCount: ragChunks.length,
        } as unknown as object,
        sourcesUsed: sources.map((s) => ({
          bibliographyId: s.bibliographyId,
          title: s.title,
        })) as unknown as object,
        promptSent: userPrompt,
        status: 'streaming',
      },
    })

    // ------------------------------------------------------------------
    // 7. Stream Claude response via SSE
    // ------------------------------------------------------------------
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        let fullResponse = ''

        try {
          // Mark subsection as in_progress
          await prisma.subsection.update({
            where: { id },
            data: { status: 'in_progress' },
          })

          for await (const chunk of streamChat(
            [{ role: 'user', content: userPrompt }],
            systemPrompt
          )) {
            fullResponse += chunk
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk })}\n\n`))
          }

          const wordCount = fullResponse.trim().split(/\s+/).filter(Boolean).length

          // Save the generated content to the subsection
          await prisma.subsection.update({
            where: { id },
            data: {
              content: fullResponse,
              wordCount,
              status: 'draft',
            },
          })

          // Update writing session with the full response
          await prisma.writingSession.update({
            where: { id: writingSession.id },
            data: {
              responseReceived: fullResponse,
              status: 'completed',
            },
          })

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ done: true, wordCount, sessionId: writingSession.id })}\n\n`
            )
          )
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch (streamErr) {
          // Mark session as failed
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
    console.error('[POST /api/subsections/[id]/write]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
