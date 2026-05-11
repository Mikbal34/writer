/**
 * POST /api/library/[id]/dismiss-volume-hint
 *
 * The library banner ("Bu, X'in N. cildi olabilir") nags the user
 * until they either resolve it via promote-to-volume or explicitly
 * dismiss it. This sets metadata.volumeHintDismissed so the banner
 * disappears for that entry across reloads.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const entry = await prisma.libraryEntry.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true, metadata: true },
    })
    if (!entry) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const current = (entry.metadata as Prisma.JsonObject | null) ?? {}
    const next: Prisma.JsonObject = {
      ...current,
      volumeHintDismissed: true,
    }

    await prisma.libraryEntry.update({
      where: { id },
      data: { metadata: next as Prisma.InputJsonValue },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library/[id]/dismiss-volume-hint]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
