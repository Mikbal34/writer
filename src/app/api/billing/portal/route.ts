/**
 * Generates a Paddle customer-portal URL for the signed-in user and
 * redirects to it. The portal lets the customer update payment
 * method, change/cancel subscription, and download invoices —
 * features we don't need to (and shouldn't) re-implement.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { createPortalSession } from '@/lib/billing/paddle'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const session = await getServerSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id as string },
    select: { paddleCustomerId: true },
  })
  if (!user?.paddleCustomerId) {
    return NextResponse.json(
      { error: 'no Paddle customer — subscribe first' },
      { status: 400 },
    )
  }
  try {
    const portal = await createPortalSession(user.paddleCustomerId)
    const url = portal.urls.general.overview
    return NextResponse.redirect(url, 303)
  } catch (err) {
    console.error('[billing/portal] failed:', err)
    return NextResponse.json({ error: 'portal unavailable' }, { status: 502 })
  }
}
