/**
 * /api/series/[id] — rename / describe / delete a series.
 *
 * DELETE doesn't drop the underlying projects. The Project.seriesId FK
 * is `onDelete: SetNull`, so each volume becomes a standalone project
 * again and shows up in the home page's standalone block.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params
    const body = (await req.json().catch(() => ({}))) as {
      name?: string
      description?: string | null
    }

    const existing = await prisma.series.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const data: { name?: string; description?: string | null } = {}
    if (typeof body.name === 'string') {
      const name = body.name.trim()
      if (!name) {
        return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
      }
      data.name = name
    }
    if (body.description !== undefined) {
      data.description = body.description?.trim() || null
    }

    try {
      const series = await prisma.series.update({
        where: { id },
        data,
        select: { id: true, name: true, description: true },
      })
      return NextResponse.json(series)
    } catch (err) {
      if (
        typeof err === 'object' &&
        err &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        return NextResponse.json(
          { error: 'Bu isimde bir seri zaten var' },
          { status: 409 },
        )
      }
      throw err
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[PATCH /api/series/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const existing = await prisma.series.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    await prisma.series.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[DELETE /api/series/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
