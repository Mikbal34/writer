import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

type RouteContext = { params: Promise<{ id: string }> }

// GET /api/projects/[id]/outputs
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

    const outputs = await prisma.output.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        subsection: { select: { title: true } },
      },
    })

    return NextResponse.json({ outputs })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/projects/[id]/outputs]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
