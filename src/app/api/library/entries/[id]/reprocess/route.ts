import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { enqueueIngest } from '@/lib/queue'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * POST /api/library/entries/:id/reprocess
 * Re-runs the chunk+embed pipeline via the worker queue. Clears the
 * entry-level chunks first so the worker does a FRESH extraction
 * (runIngestJob resumes embedding when chunks already exist, so a
 * reprocess must start from an empty slate). The worker reads the
 * stored R2 file, or re-downloads openAccessUrl for URL-only entries.
 */
export async function POST(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const entry = await prisma.libraryEntry.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true, openAccessUrl: true, filePath: true },
    })
    if (!entry) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
    }
    if (!entry.filePath && !entry.openAccessUrl) {
      return NextResponse.json(
        { error: 'No stored file and no open-access URL — re-upload the PDF via attach-pdf.' },
        { status: 400 },
      )
    }

    // Fresh slate: drop entry-level chunks so the worker re-extracts
    // instead of resuming the embed of stale chunks.
    await prisma.libraryChunk.deleteMany({ where: { libraryEntryId: id, volumeId: null } })
    await prisma.libraryEntry.update({
      where: { id }, data: { pdfStatus: 'queued', pdfError: null },
    })
    await enqueueIngest({ kind: 'entry', entryId: id })

    return NextResponse.json({ status: 'queued' })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library/entries/:id/reprocess]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
