import { NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    const session = await requireAuth()

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { creditBalance: true },
    })

    const usage = await prisma.creditTransaction.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })

    return NextResponse.json({
      balance: user?.creditBalance ?? 0,
      usage,
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/credits]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
