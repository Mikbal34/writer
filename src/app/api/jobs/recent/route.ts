import { NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

/**
 * GET /api/jobs/recent
 * Returns up to 20 recent jobs for the current user: anything running, plus
 * anything finished in the last 24 hours. Used by the navbar bell to poll
 * for in-flight progress and surface completion toasts.
 */
export async function GET() {
  try {
    const session = await requireAuth()
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)

    const jobs = await prisma.backgroundJob.findMany({
      where: {
        userId: session.user.id,
        OR: [{ status: 'running' }, { startedAt: { gte: yesterday } }],
      },
      orderBy: { startedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        type: true,
        status: true,
        title: true,
        projectId: true,
        subsectionId: true,
        resultUrl: true,
        progress: true,
        message: true,
        error: true,
        acknowledged: true,
        startedAt: true,
        finishedAt: true,
      },
    })

    return NextResponse.json({ jobs })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/jobs/recent]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
