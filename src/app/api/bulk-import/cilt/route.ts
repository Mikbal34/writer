/**
 * POST /api/bulk-import/cilt
 *
 * Static-token counterpart of POST /api/library/[id]/volumes used by
 * scripts/admin/bulk-import-classical.ts. Accepts a multipart form
 * with file + entryId + volumeNumber + optional label, persists the
 * bytes via saveVolumePdfBytes, then fires the volume pipeline.
 *
 * Lives outside /api/admin/* (proxy.ts session gate). Differences
 * from the public volumes route:
 *   - X-Admin-Token header instead of session auth.
 *   - 200 MB byte limit (vs. 50 MB) so >50 MB classical works don't
 *     need to be pre-compressed.
 *   - Returns 200 on existing (entryId, volumeNumber) instead of 409
 *     so re-runs after partial failure don't blow up; the prior cilt
 *     is reprocessed against the new bytes.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { saveVolumePdfBytesR2 } from '@/lib/r2-storage'
import { enqueueIngest } from '@/lib/queue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 200 * 1024 * 1024

function authorized(req: NextRequest): boolean {
  const expected = process.env.ADMIN_BULK_IMPORT_TOKEN
  if (!expected) return false
  return req.headers.get('x-admin-token') === expected
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const form = await req.formData()
    const file = form.get('file')
    const entryId = form.get('entryId')
    const volumeNumberRaw = form.get('volumeNumber')
    const labelRaw = form.get('label')

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file gerekli' }, { status: 400 })
    }
    if (typeof entryId !== 'string' || !entryId) {
      return NextResponse.json({ error: 'entryId gerekli' }, { status: 400 })
    }
    if (typeof volumeNumberRaw !== 'string') {
      return NextResponse.json({ error: 'volumeNumber gerekli' }, { status: 400 })
    }
    const volumeNumber = parseInt(volumeNumberRaw, 10)
    if (!Number.isFinite(volumeNumber) || volumeNumber < 1) {
      return NextResponse.json({ error: 'volumeNumber 1+ olmalı' }, { status: 400 })
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'Dosya boş' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `Dosya ${MAX_BYTES / 1024 / 1024}MB sınırını aştı` },
        { status: 413 },
      )
    }

    const lowerName = file.name.toLowerCase()
    let detectedType: 'pdf' | 'epub' | 'docx' | null = null
    if (lowerName.endsWith('.pdf')) detectedType = 'pdf'
    else if (lowerName.endsWith('.epub')) detectedType = 'epub'
    else if (lowerName.endsWith('.docx')) detectedType = 'docx'
    if (!detectedType) {
      return NextResponse.json(
        { error: 'Sadece .pdf / .epub / .docx kabul edilir' },
        { status: 400 },
      )
    }

    const entry = await prisma.libraryEntry.findUnique({
      where: { id: entryId },
      select: { id: true, userId: true },
    })
    if (!entry) {
      return NextResponse.json({ error: 'Entry bulunamadı' }, { status: 404 })
    }

    const label = typeof labelRaw === 'string' && labelRaw.trim().length > 0
      ? labelRaw.trim()
      : null

    const bytes = Buffer.from(await file.arrayBuffer())

    // Re-run path: if (entry, volumeNumber) already exists we treat
    // this as "replace bytes + re-process" instead of erroring. Makes
    // the script idempotent across retries.
    const prior = await prisma.libraryEntryVolume.findFirst({
      where: { libraryEntryId: entryId, volumeNumber },
      select: { id: true },
    })
    const volumeId: string = prior
      ? (await prisma.libraryEntryVolume.update({
          where: { id: prior.id },
          data: {
            label,
            fileType: detectedType,
            pdfStatus: 'queued',
            pdfError: null,
          },
          select: { id: true },
        })).id
      : (await prisma.libraryEntryVolume.create({
          data: {
            libraryEntryId: entryId,
            volumeNumber,
            label,
            pdfStatus: 'queued',
            fileType: detectedType,
          },
          select: { id: true },
        })).id

    // Store in R2 (required — worker reads it back by filePath).
    try {
      const filePath = await saveVolumePdfBytesR2(
        entry.userId,
        entryId,
        volumeId,
        bytes,
        detectedType,
      )
      await prisma.libraryEntryVolume.update({
        where: { id: volumeId },
        data: { filePath },
      })
    } catch (err) {
      console.error('[admin/bulk-import/cilt] R2 persist failed:', volumeId, err)
      await prisma.libraryEntryVolume.update({
        where: { id: volumeId },
        data: { pdfStatus: 'failed', pdfError: 'Dosya depolanamadı (R2)' },
      })
      return NextResponse.json({ error: 'storage failed' }, { status: 502 })
    }

    // Re-run on an existing cilt: clear its chunks so the worker
    // re-extracts the replaced bytes instead of resuming a stale embed.
    await prisma.libraryChunk.deleteMany({ where: { volumeId } })
    await enqueueIngest(
      {
        kind: 'volume',
        entryId,
        volumeId,
        filename: file.name || `cilt-${volumeNumber}.pdf`,
      },
      { batch: true },
    )

    return NextResponse.json({ volumeId, volumeNumber })
  } catch (err) {
    console.error('[admin/bulk-import/cilt]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
