import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, AdminAuthError } from '@/lib/admin-auth'
import { grantCredits } from '@/lib/credits'

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin()

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
      grantedBy: admin.username,
    })

    return NextResponse.json({ newBalance })
  } catch (err) {
    if (err instanceof AdminAuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/credits/admin]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
