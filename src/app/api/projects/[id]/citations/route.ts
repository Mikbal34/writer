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
import { quoteHashOf } from '@/lib/citation-verifier'
import { parseMarker } from '@/lib/citations/inline-resolver'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

interface ParsedMarker {
  bibId: string
  page: number | null
  quote: string | null
  label: string
  contextSnippet: string
  // Position in the source content (used to sort the HTML and
  // markdown passes back into reading order).
  position: number
  // Multi-volume sources carry the (volumeId, volumeNumber) pair so
  // the verify panel can scope chunks/PDF to the right cilt.
  volumeId: string | null
  volumeNumber: number | null
}

// Citation markers in the wild come in TWO forms:
//   1. `<span data-cite-bib-id="…">label</span>`
//      — the pill the Tiptap editor renders on screen.
//   2. `[cite:bibId,p=45]` (canonical markdown)
//      — what the write LLM emits and what htmlToMarkdown round-trips
//        to. This is what actually sits on disk.
// We accept both so this endpoint works regardless of whether the
// content was last edited in-browser (round-tripped HTML) or just
// written by the LLM (raw markdown).
const SPAN_RE =
  /<span\b[^>]*data-cite-bib-id\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/span>/g
const MARKDOWN_RE = /\[cite:([^\]]+)\]/g

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

function contextAround(
  content: string,
  matchStart: number,
  matchEnd: number,
  innerLabel: string,
): string {
  const before = stripTags(content.slice(Math.max(0, matchStart - 200), matchStart))
  const after = stripTags(content.slice(matchEnd, matchEnd + 200))
  return `${before.slice(-80).trim()} [${innerLabel}] ${after.slice(0, 80).trim()}`.trim()
}

function extractMarkers(content: string): ParsedMarker[] {
  if (!content) return []
  const out: ParsedMarker[] = []

  // ── HTML span markers ────────────────────────────────────────────
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

    const matchStart = match.index ?? 0
    const matchEnd = matchStart + fullSpan.length
    out.push({
      bibId,
      page: Number.isFinite(page as number) ? (page as number) : null,
      quote: quote || null,
      label: innerLabel,
      contextSnippet: contextAround(content, matchStart, matchEnd, innerLabel),
      position: matchStart,
      volumeId: volumeId || null,
      volumeNumber: Number.isFinite(volumeNumber as number)
        ? (volumeNumber as number)
        : null,
    })
  }

  // ── Markdown markers ─────────────────────────────────────────────
  MARKDOWN_RE.lastIndex = 0
  for (const match of content.matchAll(MARKDOWN_RE)) {
    const fullMarker = match[0]
    const parsed = parseMarker(match[1])
    if (!parsed) continue
    const matchStart = match.index ?? 0
    const matchEnd = matchStart + fullMarker.length
    const innerLabel = parsed.page
      ? `${parsed.bibId.slice(0, 6)}…, s.${parsed.page}`
      : `${parsed.bibId.slice(0, 6)}…`
    const page =
      parsed.page && /^\d+/.test(parsed.page)
        ? parseInt(parsed.page, 10)
        : null
    const volumeNumber =
      parsed.volume && /^\d+/.test(parsed.volume)
        ? parseInt(parsed.volume, 10)
        : null
    out.push({
      bibId: parsed.bibId,
      page: Number.isFinite(page as number) ? (page as number) : null,
      quote: parsed.quote ?? null,
      label: innerLabel,
      contextSnippet: contextAround(content, matchStart, matchEnd, innerLabel),
      position: matchStart,
      volumeId: null,
      volumeNumber: Number.isFinite(volumeNumber as number)
        ? (volumeNumber as number)
        : null,
    })
  }

  // Order both passes back into reading order so subsection::idx
  // keys stay stable and the UI list reads top-down.
  out.sort((a, b) => a.position - b.position)
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

    // Load any cached verification rows in one shot — the UI shows
    // these as green/yellow/red badges in the citation list.
    const verifications = await prisma.citationVerification.findMany({
      where: { projectId },
      select: {
        subsectionId: true,
        bibliographyId: true,
        page: true,
        quoteHash: true,
        status: true,
        matchScore: true,
        matchMethod: true,
        matchedPage: true,
        userOverride: true,
        verifiedAt: true,
      },
    })
    const verificationKey = (
      subsectionId: string,
      bibId: string,
      page: number | null,
      quote: string | null,
    ) =>
      `${subsectionId}|${bibId}|${page ?? -1}|${quoteHashOf(quote)}`
    const verificationByKey = new Map(
      verifications.map((v) => [
        `${v.subsectionId}|${v.bibliographyId}|${v.page}|${v.quoteHash}`,
        v,
      ]),
    )

    const citations = allMarkers
      .map((m, idx) => {
        const bib = bibById.get(m.bibId)
        const verification = verificationByKey.get(
          verificationKey(m.subsectionId, m.bibId, m.page, m.quote),
        )
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
          verification: verification
            ? {
                status: verification.status,
                matchScore: verification.matchScore,
                matchMethod: verification.matchMethod,
                matchedPage: verification.matchedPage,
                userOverride: verification.userOverride,
                verifiedAt: verification.verifiedAt,
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
