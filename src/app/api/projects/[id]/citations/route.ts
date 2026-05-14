/**
 * GET /api/projects/[id]/citations
 *
 * Walks every Subsection in the project, parses its content for
 * `<span data-cite-bib-id="...">` markers (the CitationMark inline
 * node's wire format), and returns a flat list of citations enriched
 * with bibliography + library-entry metadata so the verification page
 * can render the table and the right-side panel without extra round
 * trips.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

interface ParsedMarker {
  bibId: string
  page: number | null
  quote: string | null
  label: string
  contextSnippet: string
  // Multi-volume sources carry the (volumeId, volumeNumber) pair so
  // the verify panel can scope chunks/PDF to the right cilt.
  volumeId: string | null
  volumeNumber: number | null
}

const SPAN_RE =
  /<span\b[^>]*data-cite-bib-id\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/span>/g

function attr(html: string, name: string): string | null {
  const m = html.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`))
  return m ? m[1] : null
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
}

function extractMarkers(content: string): ParsedMarker[] {
  if (!content) return []
  const out: ParsedMarker[] = []
  // Reset lastIndex defensively because the same regex object is shared.
  SPAN_RE.lastIndex = 0
  for (const match of content.matchAll(SPAN_RE)) {
    const fullSpan = match[0]
    const bibId = match[1]
    const innerLabel = stripTags(match[2]).trim()

    const pageStr = attr(fullSpan, 'data-page')
    const page = pageStr ? parseInt(pageStr, 10) : null
    const quote = attr(fullSpan, 'data-quote')
    const volumeId = attr(fullSpan, 'data-volume-id')
    const volumeStr = attr(fullSpan, 'data-volume')
    const volumeNumber = volumeStr ? parseInt(volumeStr, 10) : null

    // Pull a short context window (~120 chars) on either side of the
    // span so the verification list shows what the writer was saying
    // when they cited the source.
    const matchStart = match.index ?? 0
    const matchEnd = matchStart + fullSpan.length
    const before = stripTags(content.slice(Math.max(0, matchStart - 200), matchStart))
    const after = stripTags(content.slice(matchEnd, matchEnd + 200))
    const contextSnippet = `${before.slice(-80).trim()} [${innerLabel}] ${after.slice(0, 80).trim()}`.trim()

    out.push({
      bibId,
      page: Number.isFinite(page as number) ? (page as number) : null,
      quote: quote || null,
      label: innerLabel,
      contextSnippet,
      volumeId: volumeId || null,
      volumeNumber: Number.isFinite(volumeNumber as number)
        ? (volumeNumber as number)
        : null,
    })
  }
  return out
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id: projectId } = await ctx.params

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: session.user.id },
      select: { id: true },
    })
    if (!project) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const subsections = await prisma.subsection.findMany({
      where: { section: { chapter: { projectId } } },
      orderBy: [{ sortOrder: 'asc' }],
      select: {
        id: true,
        title: true,
        subsectionId: true,
        content: true,
        section: {
          select: {
            id: true,
            sectionId: true,
            title: true,
            chapter: { select: { id: true, number: true, title: true } },
          },
        },
      },
    })

    const allMarkers: Array<ParsedMarker & {
      subsectionId: string
      subsectionLabel: string
      subsectionTitle: string
      chapterTitle: string
      chapterNumber: number
    }> = []
    const bibIds = new Set<string>()

    for (const sub of subsections) {
      const markers = extractMarkers(sub.content ?? '')
      for (const m of markers) {
        bibIds.add(m.bibId)
        allMarkers.push({
          ...m,
          subsectionId: sub.id,
          subsectionLabel: sub.subsectionId, // e.g. "1.2.3"
          subsectionTitle: sub.title,
          chapterTitle: sub.section.chapter.title,
          chapterNumber: sub.section.chapter.number,
        })
      }
    }

    // One round trip for all referenced bibliography entries.
    const bibs = bibIds.size === 0
      ? []
      : await prisma.bibliography.findMany({
          where: { id: { in: Array.from(bibIds) }, projectId },
          select: {
            id: true,
            authorSurname: true,
            authorName: true,
            title: true,
            year: true,
            libraryEntryId: true,
            libraryEntry: {
              select: {
                id: true,
                filePath: true,
                pdfStatus: true,
                // Probe for at least one ready cilt so multi-volume
                // parents (whose own pdfStatus is 'none') still report
                // hasChunks=true. Avoids the UI greying citation rows
                // for classical works that are fully RAG-ready.
                volumes: {
                  where: { pdfStatus: 'ready' },
                  select: { id: true },
                  take: 1,
                },
              },
            },
          },
        })
    const bibById = new Map(bibs.map((b) => [b.id, b]))

    const citations = allMarkers
      .map((m, idx) => {
        const bib = bibById.get(m.bibId)
        return {
          // Stable key so the UI can list-key on it; not persisted.
          key: `${m.subsectionId}::${idx}`,
          bibId: m.bibId,
          page: m.page,
          quote: m.quote,
          label: m.label,
          contextSnippet: m.contextSnippet,
          subsectionId: m.subsectionId,
          subsectionLabel: m.subsectionLabel,
          subsectionTitle: m.subsectionTitle,
          chapterTitle: m.chapterTitle,
          chapterNumber: m.chapterNumber,
          volumeId: m.volumeId,
          volumeNumber: m.volumeNumber,
          bibliography: bib
            ? {
                id: bib.id,
                authorSurname: bib.authorSurname,
                authorName: bib.authorName,
                title: bib.title,
                year: bib.year,
                libraryEntryId: bib.libraryEntryId,
                hasPdf:
                  Boolean(bib.libraryEntry?.filePath) ||
                  (bib.libraryEntry?.volumes?.length ?? 0) > 0,
                hasChunks:
                  bib.libraryEntry?.pdfStatus === 'ready' ||
                  (bib.libraryEntry?.volumes?.length ?? 0) > 0,
              }
            : null,
        }
      })

    return NextResponse.json({ citations })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/projects/[id]/citations]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
