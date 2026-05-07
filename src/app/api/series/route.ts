/**
 * /api/series — multi-volume project series.
 *
 * GET  → user's series, each with the projects (id, title, seriesOrder)
 *        sorted by volume so the home page can render them as grouped cards.
 * POST → create a new series ({ name, description? }).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const session = await requireAuth()
    const series = await prisma.series.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: 'desc' },
      include: {
        projects: {
          orderBy: [{ seriesOrder: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            title: true,
            seriesOrder: true,
            status: true,
            projectType: true,
            updatedAt: true,
            _count: { select: { chapters: true } },
          },
        },
      },
    })
    return NextResponse.json({ series })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/series]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()
    const body = (await req.json().catch(() => ({}))) as {
      name?: string
      description?: string
    }
    const name = (body.name ?? '').trim()
    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }
    const description = body.description?.trim() || null

    try {
      const series = await prisma.series.create({
        data: {
          userId: session.user.id,
          name,
          description,
        },
        select: { id: true, name: true, description: true },
      })
      return NextResponse.json(series)
    } catch (err) {
      // P2002 → unique constraint on (userId, name) — same name already used.
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
    console.error('[POST /api/series]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
