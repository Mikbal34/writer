import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { processLibraryPdfFromBytes } from '@/lib/library-pipeline'

const MAX_BYTES = 50 * 1024 * 1024 // 50 MB

type RouteContext = { params: Promise<{ id: string }> }

/**
 * POST /api/library/entries/:id/attach-pdf
 * multipart/form-data: field "file" = PDF
 *
 * Forwards the raw bytes to the Python service for extraction + chunking.
 * Writer-agent-app has no persistent filesystem on Railway, so we do not
 * store the PDF locally — chunks + embeddings live in the DB.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const entry = await prisma.libraryEntry.findFirst({
      where: { id, userId: session.user.id },
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

    const updated = await prisma.libraryEntry.update({
      where: { id: entry.id },
      data: { pdfStatus: 'extracting', pdfError: null },
      select: { id: true, pdfStatus: true },
    })

    // Fire-and-forget: forward bytes to Python, embed, persist.
    setImmediate(() => {
      processLibraryPdfFromBytes(entry.id, file.name || 'upload.pdf', bytes).catch((err) => {
        console.error('[attach-pdf] pipeline failed:', entry.id, err)
      })
    })

    return NextResponse.json(updated)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library/entries/:id/attach-pdf]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
