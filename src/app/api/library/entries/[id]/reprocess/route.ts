import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import path from 'node:path'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import {
  processLibraryPdfFromBytes,
  processLibraryPdfFromUrl,
} from '@/lib/library-pipeline'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * POST /api/library/entries/:id/reprocess
 * Retries the chunk+embed pipeline. Prefers the on-disk file (so
 * manual-upload entries can reprocess without re-uploading), falls
 * back to openAccessUrl for entries that were originally pulled
 * from an open-access source.
 */
export async function POST(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const entry = await prisma.libraryEntry.findFirst({
      where: { id, userId: session.user.id },
      select: {
        id: true,
        openAccessUrl: true,
        filePath: true,
      },
    })
    if (!entry) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
    }

    if (!entry.filePath && !entry.openAccessUrl) {
      return NextResponse.json(
        {
          error:
            'No file on disk and no open-access URL — re-upload the PDF via attach-pdf.',
        },
        { status: 400 },
      )
    }

    await prisma.libraryEntry.update({
      where: { id },
      data: { pdfStatus: 'pending', pdfError: null },
    })

    setImmediate(async () => {
      try {
        // On-disk file always wins so manual uploads can reprocess
        // through the (faster, label-aware) pdfjs path. Falls back
        // to URL re-download only when the file is missing.
        if (entry.filePath) {
          const bytes = await fs.readFile(entry.filePath)
          const filename = path.basename(entry.filePath)
          await processLibraryPdfFromBytes(id, filename, bytes)
        } else if (entry.openAccessUrl) {
          await processLibraryPdfFromUrl(id, entry.openAccessUrl)
        }
      } catch (err) {
        console.error('[reprocess] pipeline failed:', id, err)
      }
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
