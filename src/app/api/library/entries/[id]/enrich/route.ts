import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { enrichLibraryEntryFromPdfText } from '@/lib/library-pipeline'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * POST /api/library/entries/:id/enrich
 * Re-runs metadata extraction against the first few chunks of the entry's
 * PDF and fills any currently-empty fields (journalName, volume, issue,
 * pageRange, doi, abstract, keywords, etc.). Never overwrites existing
 * values.
 */
export async function POST(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const entry = await prisma.libraryEntry.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true, pdfStatus: true },
    })
    if (!entry) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
    }
    if (entry.pdfStatus !== 'ready') {
      return NextResponse.json(
        { error: 'PDF is not ready — upload or process a PDF first.' },
        { status: 400 }
      )
    }

    // Pull the first handful of chunks (page order, then chunk order) —
    // publication metadata lives on the title page / abstract page.
    const chunks = await prisma.libraryChunk.findMany({
      where: { libraryEntryId: id },
      orderBy: [{ pageNumber: 'asc' }, { chunkIndex: 'asc' }],
      take: 10,
      select: { content: true },
    })
    if (chunks.length === 0) {
      return NextResponse.json({ error: 'No chunks found for this entry.' }, { status: 400 })
    }

    const joined = chunks.map((c) => c.content).join('\n\n')
    await enrichLibraryEntryFromPdfText(id, joined)

    const refreshed = await prisma.libraryEntry.findUnique({
      where: { id },
      select: {
        journalName: true,
        journalVolume: true,
        journalIssue: true,
        pageRange: true,
        doi: true,
        abstract: true,
        keywords: true,
      },
    })

    return NextResponse.json({ status: 'ok', entry: refreshed })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library/entries/:id/enrich]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
