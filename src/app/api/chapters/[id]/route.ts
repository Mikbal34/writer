import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

type RouteContext = { params: Promise<{ id: string }> }

// ---------------------------------------------------------------------------
// Helper: verify the chapter belongs to the requesting user
// ---------------------------------------------------------------------------
async function getOwnedChapter(chapterId: string, userId: string) {
  return prisma.chapter.findFirst({
    where: {
      id: chapterId,
      project: { userId },
    },
    include: {
      project: { select: { userId: true } },
    },
  })
}

// GET /api/chapters/[id]
export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const chapter = await prisma.chapter.findFirst({
      where: { id, project: { userId: session.user.id } },
      include: {
        sections: {
          orderBy: { sortOrder: 'asc' },
          include: {
            subsections: { orderBy: { sortOrder: 'asc' } },
          },
        },
      },
    })

    if (!chapter) {
      return NextResponse.json({ error: 'Chapter not found' }, { status: 404 })
    }

    return NextResponse.json(chapter)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/chapters/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/chapters/[id]
// Body: { title?, purpose?, sortOrder? }
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const owned = await getOwnedChapter(id, session.user.id)
    if (!owned) {
      return NextResponse.json({ error: 'Chapter not found' }, { status: 404 })
    }

    const body = await req.json()
    const { title, purpose, sortOrder } = body as {
      title?: string
      purpose?: string
      sortOrder?: number
    }

    const updated = await prisma.chapter.update({
      where: { id },
      data: {
        ...(title !== undefined && { title: title.trim() }),
        ...(purpose !== undefined && { purpose }),
        ...(sortOrder !== undefined && { sortOrder }),
      },
    })

    return NextResponse.json(updated)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[PATCH /api/chapters/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/chapters/[id]
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const owned = await getOwnedChapter(id, session.user.id)
    if (!owned) {
      return NextResponse.json({ error: 'Chapter not found' }, { status: 404 })
    }

    await prisma.chapter.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[DELETE /api/chapters/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
