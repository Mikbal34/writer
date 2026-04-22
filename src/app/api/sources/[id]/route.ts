import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { unlink } from 'fs/promises'
import path from 'path'

type RouteContext = { params: Promise<{ id: string }> }

// ---------------------------------------------------------------------------
// Helper: verify source belongs to the requesting user
// ---------------------------------------------------------------------------
async function getOwnedSource(sourceId: string, userId: string) {
  return prisma.source.findFirst({
    where: {
      id: sourceId,
      project: { userId },
    },
  })
}

// GET /api/sources/[id]
// Returns the source with the total count of processed chunks.
export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const source = await prisma.source.findFirst({
      where: { id, project: { userId: session.user.id } },
      include: {
        _count: { select: { chunks: true } },
        bibliography: true,
      },
    })

    if (!source) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 })
    }

    return NextResponse.json(source)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/sources/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/sources/[id]
// Removes the source, its chunks, and the file on disk.
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const source = await getOwnedSource(id, session.user.id)
    if (!source) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 })
    }

    // Delete the physical file (best-effort – don't fail if file is missing)
    const absolutePath = path.isAbsolute(source.filePath)
      ? source.filePath
      : path.join(process.cwd(), source.filePath)

    await unlink(absolutePath).catch(() => {})

    // For every bibliography where this source is the primary, try to promote
    // the oldest remaining attachment (excluding this one) as the new primary.
    const primaryBibs = await prisma.bibliography.findMany({
      where: { sourceId: id },
      select: {
        id: true,
        sourceMappings: { select: { id: true }, take: 1 },
        attachments: {
          where: { sourceId: { not: id } },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { sourceId: true },
        },
      },
    })

    for (const bib of primaryBibs) {
      const nextSourceId = bib.attachments[0]?.sourceId ?? null
      if (nextSourceId) {
        await prisma.bibliography.update({
          where: { id: bib.id },
          data: { sourceId: nextSourceId },
        })
      } else if (bib.sourceMappings.length > 0) {
        // No attachments left but still linked to a roadmap subsection — keep the bib
        await prisma.bibliography.update({
          where: { id: bib.id },
          data: { sourceId: null },
        })
      } else {
        // No attachments and not on the roadmap — drop the orphan
        await prisma.bibliography.delete({ where: { id: bib.id } })
      }
    }

    // Delete DB record (cascades to chunks and attachments via onDelete: Cascade)
    await prisma.source.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[DELETE /api/sources/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/sources/[id]  (sub-action via query param: ?action=process)
// Triggers or re-triggers the full processing pipeline:
//   extract → chunk → embed
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const url = new URL(req.url)
    const action = url.searchParams.get('action')

    if (action !== 'process') {
      return NextResponse.json({ error: 'Unknown action. Use ?action=process' }, { status: 400 })
    }

    const source = await getOwnedSource(id, session.user.id)
    if (!source) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 })
    }

    const absolutePath = path.isAbsolute(source.filePath)
      ? source.filePath
      : path.join(process.cwd(), source.filePath)

    const pythonServiceUrl = process.env.PYTHON_SERVICE_URL ?? 'http://localhost:8001'

    const response = await fetch(`${pythonServiceUrl}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceId: source.id,
        filePath: absolutePath,
        fileType: source.fileType,
        reprocess: true,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      return NextResponse.json(
        { error: `Processing service error: ${response.status}`, details: errorText },
        { status: 502 }
      )
    }

    const result = await response.json().catch(() => ({ queued: true }))

    // Mark source as not-yet-processed while re-processing
    await prisma.source.update({
      where: { id },
      data: { processed: false },
    })

    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/sources/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
