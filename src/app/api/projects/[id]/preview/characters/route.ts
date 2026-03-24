import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

type RouteContext = { params: Promise<{ id: string }> }

// GET — list all characters for a project
export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id: projectId } = await ctx.params

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: session.user.id },
      select: { id: true },
    })
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const characters = await prisma.character.findMany({
      where: { projectId },
      orderBy: { sortOrder: 'asc' },
    })

    // Convert referenceData to base64 for frontend
    const result = characters.map((c) => ({
      ...c,
      referenceData: c.referenceData
        ? `data:image/png;base64,${Buffer.from(c.referenceData).toString('base64')}`
        : null,
    }))

    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET characters]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST — create a new character
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id: projectId } = await ctx.params

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: session.user.id },
      select: { id: true },
    })
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const body = await req.json()
    const { name, description, visualTraits, referenceData } = body as {
      name: string
      description?: string
      visualTraits?: string
      referenceData?: string // base64
    }

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const count = await prisma.character.count({ where: { projectId } })

    const character = await prisma.character.create({
      data: {
        projectId,
        name: name.trim(),
        description: description ?? null,
        visualTraits: visualTraits ?? null,
        referenceData: referenceData ? Buffer.from(referenceData, 'base64') : null,
        sortOrder: count,
      },
    })

    return NextResponse.json(character, { status: 201 })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST characters]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
