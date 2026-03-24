import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

type RouteContext = { params: Promise<{ id: string }> }

// GET — list all images for a project (without binary data)
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

    const images = await prisma.projectImage.findMany({
      where: { projectId },
      select: {
        id: true,
        chapterId: true,
        subsectionId: true,
        prompt: true,
        style: true,
        aspectRatio: true,
        sortOrder: true,
        createdAt: true,
        chapter: { select: { number: true, title: true } },
        subsection: { select: { subsectionId: true, title: true } },
      },
      orderBy: { sortOrder: 'asc' },
    })

    // Add thumbnail URL
    const result = images.map((img) => ({
      ...img,
      url: `/api/projects/${projectId}/preview/images/${img.id}`,
    }))

    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET images]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
