import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

type RouteContext = { params: Promise<{ id: string }> }

// ---------------------------------------------------------------------------
// Helper: verify the section belongs to the requesting user
// ---------------------------------------------------------------------------
async function getOwnedSection(sectionId: string, userId: string) {
  return prisma.section.findFirst({
    where: {
      id: sectionId,
      chapter: { project: { userId } },
    },
  })
}

// GET /api/sections/[id]
// Returns the section with all of its subsections (including source mappings).
export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const section = await prisma.section.findFirst({
      where: { id, chapter: { project: { userId: session.user.id } } },
      include: {
        subsections: {
          orderBy: { sortOrder: 'asc' },
          include: {
            sourceMappings: {
              include: { bibliography: true },
            },
          },
        },
      },
    })

    if (!section) {
      return NextResponse.json({ error: 'Section not found' }, { status: 404 })
    }

    return NextResponse.json(section)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/sections/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/sections/[id]
// Body: { title?, keyConcepts?, sortOrder? }
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const owned = await getOwnedSection(id, session.user.id)
    if (!owned) {
      return NextResponse.json({ error: 'Section not found' }, { status: 404 })
    }

    const body = await req.json()
    const { title, keyConcepts, sortOrder } = body as {
      title?: string
      keyConcepts?: string[]
      sortOrder?: number
    }

    const updated = await prisma.section.update({
      where: { id },
      data: {
        ...(title !== undefined && { title: title.trim() }),
        ...(keyConcepts !== undefined && { keyConcepts }),
        ...(sortOrder !== undefined && { sortOrder }),
      },
    })

    return NextResponse.json(updated)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[PATCH /api/sections/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/sections/[id]
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const owned = await getOwnedSection(id, session.user.id)
    if (!owned) {
      return NextResponse.json({ error: 'Section not found' }, { status: 404 })
    }

    await prisma.section.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[DELETE /api/sections/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
