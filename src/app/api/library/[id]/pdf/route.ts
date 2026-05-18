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
import fs from 'node:fs'
import { Readable } from 'node:stream'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { pdfExists } from '@/lib/library-storage'

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
      // New entries keep bytes on LibraryEntryVolume rows and leave
      // LibraryEntry.filePath null. When callers (chat sources panel,
      // BookHero "open in tab", etc.) don't pass ?volume=, fall back
      // to the entry's earliest volume so a single-volume upload still
      // streams without forcing every caller to plumb volumeId.
      if (!pdfExists(filePath) && entry) {
        const firstVolume = await prisma.libraryEntryVolume.findFirst({
          where: { libraryEntryId: id },
          orderBy: { createdAt: 'asc' },
          select: { filePath: true },
        })
        filePath = firstVolume?.filePath ?? null
      }
    }

    if (!pdfExists(filePath)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const stat = await fs.promises.stat(filePath as string)
    const fileSize = stat.size

    // Honour HTTP Range requests — pdfjs issues them aggressively
    // when it sees Accept-Ranges: bytes, fetching only the bytes
    // for the current page instead of the whole document. Without
    // proper Range handling pdfjs ends up with a malformed view of
    // the file (got 200 + full body when it expected 206 + slice)
    // and the canvas never renders even though numPages is known.
    const rangeHeader = req.headers.get('range')
    if (rangeHeader) {
      const m = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader)
      if (m) {
        const start = parseInt(m[1], 10)
        const end = m[2] ? parseInt(m[2], 10) : fileSize - 1
        if (
          Number.isFinite(start) &&
          Number.isFinite(end) &&
          start >= 0 &&
          end < fileSize &&
          start <= end
        ) {
          const chunk = fs.createReadStream(filePath as string, { start, end })
          const webStream = Readable.toWeb(chunk) as unknown as ReadableStream<Uint8Array>
          return new NextResponse(webStream, {
            status: 206,
            headers: {
              'Content-Type': 'application/pdf',
              'Content-Length': String(end - start + 1),
              'Content-Range': `bytes ${start}-${end}/${fileSize}`,
              'Accept-Ranges': 'bytes',
              'Cache-Control': 'private, max-age=3600',
            },
          })
        }
      }
      // Malformed Range → 416 per spec.
      return new NextResponse(null, {
        status: 416,
        headers: {
          'Content-Range': `bytes */${fileSize}`,
        },
      })
    }

    // No Range header → stream the whole file. Readable.toWeb()
    // gives us the Web ReadableStream shape Next 16 actually
    // accepts, so the first chunk hits the wire as soon as it leaves
    // the disk instead of waiting for fs.readFile to load the entire
    // 50-200 MB academic book into memory first.
    const nodeStream = fs.createReadStream(filePath as string)
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>
    console.info(
      '[GET /api/library/[id]/pdf]',
      `${fileSize} bytes (streamed, full)`,
      filePath,
    )
    return new NextResponse(webStream, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(fileSize),
        'Accept-Ranges': 'bytes',
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
