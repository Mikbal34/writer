/**
 * /api/library/[id]/volumes
 *
 * GET  → list the entry's volumes (id, volumeNumber, label, pdfStatus, totalPages)
 * POST → upload a PDF as a new volume of this entry. Multipart form:
 *        - file        (required) the PDF
 *        - volumeNumber (optional) — auto-assigned next-free if omitted
 *        - label        (optional) — human-readable e.g. "Hicret Öncesi"
 *
 * Each volume gets a fresh LibraryEntryVolume row + a fire-and-forget
 * call to processLibraryVolumePdfFromBytes which extracts and embeds
 * just that volume's chunks (volumeId-tagged).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { saveVolumePdfBytesR2 } from '@/lib/r2-storage'
import { enqueueIngest } from '@/lib/queue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 50 * 1024 * 1024

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const entry = await prisma.libraryEntry.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    })
    if (!entry) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const volumes = await prisma.libraryEntryVolume.findMany({
      where: { libraryEntryId: id },
      orderBy: { volumeNumber: 'asc' },
      select: {
        id: true,
        volumeNumber: true,
        label: true,
        pdfStatus: true,
        pdfError: true,
        totalPages: true,
        filePath: true,
        fileType: true,
        createdAt: true,
      },
    })
    // Hide raw filesystem paths from the client; just send a flag.
    return NextResponse.json({
      volumes: volumes.map((v) => ({
        id: v.id,
        volumeNumber: v.volumeNumber,
        label: v.label,
        pdfStatus: v.pdfStatus,
        pdfError: v.pdfError,
        totalPages: v.totalPages,
        hasPdf: Boolean(v.filePath),
        fileType: v.fileType,
        createdAt: v.createdAt,
      })),
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/library/[id]/volumes]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const entry = await prisma.libraryEntry.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    })
    if (!entry) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const form = await req.formData()
    const file = form.get('file')
    const labelRaw = form.get('label')
    const volumeNumberRaw = form.get('volumeNumber')

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file field is required' }, { status: 400 })
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'file is empty' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'file larger than 50 MB' }, { status: 413 })
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

    const bytes = Buffer.from(await file.arrayBuffer())
    if (bytes.length < 1024) {
      return NextResponse.json({ error: 'Dosya geçerli görünmüyor (çok küçük)' }, { status: 400 })
    }

    // Auto-assign next-free volume number when caller omits it.
    let volumeNumber: number
    const parsed = typeof volumeNumberRaw === 'string' ? parseInt(volumeNumberRaw, 10) : NaN
    if (Number.isFinite(parsed) && parsed > 0) {
      volumeNumber = Math.floor(parsed)
    } else {
      const tail = await prisma.libraryEntryVolume.findFirst({
        where: { libraryEntryId: id },
        orderBy: { volumeNumber: 'desc' },
        select: { volumeNumber: true },
      })
      volumeNumber = (tail?.volumeNumber ?? 0) + 1
    }

    const label =
      typeof labelRaw === 'string' && labelRaw.trim().length > 0
        ? labelRaw.trim()
        : null

    let volume
    try {
      volume = await prisma.libraryEntryVolume.create({
        data: {
          libraryEntryId: id,
          volumeNumber,
          label,
          pdfStatus: 'queued',
          fileType: detectedType,
        },
        select: { id: true, volumeNumber: true, label: true, pdfStatus: true },
      })
    } catch (err) {
      if (
        typeof err === 'object' &&
        err &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        return NextResponse.json(
          { error: `Cilt ${volumeNumber} zaten var` },
          { status: 409 },
        )
      }
      throw err
    }

    // Store in R2 FIRST — the worker reads the volume back by filePath,
    // so this is required (fail the upload if storage fails).
    try {
      const filePath = await saveVolumePdfBytesR2(
        session.user.id,
        id,
        volume.id,
        bytes,
        detectedType,
      )
      await prisma.libraryEntryVolume.update({
        where: { id: volume.id },
        data: { filePath },
      })
    } catch (err) {
      console.error('[volumes/POST] R2 persistence failed:', volume.id, err)
      await prisma.libraryEntryVolume.update({
        where: { id: volume.id },
        data: { pdfStatus: 'failed', pdfError: 'Dosya depolanamadı (R2)' },
      })
      return NextResponse.json({ error: 'storage failed' }, { status: 502 })
    }

    await enqueueIngest({
      kind: 'volume',
      entryId: id,
      volumeId: volume.id,
      filename: file.name || `cilt-${volumeNumber}.pdf`,
    })

    return NextResponse.json(volume)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library/[id]/volumes]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
