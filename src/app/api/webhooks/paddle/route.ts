/**
 * Paddle webhook receiver. Maps Paddle subscription/transaction
 * events to local User state.
 *
 * The customer↔user link is established at checkout time: we pass
 * `customData: { userId }` when opening Paddle.Checkout, and Paddle
 * echoes it on every subsequent event for the lifetime of that
 * subscription. As a fallback we look up by paddleCustomerId.
 *
 * Set PADDLE_WEBHOOK_SECRET, then in the Paddle dashboard point
 * `/api/webhooks/paddle` at the prod URL and subscribe to:
 *   subscription.created
 *   subscription.updated
 *   subscription.canceled
 *   transaction.completed
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { tierFromPriceId, TIERS } from '@/lib/billing/tiers'
import { verifyPaddleSignature } from '@/lib/billing/paddle'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface PaddleSubscriptionData {
  id: string
  status: string
  customer_id: string
  current_billing_period: { starts_at: string; ends_at: string } | null
  items: Array<{ price: { id: string } }>
  custom_data: Record<string, unknown> | null
}

interface PaddleTransactionData {
  id: string
  status: string
  customer_id: string | null
  subscription_id: string | null
  items: Array<{ price: { id: string } }>
  custom_data: Record<string, unknown> | null
}

interface PaddleEvent {
  event_type: string
  data: PaddleSubscriptionData | PaddleTransactionData
}

export async function POST(request: Request) {
  const secret = process.env.PADDLE_WEBHOOK_SECRET
  if (!secret) {
    console.error('[paddle/webhook] PADDLE_WEBHOOK_SECRET is not set')
    return NextResponse.json({ error: 'webhook not configured' }, { status: 500 })
  }

  // Read raw body — JSON.parse would mangle whitespace and break HMAC.
  const rawBody = await request.text()
  const sigHeader = request.headers.get('paddle-signature')
  if (!verifyPaddleSignature(rawBody, sigHeader, secret)) {
    console.warn('[paddle/webhook] signature verification failed')
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  let event: PaddleEvent
  try {
    event = JSON.parse(rawBody) as PaddleEvent
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  try {
    switch (event.event_type) {
      case 'subscription.created':
      case 'subscription.updated':
        await handleSubscriptionUpsert(event.data as PaddleSubscriptionData)
        break
      case 'subscription.canceled':
        await handleSubscriptionCanceled(event.data as PaddleSubscriptionData)
        break
      case 'transaction.completed':
        await handleTransactionCompleted(event.data as PaddleTransactionData)
        break
      default:
        // Acknowledge other events so Paddle doesn't retry.
        break
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(`[paddle/webhook] failed handling ${event.event_type}:`, err)
    // Returning 500 makes Paddle retry — desirable for transient errors.
    return NextResponse.json({ error: 'handler failed' }, { status: 500 })
  }
}

async function findUserForEvent(
  customerId: string | null,
  customData: Record<string, unknown> | null,
): Promise<{ id: string } | null> {
  const customDataUserId =
    customData && typeof customData.userId === 'string' ? customData.userId : null
  if (customDataUserId) {
    const u = await prisma.user.findUnique({
      where: { id: customDataUserId },
      select: { id: true },
    })
    if (u) return u
  }
  if (customerId) {
    const u = await prisma.user.findFirst({
      where: { paddleCustomerId: customerId },
      select: { id: true },
    })
    if (u) return u
  }
  return null
}

async function handleSubscriptionUpsert(sub: PaddleSubscriptionData) {
  const user = await findUserForEvent(sub.customer_id, sub.custom_data)
  if (!user) {
    console.warn(
      `[paddle/webhook] no user for subscription ${sub.id} (customer ${sub.customer_id})`,
    )
    return
  }

  const priceId = sub.items[0]?.price.id
  const mapped = priceId ? tierFromPriceId(priceId) : null
  if (!mapped) {
    console.warn(`[paddle/webhook] unknown priceId ${priceId} on subscription ${sub.id}`)
    return
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      paddleCustomerId: sub.customer_id,
      paddleSubscriptionId: sub.id,
      subscriptionTier: mapped.tier.name,
      subscriptionStatus: sub.status,
      subscriptionPriceId: priceId,
      currentPeriodEnd: sub.current_billing_period?.ends_at
        ? new Date(sub.current_billing_period.ends_at)
        : null,
    },
  })
}

async function handleSubscriptionCanceled(sub: PaddleSubscriptionData) {
  const user = await findUserForEvent(sub.customer_id, sub.custom_data)
  if (!user) return
  // Paddle "canceled" means the subscription has ended (or will end at
  // period close). We mirror the status; the credit gate will fall back
  // to free-tier limits once currentPeriodEnd passes.
  await prisma.user.update({
    where: { id: user.id },
    data: {
      subscriptionStatus: 'canceled',
      currentPeriodEnd: sub.current_billing_period?.ends_at
        ? new Date(sub.current_billing_period.ends_at)
        : null,
    },
  })
}

async function handleTransactionCompleted(tx: PaddleTransactionData) {
  // We treat each successful charge as a "billing-period bell": refill
  // the credit bucket to the tier's monthly allowance.
  const user = await findUserForEvent(tx.customer_id, tx.custom_data)
  if (!user) return

  const priceId = tx.items[0]?.price.id
  const mapped = priceId ? tierFromPriceId(priceId) : null
  if (!mapped) return

  // Read latest user state to compute next reset based on existing
  // currentPeriodEnd if present, else 30 days from now.
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { currentPeriodEnd: true },
  })
  const nextReset =
    dbUser?.currentPeriodEnd && dbUser.currentPeriodEnd > new Date()
      ? dbUser.currentPeriodEnd
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

  await prisma.user.update({
    where: { id: user.id },
    data: {
      creditBalance: mapped.tier.monthlyCredits,
      creditsResetAt: nextReset,
    },
  })

  await prisma.creditTransaction.create({
    data: {
      userId: user.id,
      amount: mapped.tier.monthlyCredits,
      balance: mapped.tier.monthlyCredits,
      type: 'subscription_renewal',
      operation: `tier:${mapped.tier.name}`,
      inputTokens: 0,
      outputTokens: 0,
      creditsUsed: 0,
      model: null,
      metadata: { paddleTransactionId: tx.id, priceId },
    },
  })
}

// Health probe — confirms the route is reachable + identifies the env.
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'paddle-webhook',
    tiers: Object.keys(TIERS),
  })
}
