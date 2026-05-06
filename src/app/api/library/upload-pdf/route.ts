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
import { processLibraryPdfFromBytes } from '@/lib/library-pipeline'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BYTES = 50 * 1024 * 1024 // 50 MB — matches attach-pdf

/** Strip the .pdf extension and trim, fall back to a generic title. */
function titleFromFilename(filename: string): string {
  const base = filename.replace(/\.pdf$/i, '').trim()
  return base.length > 0 ? base : 'Adlandırılmamış PDF'
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
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Only PDF files are supported' }, { status: 400 })
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    if (bytes.length < 1024) {
      return NextResponse.json({ error: 'PDF too small to be valid' }, { status: 400 })
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
        pdfStatus: 'extracting',
        fileType: 'pdf',
        keywords: [],
      },
      select: { id: true, title: true, pdfStatus: true },
    })

    setImmediate(() => {
      processLibraryPdfFromBytes(entry.id, file.name || 'upload.pdf', bytes).catch(
        (err) => {
          console.error('[upload-pdf] pipeline failed:', entry.id, err)
        },
      )
    })

    return NextResponse.json(entry)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library/upload-pdf]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
