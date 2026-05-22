/**
 * POST /api/library/[id]/volumes/[volumeId]/reprocess
 *
 * Re-runs extraction + embedding against the volume's already-persisted
 * file. Used by VolumesDialog to recover ciltler that ended up in
 * 'failed' state (e.g. Python /process-bytes timeout during a bulk
 * upload) without forcing the user to re-upload bytes that are still on
 * disk.
 *
 * Returns 200 immediately; the pipeline runs in the background and
 * updates pdfStatus as it progresses (extracting → embedding → ready
 * or → failed).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { enqueueIngest } from '@/lib/queue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string; volumeId: string }> }

export async function POST(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id, volumeId } = await ctx.params

    const volume = await prisma.libraryEntryVolume.findFirst({
      where: {
        id: volumeId,
        libraryEntryId: id,
        libraryEntry: { userId: session.user.id },
      },
      select: { id: true, filePath: true },
    })
    if (!volume) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (!volume.filePath) {
      return NextResponse.json(
        { error: 'Cilt için kayıtlı dosya yok — silip yeniden yüklemen gerek' },
        { status: 409 },
      )
    }

    // Fresh slate so the worker re-extracts from the stored R2 file
    // instead of resuming the embed of stale chunks.
    await prisma.libraryChunk.deleteMany({ where: { volumeId } })
    await prisma.libraryEntryVolume.update({
      where: { id: volumeId },
      data: { pdfStatus: 'queued', pdfError: null },
    })
    await enqueueIngest({ kind: 'volume', entryId: id, volumeId })

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST volumes/reprocess]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
