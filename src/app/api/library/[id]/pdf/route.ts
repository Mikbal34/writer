/**
 * GET /api/library/[id]/pdf
 *
 * Streams the PDF for an entry (or one of its volumes) that the
 * caller owns. Volume selection is via `?volume=<volumeId>` query
 * param; without it we serve the entry's primary filePath (legacy
 * single-volume behaviour).
 *
 * 404 when the requested file isn't on disk — older uploads from
 * before durable storage was wired up have null filePaths.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { pdfExists, openPdfStream } from '@/lib/library-storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params
    const url = new URL(req.url)
    const volumeId = url.searchParams.get('volume')

    let filePath: string | null = null
    if (volumeId) {
      const volume = await prisma.libraryEntryVolume.findFirst({
        where: {
          id: volumeId,
          libraryEntryId: id,
          libraryEntry: { userId: session.user.id },
        },
        select: { filePath: true },
      })
      filePath = volume?.filePath ?? null
    } else {
      const entry = await prisma.libraryEntry.findFirst({
        where: { id, userId: session.user.id },
        select: { filePath: true },
      })
      filePath = entry?.filePath ?? null
    }

    if (!pdfExists(filePath)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const stream = openPdfStream(filePath as string)
    return new NextResponse(stream as unknown as ReadableStream, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/library/[id]/pdf]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
