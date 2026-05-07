/**
 * GET /api/library/[id]/pdf
 *
 * Streams the original uploaded PDF for an entry the caller owns.
 * Used by the citation verification panel's PDF viewer to render the
 * exact source page. 404 when the entry has no persisted file (older
 * uploads from before durable storage was wired up).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { pdfExists, openPdfStream } from '@/lib/library-storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const entry = await prisma.libraryEntry.findFirst({
      where: { id, userId: session.user.id },
      select: { filePath: true },
    })
    if (!entry || !pdfExists(entry.filePath)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const stream = openPdfStream(entry.filePath as string)
    return new NextResponse(stream as unknown as ReadableStream, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/library/[id]/pdf]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
