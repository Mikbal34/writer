/**
 * /api/library/collections/[id]
 *
 * PATCH  → rename, move (parentId change), recolor.
 *          Body: { name?, parentId?, color?, sortOrder? }
 *          Moving a collection requires the new parent to belong to the same
 *          user AND to not be a descendant of this collection (cycle guard).
 *
 * DELETE → cascade — the collection and all its children disappear, and the
 *          LibraryEntryCollection junction rows are auto-deleted by Prisma's
 *          onDelete: Cascade. Entries themselves are NOT touched.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** Walk parents to detect a cycle when moving a folder into a new parent. */
async function wouldCreateCycle(
  userId: string,
  collectionId: string,
  newParentId: string | null,
): Promise<boolean> {
  if (!newParentId) return false
  if (newParentId === collectionId) return true
  let cursor: string | null = newParentId
  // Cap traversal so an accidentally orphaned cycle in DB can't hang us.
  for (let i = 0; i < 64 && cursor; i++) {
    const parent: { parentId: string | null } | null =
      await prisma.libraryCollection.findFirst({
        where: { id: cursor, userId },
        select: { parentId: true },
      })
    if (!parent) return false
    if (parent.parentId === collectionId) return true
    cursor = parent.parentId
  }
  return false
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const userId = session.user.id
    const { id } = await ctx.params
    const body = (await req.json()) as {
      name?: string
      parentId?: string | null
      color?: string | null
      sortOrder?: number
    }

    const collection = await prisma.libraryCollection.findFirst({
      where: { id, userId },
      select: { id: true, parentId: true },
    })
    if (!collection) {
      return NextResponse.json({ error: 'Bulunamadı' }, { status: 404 })
    }

    const data: Record<string, unknown> = {}
    if (body.name !== undefined) {
      const trimmed = body.name.trim()
      if (!trimmed) {
        return NextResponse.json({ error: 'Klasör adı boş olamaz' }, { status: 400 })
      }
      if (trimmed.length > 100) {
        return NextResponse.json({ error: 'Klasör adı çok uzun' }, { status: 400 })
      }
      data.name = trimmed
    }
    if (body.color !== undefined) {
      data.color = body.color
    }
    if (typeof body.sortOrder === 'number' && Number.isFinite(body.sortOrder)) {
      data.sortOrder = Math.floor(body.sortOrder)
    }
    if (body.parentId !== undefined && body.parentId !== collection.parentId) {
      if (body.parentId) {
        const newParent = await prisma.libraryCollection.findFirst({
          where: { id: body.parentId, userId },
          select: { id: true },
        })
        if (!newParent) {
          return NextResponse.json({ error: 'Hedef klasör yok' }, { status: 404 })
        }
        if (await wouldCreateCycle(userId, id, body.parentId)) {
          return NextResponse.json(
            { error: 'Klasör kendi alt-klasörüne taşınamaz' },
            { status: 400 },
          )
        }
      }
      data.parentId = body.parentId
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ ok: true })
    }

    try {
      const updated = await prisma.libraryCollection.update({
        where: { id },
        data,
      })
      return NextResponse.json({
        id: updated.id,
        parentId: updated.parentId,
        name: updated.name,
        color: updated.color,
        sortOrder: updated.sortOrder,
      })
    } catch (err) {
      if (
        typeof err === 'object' &&
        err &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        return NextResponse.json(
          { error: 'Bu adla bir klasör bu seviyede zaten var' },
          { status: 409 },
        )
      }
      throw err
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[PATCH /api/library/collections/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const userId = session.user.id
    const { id } = await ctx.params

    const collection = await prisma.libraryCollection.findFirst({
      where: { id, userId },
      select: { id: true },
    })
    if (!collection) {
      return NextResponse.json({ error: 'Bulunamadı' }, { status: 404 })
    }

    await prisma.libraryCollection.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[DELETE /api/library/collections/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
