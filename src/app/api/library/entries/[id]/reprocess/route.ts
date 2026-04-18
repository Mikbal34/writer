import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { processLibraryPdfFromUrl } from '@/lib/library-pipeline'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * POST /api/library/entries/:id/reprocess
 * Retries the chunk+embed pipeline for a library entry that has an
 * openAccessUrl. Manual-upload entries without openAccessUrl must be
 * re-uploaded via attach-pdf.
 */
export async function POST(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const entry = await prisma.libraryEntry.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true, openAccessUrl: true },
    })
    if (!entry) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
    }

    if (!entry.openAccessUrl) {
      return NextResponse.json(
        { error: 'No open-access URL. Upload a PDF via attach-pdf instead.' },
        { status: 400 }
      )
    }

    await prisma.libraryEntry.update({
      where: { id },
      data: { pdfStatus: 'pending', pdfError: null },
    })

    setImmediate(() => {
      processLibraryPdfFromUrl(id, entry.openAccessUrl!).catch((err) => {
        console.error('[reprocess] pipeline failed:', id, err)
      })
    })

    return NextResponse.json({ status: 'pending' })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library/entries/:id/reprocess]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
