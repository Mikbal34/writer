import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

// GET /api/style-profiles — list all profiles for the authenticated user
export async function GET() {
  try {
    const session = await requireAuth()

    const profiles = await prisma.userStyleProfile.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        profile: true,
        method: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return NextResponse.json(profiles)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/style-profiles]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/style-profiles — create a new profile
// Body: { name: string, method: "chat" | "analyze" }
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()

    const body = await req.json()
    const { name, method } = body as { name?: string; method?: string }

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    const validMethods = ['chat', 'analyze']
    const profileMethod = validMethods.includes(method ?? '') ? method! : 'chat'

    const profile = await prisma.userStyleProfile.create({
      data: {
        userId: session.user.id,
        name: name.trim(),
        method: profileMethod,
      },
    })

    return NextResponse.json(profile, { status: 201 })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/style-profiles]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
