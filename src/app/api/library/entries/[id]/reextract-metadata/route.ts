/**
 * POST /api/library/entries/:id/reextract-metadata
 *
 * Re-runs the metadata enrichment for an existing entry — useful after
 * the extraction rules improve (multilingual prompt, DOI/ISBN bypass,
 * Sonnet fallback) and old entries should benefit. Pure async: the
 * worker picks up an `enrich` job, downloads the R2 file, re-extracts
 * the front pages with pdfjs, and runs the enrich pipeline. Chunks +
 * embeddings stay untouched.
 *
 * Returns 202 immediately; the UI polls the entry to see new metadata
 * land, with `metadata.enrich.status` reflecting progress / result.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { enqueueIngest } from '@/lib/queue'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const entry = await prisma.libraryEntry.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true, filePath: true, metadata: true },
    })
    if (!entry) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
    }
    if (!entry.filePath) {
      return NextResponse.json(
        { error: 'No stored file — attach a PDF first.' },
        { status: 400 },
      )
    }

    // Mark in-flight so the UI can render a "yenileniyor" badge while
    // the worker runs. Worker overwrites with status='ok'|'failed' on
    // completion (whatever the enrich pipeline produces).
    const existingMeta =
      entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
        ? (entry.metadata as Record<string, unknown>)
        : {}
    await prisma.libraryEntry.update({
      where: { id },
      data: {
        metadata: {
          ...existingMeta,
          enrich: {
            ...(existingMeta.enrich && typeof existingMeta.enrich === 'object'
              ? (existingMeta.enrich as Record<string, unknown>)
              : {}),
            status: 'pending',
            queuedAt: new Date().toISOString(),
          },
        },
      },
    })
    await enqueueIngest({ kind: 'enrich', entryId: id })

    return NextResponse.json({ status: 'queued' }, { status: 202 })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library/entries/:id/reextract-metadata]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
