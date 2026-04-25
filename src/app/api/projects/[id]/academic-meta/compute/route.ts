/**
 * GET /api/projects/[id]/academic-meta/compute
 *
 * Returns derived/computed values that the academic-meta form can
 * splice in as one-click defaults — word counts, table/figure counts
 * pulled from the project's written content, and today's date in
 * a few common shapes for the various date fields.
 *
 * Computed lazily on demand rather than persisted: the project body
 * changes every time the user writes another subsection, so caching
 * would just go stale.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

type RouteContext = { params: Promise<{ id: string }> }

const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** Crude word counter: whitespace-split after stripping markdown noise. */
function countWords(text: string): number {
  if (!text) return 0
  const cleaned = text
    .replace(/`+([^`]*)`+/g, '$1')           // inline code
    .replace(/\[\^[^\]]+\]/g, '')             // footnote refs
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')     // image markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // link markdown — keep label
    .replace(/[#*_>`~|-]+/g, ' ')             // markdown punctuation
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return 0
  return cleaned.split(' ').length
}

/** Detect markdown table blocks: a line of pipes followed by a separator line. */
function countTables(text: string): number {
  if (!text) return 0
  // Separator row pattern, e.g. "|---|---|" or "| :--- | ---: |"
  const matches = text.match(/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/gm)
  return matches ? matches.length : 0
}

/**
 * Markdown image references in body content. Augmented by the count of
 * ProjectImage rows for the project.
 */
function countMarkdownFigures(text: string): number {
  if (!text) return 0
  const matches = text.match(/!\[[^\]]*\]\([^)]+\)/g)
  return matches ? matches.length : 0
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
      select: {
        id: true,
        title: true,
        chapters: {
          select: {
            sections: {
              select: {
                subsections: {
                  select: { content: true },
                },
              },
            },
          },
        },
        _count: { select: { projectImages: true } },
      },
    })
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const fullBody = project.chapters
      .flatMap((c) => c.sections.flatMap((s) => s.subsections.map((ss) => ss.content ?? '')))
      .filter((t) => t && t.trim().length > 0)
      .join('\n\n')

    const wordCountText = countWords(fullBody)
    const tableCount = countTables(fullBody)
    const figureCount = countMarkdownFigures(fullBody) + project._count.projectImages

    const today = new Date()
    const yyyy = today.getFullYear()
    const monthName = MONTHS_EN[today.getMonth()]
    const day = today.getDate()
    const mm = String(today.getMonth() + 1).padStart(2, '0')
    const dd = String(day).padStart(2, '0')

    return NextResponse.json({
      // Word / element counts derived from project content.
      wordCountText,
      tableCount,
      figureCount,
      // Date helpers — different formats prescribe different shapes.
      isoDate: `${yyyy}-${mm}-${dd}`,            // 2025-04-25
      mlaDate: `${day} ${monthName} ${yyyy}`,    // "25 April 2025"
      apaDate: `${monthName} ${day}, ${yyyy}`,   // "April 25, 2025"
      currentYear: String(yyyy),
      // Subtitle extraction — split on colon if present.
      subtitleFromTitle: extractSubtitle(project.title),
      /** Truncated title for running heads (APA professional, Vancouver, AMA shortTitle). */
      shortTitleFromTitle: shortenTitle(project.title, 50),
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /academic-meta/compute]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

/**
 * If the project title is "Main Idea: A Long Subtitle", return the
 * subtitle. Splits on the first colon or em-dash; returns null if there
 * is none.
 */
function extractSubtitle(title: string): string | null {
  const split = title.split(/\s*[:—–]\s*/)
  if (split.length < 2) return null
  return split.slice(1).join(' — ').trim() || null
}

/**
 * Truncate the project title for running-head fields (APA professional
 * shortTitle, Vancouver/AMA shortTitle). Drops any subtitle, then trims
 * at a word boundary at or below `max` characters.
 */
function shortenTitle(title: string, max: number): string {
  const main = title.split(/\s*[:—–]\s*/)[0].trim()
  if (main.length <= max) return main
  const sliced = main.slice(0, max)
  const lastSpace = sliced.lastIndexOf(' ')
  return lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced
}
