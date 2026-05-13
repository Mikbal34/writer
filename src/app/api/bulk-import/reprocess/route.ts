/**
 * POST /api/bulk-import/reprocess
 *
 * Static-token reprocess for ciltler that failed during the initial
 * import run. Body: { volumeId }. Reads the persisted bytes (saved by
 * /api/bulk-import/cilt) and re-runs the volume pipeline.
 *
 * Returns 202 immediately; the pipeline runs in the background. The
 * caller should poll /api/bulk-import/volume-status to detect when the
 * cilt settles into ready or fails again.
 *
 * GET also supported on this path with ?action=list&userId=… to list
 * the target user's currently-failed ciltler — saves the script a DB
 * trip and keeps secrets out of the client.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { reprocessLibraryVolume } from '@/lib/library-pipeline'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function authorized(req: NextRequest): boolean {
  const expected = process.env.ADMIN_BULK_IMPORT_TOKEN
  if (!expected) return false
  return req.headers.get('x-admin-token') === expected
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const body = (await req.json()) as { volumeId?: string }
    if (!body.volumeId) {
      return NextResponse.json({ error: 'volumeId gerekli' }, { status: 400 })
    }

    const volume = await prisma.libraryEntryVolume.findUnique({
      where: { id: body.volumeId },
      select: { id: true, libraryEntryId: true, filePath: true },
    })
    if (!volume) {
      return NextResponse.json({ error: 'Cilt bulunamadı' }, { status: 404 })
    }
    if (!volume.filePath) {
      return NextResponse.json(
        { error: 'filePath yok — yeniden yüklenmeli' },
        { status: 409 },
      )
    }

    await prisma.libraryEntryVolume.update({
      where: { id: volume.id },
      data: { pdfStatus: 'pending', pdfError: null },
    })

    setImmediate(() => {
      reprocessLibraryVolume(volume.libraryEntryId, volume.id).catch((err) => {
        console.error('[bulk-import/reprocess] failed:', volume.id, err)
      })
    })

    return NextResponse.json({ ok: true }, { status: 202 })
  } catch (err) {
    console.error('[POST /api/bulk-import/reprocess]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const url = new URL(req.url)
    const action = url.searchParams.get('action')
    const userId = url.searchParams.get('userId')

    if (action === 'list-failed') {
      if (!userId) {
        return NextResponse.json({ error: 'userId gerekli' }, { status: 400 })
      }
      const volumes = await prisma.libraryEntryVolume.findMany({
        where: {
          libraryEntry: { userId },
          pdfStatus: 'failed',
          filePath: { not: null },
        },
        orderBy: [{ libraryEntryId: 'asc' }, { volumeNumber: 'asc' }],
        select: {
          id: true,
          libraryEntryId: true,
          volumeNumber: true,
          pdfError: true,
          libraryEntry: { select: { title: true, authorSurname: true } },
        },
      })
      return NextResponse.json({
        volumes: volumes.map((v) => ({
          id: v.id,
          entryId: v.libraryEntryId,
          volumeNumber: v.volumeNumber,
          pdfError: v.pdfError,
          title: v.libraryEntry.title,
          authorSurname: v.libraryEntry.authorSurname,
        })),
      })
    }

    if (action === 'status') {
      const volumeId = url.searchParams.get('volumeId')
      if (!volumeId) {
        return NextResponse.json({ error: 'volumeId gerekli' }, { status: 400 })
      }
      const v = await prisma.libraryEntryVolume.findUnique({
        where: { id: volumeId },
        select: { id: true, pdfStatus: true, pdfError: true },
      })
      if (!v) {
        return NextResponse.json({ error: 'Cilt bulunamadı' }, { status: 404 })
      }
      return NextResponse.json(v)
    }

    if (action === 'inflight') {
      // Per-user count of ciltler still going through the pipeline.
      // The retry script blocks until this returns 0 so we don't kick
      // a new cilt while Python is still chewing the last one.
      if (!userId) {
        return NextResponse.json({ error: 'userId gerekli' }, { status: 400 })
      }
      const count = await prisma.libraryEntryVolume.count({
        where: {
          libraryEntry: { userId },
          pdfStatus: { in: ['pending', 'downloading', 'extracting', 'embedding'] },
        },
      })
      return NextResponse.json({ inflight: count })
    }

    return NextResponse.json(
      { error: 'action=list-failed veya action=status gerekli' },
      { status: 400 },
    )
  } catch (err) {
    console.error('[GET /api/bulk-import/reprocess]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
