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

    // Month-to-date credit consumption — surfaced in the sidebar
    // CreditBalance card as a subtitle. CreditTransaction.amount is
    // signed (negative = spend, positive = top-up). We sum only the
    // negatives so a mid-month refill doesn't make "used this month"
    // jump backwards.
    const monthStart = new Date()
    monthStart.setUTCDate(1)
    monthStart.setUTCHours(0, 0, 0, 0)
    const monthRows = await prisma.creditTransaction.findMany({
      where: {
        userId: session.user.id,
        createdAt: { gte: monthStart },
        amount: { lt: 0 },
      },
      select: { amount: true },
    })
    const monthUsage = monthRows.reduce((acc, r) => acc + Math.abs(r.amount), 0)

    return NextResponse.json({
      balance: user?.creditBalance ?? 0,
      monthUsage,
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
