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

    // Read into memory instead of piping a Node ReadStream — Next 16
    // no longer accepts Node Readable inside NextResponse (the
    // `stream as unknown as ReadableStream` cast silently breaks the
    // body), so the Railway edge timed the connection out and we got
    // 502 Bad Gateway on the client. PDFs in this corpus are small
    // (single-digit MB at most), so the memory hit is fine.
    const bytes = await fs.promises.readFile(filePath as string)
    console.info(
      '[GET /api/library/[id]/pdf]',
      `${bytes.byteLength} bytes`,
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
