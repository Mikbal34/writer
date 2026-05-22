import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { savePdfBytesR2 } from '@/lib/r2-storage'
import { enqueueIngest } from '@/lib/queue'

const MAX_BYTES = 50 * 1024 * 1024 // 50 MB

type RouteContext = { params: Promise<{ id: string }> }

/**
 * POST /api/library/entries/:id/attach-pdf
 * multipart/form-data: field "file" = PDF
 *
 * Stores the PDF in R2 and enqueues a fresh ingest (extract → chunk →
 * embed) on the worker. Stale entry-level chunks are cleared first so
 * the worker re-extracts rather than resuming an old embed.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const entry = await prisma.libraryEntry.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    })
    if (!entry) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
    }

    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file field is required' }, { status: 400 })
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'file is empty' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'file larger than 50 MB' }, { status: 413 })
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    if (bytes.length < 1024) {
      return NextResponse.json({ error: 'PDF too small to be valid' }, { status: 400 })
    }

    let filePath: string
    try {
      filePath = await savePdfBytesR2(session.user.id, entry.id, bytes, 'pdf')
    } catch (err) {
      console.error('[attach-pdf] R2 persistence failed:', entry.id, err)
      return NextResponse.json({ error: 'storage failed' }, { status: 502 })
    }

    await prisma.libraryChunk.deleteMany({ where: { libraryEntryId: entry.id, volumeId: null } })
    const updated = await prisma.libraryEntry.update({
      where: { id: entry.id },
      data: { filePath, fileType: 'pdf', pdfStatus: 'queued', pdfError: null },
      select: { id: true, pdfStatus: true },
    })
    await enqueueIngest({ kind: 'entry', entryId: entry.id, filename: file.name || 'upload.pdf' })

    return NextResponse.json(updated)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library/entries/:id/attach-pdf]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
