/**
 * /api/library/collections
 *
 * GET  → list all collections for the authenticated user as a tree.
 *        Each row carries `entryCount` so the sidebar can show "Kelam (12)".
 *        We return a flat array; the client assembles the tree from
 *        `parentId` — keeps the API simple and works regardless of nesting
 *        depth.
 *
 * POST → create a new collection.
 *        Body: { name, parentId?, color? }
 *        Auto-assigns `sortOrder` = (max existing sortOrder under the same
 *        parent) + 1, so newly created folders land at the bottom.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const session = await requireAuth()
    const userId = session.user.id

    const collections = await prisma.libraryCollection.findMany({
      where: { userId },
      orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { entries: true, children: true } },
      },
    })

    return NextResponse.json({
      collections: collections.map((c) => ({
        id: c.id,
        parentId: c.parentId,
        name: c.name,
        color: c.color,
        sortOrder: c.sortOrder,
        entryCount: c._count.entries,
        childCount: c._count.children,
        createdAt: c.createdAt,
      })),
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/library/collections]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()
    const userId = session.user.id
    const body = (await req.json()) as {
      name?: string
      parentId?: string | null
      color?: string | null
    }

    const name = body.name?.trim()
    if (!name) {
      return NextResponse.json({ error: 'Klasör adı zorunlu' }, { status: 400 })
    }
    if (name.length > 100) {
      return NextResponse.json({ error: 'Klasör adı çok uzun' }, { status: 400 })
    }

    // Verify parent belongs to this user when provided.
    if (body.parentId) {
      const parent = await prisma.libraryCollection.findFirst({
        where: { id: body.parentId, userId },
        select: { id: true },
      })
      if (!parent) {
        return NextResponse.json({ error: 'Üst klasör bulunamadı' }, { status: 404 })
      }
    }

    // Auto-assign sortOrder at the tail of the parent's children.
    const tail = await prisma.libraryCollection.findFirst({
      where: { userId, parentId: body.parentId ?? null },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    })

    try {
      const created = await prisma.libraryCollection.create({
        data: {
          userId,
          parentId: body.parentId ?? null,
          name,
          color: body.color ?? null,
          sortOrder: (tail?.sortOrder ?? 0) + 1,
        },
      })
      return NextResponse.json(
        {
          id: created.id,
          parentId: created.parentId,
          name: created.name,
          color: created.color,
          sortOrder: created.sortOrder,
          entryCount: 0,
          childCount: 0,
        },
        { status: 201 },
      )
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
    console.error('[POST /api/library/collections]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
