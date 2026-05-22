/**
 * POST /api/library/upload-pdf
 *
 * One-shot drag-drop endpoint: accept a PDF, create a stub LibraryEntry
 * pre-filled from the filename, then fire-and-forget the
 * processLibraryPdfFromBytes pipeline. The pipeline runs Python text
 * extraction → chunking → Haiku metadata enrichment, so by the time
 * the user notices the row in the table the title / authorSurname /
 * year fields will have populated themselves.
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { savePdfBytesR2 } from '@/lib/r2-storage'
import { enqueueIngest } from '@/lib/queue'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BYTES = 50 * 1024 * 1024 // 50 MB — matches attach-pdf

const ACCEPTED_EXTS = ['.pdf', '.epub', '.docx'] as const

function fileTypeFromName(filename: string): 'pdf' | 'epub' | 'docx' | null {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.epub')) return 'epub'
  if (lower.endsWith('.docx')) return 'docx'
  return null
}

/** Strip the document extension and trim, fall back to a generic title. */
function titleFromFilename(filename: string): string {
  const base = filename.replace(/\.(pdf|epub|docx)$/i, '').trim()
  return base.length > 0 ? base : 'Adlandırılmamış'
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()

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
    const fileType = fileTypeFromName(file.name)
    if (!fileType) {
      return NextResponse.json(
        { error: `Sadece ${ACCEPTED_EXTS.join(' / ')} kabul edilir` },
        { status: 400 },
      )
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    if (bytes.length < 1024) {
      return NextResponse.json({ error: 'Dosya geçerli görünmüyor (çok küçük)' }, { status: 400 })
    }

    // Create a stub entry. authorSurname is required + part of the
    // (userId, authorSurname, title) unique index, so we generate a
    // short random placeholder per upload to avoid colliding when the
    // user drops two PDFs with the same filename. Haiku enrichment
    // overwrites both fields a few seconds later, so the placeholder
    // is short-lived; if extraction fails it stays as a clear marker.
    const placeholderSurname = `(Yükleme ${randomUUID().slice(0, 8)})`
    // Prod's `keywords` column is NOT NULL with no default, and the
    // pg driver adapter under Prisma 7 doesn't auto-fill String[]
    // fields — passing `[]` explicitly avoids a P2011 on insert.
    const entry = await prisma.libraryEntry.create({
      data: {
        userId: session.user.id,
        entryType: 'kitap',
        title: titleFromFilename(file.name),
        authorSurname: placeholderSurname,
        importSource: 'pdf-upload',
        pdfStatus: 'queued',
        fileType,
        keywords: [],
      },
      select: { id: true, title: true, pdfStatus: true },
    })

    // Persist the PDF to R2 FIRST — the worker reads it back by filePath,
    // so unlike the old in-process pipeline this is REQUIRED, not
    // best-effort. If storage fails there's nothing for the worker to
    // ingest, so fail the upload instead of enqueuing a doomed job.
    try {
      const filePath = await savePdfBytesR2(session.user.id, entry.id, bytes, fileType)
      await prisma.libraryEntry.update({ where: { id: entry.id }, data: { filePath } })
    } catch (err) {
      console.error('[upload-pdf] R2 persistence failed:', entry.id, err)
      await prisma.libraryEntry.update({
        where: { id: entry.id },
        data: { pdfStatus: 'failed', pdfError: 'Dosya depolanamadı (R2)' },
      })
      return NextResponse.json({ error: 'storage failed' }, { status: 502 })
    }

    // Hand off to the worker pool via the queue — returns in ms, no heavy
    // work in the web process. Worker drains with bounded concurrency.
    await enqueueIngest({ kind: 'entry', entryId: entry.id, filename: file.name || 'upload.pdf' })

    return NextResponse.json(entry)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library/upload-pdf]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
