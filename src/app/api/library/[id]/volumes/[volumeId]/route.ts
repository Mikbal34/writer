/**
 * /api/library/[id]/volumes/[volumeId]
 *
 * DELETE → drop the volume row, its chunks (cascade), and unlink the PDF.
 *           Doesn't touch the parent LibraryEntry.
 *
 * GET → returns the single volume's metadata + a streamable indicator.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { deletePdf } from '@/lib/library-storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string; volumeId: string }> }

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id, volumeId } = await ctx.params

    const volume = await prisma.libraryEntryVolume.findFirst({
      where: {
        id: volumeId,
        libraryEntryId: id,
        libraryEntry: { userId: session.user.id },
      },
      select: {
        id: true,
        volumeNumber: true,
        label: true,
        pdfStatus: true,
        totalPages: true,
        filePath: true,
      },
    })
    if (!volume) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({
      id: volume.id,
      volumeNumber: volume.volumeNumber,
      label: volume.label,
      pdfStatus: volume.pdfStatus,
      totalPages: volume.totalPages,
      hasPdf: Boolean(volume.filePath),
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET volume]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id, volumeId } = await ctx.params

    const volume = await prisma.libraryEntryVolume.findFirst({
      where: {
        id: volumeId,
        libraryEntryId: id,
        libraryEntry: { userId: session.user.id },
      },
      select: { id: true, filePath: true },
    })
    if (!volume) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    await prisma.libraryEntryVolume.delete({ where: { id: volume.id } })
    await deletePdf(volume.filePath)

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[DELETE volume]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
