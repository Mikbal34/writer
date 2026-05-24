/**
 * POST /api/library/[id]/presign-volume
 *
 * Direct-to-R2 cilt (multi-volume) upload, step 1 of 2. Creates a
 * LibraryEntryVolume row and returns a signed PUT URL the browser
 * uses to upload the file directly to R2. Same pattern as standalone
 * /presign-upload but tied to a parent entry as a volume.
 *
 * Body: {
 *   filename: string,
 *   size: number,
 *   volumeNumber: number,    // 1-based ordering
 *   label?: string,          // optional subtitle for this volume
 * }
 *
 * Response: { volumeId, uploadUrl, contentType }
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { presignVolumeUploadUrl } from '@/lib/r2-storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BYTES = 500 * 1024 * 1024 // 500 MB — academic norms

function fileTypeFromName(filename: string): 'pdf' | 'epub' | 'docx' | null {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.epub')) return 'epub'
  if (lower.endsWith('.docx')) return 'docx'
  return null
}

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id: entryId } = await ctx.params
    const body = await req.json() as {
      filename?: string
      size?: number
      volumeNumber?: number
      label?: string
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
      return NextResponse.json({ error: 'Sadece pdf/epub/docx kabul edilir' }, { status: 400 })
    }
    const volumeNumber = Number(body.volumeNumber)
    if (!Number.isInteger(volumeNumber) || volumeNumber < 1) {
      return NextResponse.json({ error: 'volumeNumber must be a positive integer' }, { status: 400 })
    }

    // Verify parent entry exists + belongs to user
    const entry = await prisma.libraryEntry.findFirst({
      where: { id: entryId, userId: session.user.id },
      select: { id: true },
    })
    if (!entry) {
      return NextResponse.json({ error: 'parent entry not found' }, { status: 404 })
    }

    // Create the volume row up-front so presignVolumeUploadUrl can
    // compute the canonical R2 key.
    const volume = await prisma.libraryEntryVolume.create({
      data: {
        libraryEntryId: entryId,
        volumeNumber,
        label: body.label?.trim() || null,
        pdfStatus: 'pending',
        fileType,
      },
      select: { id: true },
    })

    const { uploadUrl, filePath } = await presignVolumeUploadUrl(
      session.user.id,
      entryId,
      volume.id,
      fileType,
    )
    await prisma.libraryEntryVolume.update({
      where: { id: volume.id },
      data: { filePath },
    })

    return NextResponse.json({
      volumeId: volume.id,
      uploadUrl,
      contentType:
        fileType === 'epub' ? 'application/epub+zip'
        : fileType === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/pdf',
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library/[id]/presign-volume]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
