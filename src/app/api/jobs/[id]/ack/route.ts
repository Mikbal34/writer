import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * POST /api/jobs/:id/ack
 * Mark a finished job as acknowledged (hides its completion toast).
 */
export async function POST(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const result = await prisma.backgroundJob.updateMany({
      where: { id, userId: session.user.id },
      data: { acknowledged: true },
    })
    if (result.count === 0) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/jobs/:id/ack]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
