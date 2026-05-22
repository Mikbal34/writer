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
import { pdfExists, getPdfBytes } from '@/lib/library-storage'

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
      if (!(await pdfExists(filePath)) && entry) {
        const firstVolume = await prisma.libraryEntryVolume.findFirst({
          where: { libraryEntryId: id },
          orderBy: { createdAt: 'asc' },
          select: { filePath: true },
        })
        filePath = firstVolume?.filePath ?? null
      }
    }

    if (!(await pdfExists(filePath))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Back to the buffered response: load the whole file into
    // memory and hand pdfjs a Uint8Array. Streaming via
    // Readable.toWeb cut TTFB but silently corrupted large PDFs
    // (50 MB books opened with numPages=0 or "Invalid PDF
    // structure"), even though the same files parsed fine when
    // loaded directly by pdfjs in the container. Container-side
    // pdfjs proved the files are sound, so the streaming layer is
    // what's losing data — most likely Railway's edge proxy
    // truncating long chunked responses.
    //
    // Buffering is the slow-but-reliable path. Modest perf cost
    // (TTFB grows with file size) trades for "every PDF opens
    // every time", which we need before any further optimization.
    // A proper HTTP Range handler can win the performance back
    // later without breaking reliability.
    const bytes = await getPdfBytes(filePath as string)
    console.info(
      '[GET /api/library/[id]/pdf]',
      `${bytes.byteLength} bytes (R2)`,
      filePath,
    )
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(bytes.byteLength),
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
