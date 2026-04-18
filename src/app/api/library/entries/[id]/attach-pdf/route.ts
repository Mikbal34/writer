import { NextRequest, NextResponse } from 'next/server'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { startLibraryEmbedBatch } from '@/lib/library-pipeline'

const UPLOADS_DIR = path.join(process.cwd(), 'uploads')
const LIBRARY_DIR = path.join(UPLOADS_DIR, 'library')
const MAX_BYTES = 50 * 1024 * 1024 // 50 MB

function safeSlug(str: string, max = 80): string {
  return str
    .replace(/[^a-zA-Z0-9_\u00C0-\u024F\u0400-\u04FF\u0600-\u06FF-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, max)
}

type RouteContext = { params: Promise<{ id: string }> }

/**
 * POST /api/library/entries/:id/attach-pdf
 * multipart/form-data: field "file" = PDF
 * Attaches the uploaded PDF to an existing LibraryEntry owned by the caller.
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

    const userDir = path.join(LIBRARY_DIR, session.user.id)
    await mkdir(userDir, { recursive: true })
    const safeName = safeSlug(`${entry.authorSurname}_${entry.title}`)
    const filename = `${entry.id}_${safeName}.pdf`
    const fullPath = path.join(userDir, filename)
    await writeFile(fullPath, bytes)

    const relPath = path.relative(process.cwd(), fullPath)

    // File is on disk — flip to "extracting" and hand off to the background
    // pipeline (chunks + embeddings). Status becomes 'ready' once the chunks
    // are embedded and persisted, so the caller should poll /pdf-status.
    const updated = await prisma.libraryEntry.update({
      where: { id: entry.id },
      data: {
        filePath: relPath,
        fileType: 'pdf',
        pdfStatus: 'extracting',
        pdfError: null,
      },
      select: { id: true, pdfStatus: true, filePath: true },
    })

    startLibraryEmbedBatch([{ entryId: entry.id, filePath: fullPath }])

    return NextResponse.json(updated)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library/entries/:id/attach-pdf]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
