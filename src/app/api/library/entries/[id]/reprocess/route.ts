import { NextRequest, NextResponse } from 'next/server'
import path from 'node:path'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { startLibraryEmbedBatch, downloadLibraryPdf } from '@/lib/library-pipeline'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * POST /api/library/entries/:id/reprocess
 * Re-runs the chunk+embed pipeline for a library entry that already has a
 * PDF on disk, or retries a failed download if only openAccessUrl is set.
 */
export async function POST(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const entry = await prisma.libraryEntry.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true, filePath: true, openAccessUrl: true },
    })
    if (!entry) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
    }

    if (entry.filePath) {
      const fullPath = path.join(process.cwd(), entry.filePath)
      await prisma.libraryEntry.update({
        where: { id },
        data: { pdfStatus: 'extracting', pdfError: null },
      })
      startLibraryEmbedBatch([{ entryId: id, filePath: fullPath }])
      return NextResponse.json({ status: 'extracting' })
    }

    if (entry.openAccessUrl) {
      await prisma.libraryEntry.update({
        where: { id },
        data: { pdfStatus: 'pending', pdfError: null },
      })
      setImmediate(() => {
        downloadLibraryPdf(id, entry.openAccessUrl!).catch((err) => {
          console.error('[reprocess] download failed:', id, err)
        })
      })
      return NextResponse.json({ status: 'pending' })
    }

    return NextResponse.json(
      { error: 'No PDF available — upload one via attach-pdf first' },
      { status: 400 }
    )
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library/entries/:id/reprocess]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
