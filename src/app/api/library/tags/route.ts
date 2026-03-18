import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    const session = await requireAuth()

    const tags = await prisma.libraryTag.findMany({
      where: { userId: session.user.id },
      include: { _count: { select: { entries: true } } },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json(tags)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/library/tags]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()
    const body = await req.json()
    const name = body.name?.trim()

    if (!name) {
      return NextResponse.json({ error: 'Tag name is required' }, { status: 400 })
    }

    const tag = await prisma.libraryTag.upsert({
      where: { userId_name: { userId: session.user.id, name } },
      create: { userId: session.user.id, name },
      update: {},
    })

    return NextResponse.json(tag, { status: 201 })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library/tags]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
