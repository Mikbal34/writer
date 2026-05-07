/**
 * GET /api/library/[id]/page/[pageNumber]
 *
 * Returns the extracted text for a specific page of an entry's PDF
 * (concatenated chunk content for that pageNumber). Used by the
 * citation verify panel as the default "show me the source" view —
 * works even for legacy entries that no longer have the original
 * PDF persisted, as long as their chunks were extracted.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string; pageNumber: string }> }

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id, pageNumber } = await ctx.params

    const page = parseInt(pageNumber, 10)
    if (!Number.isFinite(page) || page < 1) {
      return NextResponse.json({ error: 'Invalid page number' }, { status: 400 })
    }

    const entry = await prisma.libraryEntry.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true, title: true, authorSurname: true, authorName: true, year: true, filePath: true },
    })
    if (!entry) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const chunks = await prisma.libraryChunk.findMany({
      where: { libraryEntryId: id, pageNumber: page },
      orderBy: { chunkIndex: 'asc' },
      select: { content: true, chunkIndex: true },
    })

    return NextResponse.json({
      entry: {
        id: entry.id,
        title: entry.title,
        authorSurname: entry.authorSurname,
        authorName: entry.authorName,
        year: entry.year,
        hasPdf: Boolean(entry.filePath),
      },
      pageNumber: page,
      content: chunks.map((c) => c.content).join('\n\n'),
      chunkCount: chunks.length,
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/library/[id]/page/[pageNumber]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
