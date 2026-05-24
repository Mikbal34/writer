/**
 * POST /api/library/presign-upload
 *
 * Direct-to-R2 upload, step 1 of 2. Browser asks for a signed PUT URL
 * that lets it upload a file straight to Cloudflare R2 — no bytes ever
 * touch our server. Then the browser PUTs the file and calls
 * /api/library/confirm-upload to finalize.
 *
 * Body: {
 *   filename: string,            // for title derivation + extension
 *   size: number,                // byte length (for limit check)
 *   fileType?: 'pdf'|'epub'|'docx',
 *   // optional user-typed metadata (single-file path):
 *   authorSurname?, authorName?, title?, year?, publisher?, publishPlace?,
 * }
 *
 * Response: { entryId, uploadUrl, filePath } — browser PUTs file to
 * uploadUrl, then POSTs entryId to /confirm-upload to enqueue.
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { presignUploadUrl } from '@/lib/r2-storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BYTES = 500 * 1024 * 1024 // 500 MB — academic norms (Mendeley/Zotero range)
const ACCEPTED_EXTS = ['.pdf', '.epub', '.docx'] as const

function fileTypeFromName(filename: string): 'pdf' | 'epub' | 'docx' | null {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.epub')) return 'epub'
  if (lower.endsWith('.docx')) return 'docx'
  return null
}

function titleFromFilename(filename: string): string {
  const base = filename.replace(/\.(pdf|epub|docx)$/i, '').trim()
  return base.length > 0 ? base : 'Adlandırılmamış'
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()
    const body = await req.json() as {
      filename?: string
      size?: number
      authorSurname?: string
      authorName?: string
      title?: string
      year?: string
      publisher?: string
      publishPlace?: string
    }

    const filename = (body.filename ?? '').trim()
    if (!filename) {
      return NextResponse.json({ error: 'filename required' }, { status: 400 })
    }
    const size = Number(body.size ?? 0)
    if (!Number.isFinite(size) || size <= 0) {
      return NextResponse.json({ error: 'size required' }, { status: 400 })
    }
    if (size < 1024) {
      return NextResponse.json({ error: 'Dosya çok küçük' }, { status: 400 })
    }
    if (size > MAX_BYTES) {
      return NextResponse.json({ error: 'file larger than 500 MB' }, { status: 413 })
    }

    const fileType = fileTypeFromName(filename)
    if (!fileType) {
      return NextResponse.json(
        { error: `Sadece ${ACCEPTED_EXTS.join(' / ')} kabul edilir` },
        { status: 400 },
      )
    }

    const userAuthorSurname = body.authorSurname?.trim() || null
    const userTitle = body.title?.trim() || null
    const placeholderSurname = `(Yükleme ${randomUUID().slice(0, 8)})`

    // Create the entry up-front so the worker can find it by id when the
    // browser confirms. fileHash will be set in /confirm-upload after the
    // browser computes it (dedup happens there too).
    const entry = await prisma.libraryEntry.create({
      data: {
        userId: session.user.id,
        entryType: 'kitap',
        title: userTitle ?? titleFromFilename(filename),
        authorSurname: userAuthorSurname ?? placeholderSurname,
        authorName: body.authorName?.trim() || null,
        year: body.year?.trim() || null,
        publisher: body.publisher?.trim() || null,
        publishPlace: body.publishPlace?.trim() || null,
        importSource: 'pdf-upload',
        pdfStatus: 'pending', // not "queued" until browser confirms
        fileType,
        keywords: [],
        metadata: { uploadSizeBytes: size },
      },
      select: { id: true },
    })

    const { uploadUrl, filePath } = await presignUploadUrl(
      session.user.id,
      entry.id,
      fileType,
    )
    // Stash filePath now so /confirm-upload doesn't need to recompute.
    await prisma.libraryEntry.update({
      where: { id: entry.id },
      data: { filePath },
    })

    return NextResponse.json({
      entryId: entry.id,
      uploadUrl,
      filePath,
      contentType:
        fileType === 'epub' ? 'application/epub+zip'
        : fileType === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/pdf',
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library/presign-upload]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
