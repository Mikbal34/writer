/**
 * POST /api/library/[id]/confirm-volume
 *
 * Direct-to-R2 cilt upload, step 2 of 2. Browser already PUT the
 * file to R2; we verify it landed and enqueue the volume-ingest job.
 *
 * Body: { volumeId }
 *
 * Response: { status: 'queued' } or { status: 'failed', reason }
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { pdfExistsR2 } from '@/lib/r2-storage'
import { enqueueIngest } from '@/lib/queue'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id: entryId } = await ctx.params
    const { volumeId } = await req.json() as { volumeId?: string }
    if (!volumeId) {
      return NextResponse.json({ error: 'volumeId required' }, { status: 400 })
    }

    const volume = await prisma.libraryEntryVolume.findFirst({
      where: {
        id: volumeId,
        libraryEntryId: entryId,
        libraryEntry: { userId: session.user.id },
      },
      select: { id: true, filePath: true, libraryEntryId: true, volumeNumber: true },
    })
    if (!volume) {
      return NextResponse.json({ error: 'volume not found' }, { status: 404 })
    }
    if (!volume.filePath) {
      return NextResponse.json(
        { error: 'volume has no filePath (presign step skipped?)' },
        { status: 400 },
      )
    }

    // Confirm the file actually landed in R2 — browser PUT could have
    // failed mid-stream and confirm called optimistically.
    const exists = await pdfExistsR2(volume.filePath)
    if (!exists) {
      // Clean up the placeholder volume so retries can pick a fresh
      // volumeNumber without conflict.
      await prisma.libraryEntryVolume.delete({ where: { id: volumeId } }).catch(() => {})
      return NextResponse.json(
        { error: 'file not found in storage — upload may have failed' },
        { status: 400 },
      )
    }

    await prisma.libraryEntryVolume.update({
      where: { id: volumeId },
      data: { pdfStatus: 'queued' },
    })
    await enqueueIngest({ kind: 'volume', entryId, volumeId })

    return NextResponse.json({ status: 'queued', volumeId })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library/[id]/confirm-volume]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
