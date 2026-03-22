import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { grantCredits } from '@/lib/credits'

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim()).filter(Boolean)

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()

    if (!session.user.email || !ADMIN_EMAILS.includes(session.user.email)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const { userId, amount, reason } = body as {
      userId: string
      amount: number
      reason?: string
    }

    if (!userId || typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json(
        { error: 'userId and positive amount are required' },
        { status: 400 }
      )
    }

    const { newBalance } = await grantCredits(userId, amount, 'admin_grant', {
      reason: reason ?? 'admin_grant',
      grantedBy: session.user.email,
    })

    return NextResponse.json({ newBalance })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/credits/admin]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
