import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

type RouteContext = { params: Promise<{ id: string }> }

// GET — check for active/in-progress operations
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

    // Find subsections currently being written
    const activeWriting = await prisma.subsection.findMany({
      where: {
        section: { chapter: { projectId } },
        status: 'in_progress',
      },
      select: {
        id: true,
        subsectionId: true,
        title: true,
      },
    })

    return NextResponse.json({
      writing: activeWriting,
      hasActive: activeWriting.length > 0,
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
