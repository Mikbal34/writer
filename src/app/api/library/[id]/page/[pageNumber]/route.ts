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

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id, pageNumber } = await ctx.params
    const url = new URL(req.url)
    const volumeId = url.searchParams.get('volume')

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

    // Volume scoping: when the citation targets a specific volume,
    // pull only that volume's chunks. Otherwise default to the
    // entry's "primary" chunks (volumeId IS NULL — legacy single-PDF
    // mode) so existing entries keep working.
    let volumeMeta: { volumeNumber: number; label: string | null; hasPdf: boolean } | null = null
    let chunksWhere: {
      libraryEntryId: string
      pageNumber: number
      volumeId?: string | null
    } = { libraryEntryId: id, pageNumber: page }

    if (volumeId) {
      const volume = await prisma.libraryEntryVolume.findFirst({
        where: { id: volumeId, libraryEntryId: id },
        select: { id: true, volumeNumber: true, label: true, filePath: true },
      })
      if (!volume) {
        return NextResponse.json({ error: 'Volume not found' }, { status: 404 })
      }
      volumeMeta = {
        volumeNumber: volume.volumeNumber,
        label: volume.label,
        hasPdf: Boolean(volume.filePath),
      }
      chunksWhere = { libraryEntryId: id, pageNumber: page, volumeId: volume.id }
    } else {
      chunksWhere = { libraryEntryId: id, pageNumber: page, volumeId: null }
    }

    const chunks = await prisma.libraryChunk.findMany({
      where: chunksWhere,
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
        hasPdf: volumeMeta ? volumeMeta.hasPdf : Boolean(entry.filePath),
      },
      volume: volumeMeta,
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
