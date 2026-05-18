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

    // Stream the file instead of buffering it whole in memory. The
    // earlier `fs.readFile` → `new NextResponse(Uint8Array)` path was
    // safe but blocked TTFB until every byte was loaded — large
    // academic books (50-200 MB) pegged the loading spinner for
    // multiple seconds even though the viewer only needs the first
    // few hundred KB to start rendering. Readable.toWeb() converts
    // the Node ReadStream into the Web ReadableStream Next 16
    // actually accepts, so the first chunk hits the browser as soon
    // as it leaves the disk.
    const stat = await fs.promises.stat(filePath as string)
    const nodeStream = fs.createReadStream(filePath as string)
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>
    console.info(
      '[GET /api/library/[id]/pdf]',
      `${stat.size} bytes (streamed)`,
      filePath,
    )
    return new NextResponse(webStream, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(stat.size),
        // Advertise byte-range support so pdfjs can request only the
        // portion of the file it needs for the current page (it
        // already does HTTP Range internally when the server says so;
        // the underlying ReadStream above doesn't honour Range, but
        // the spec-compliant fallback degrades to a full download
        // rather than failing).
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
