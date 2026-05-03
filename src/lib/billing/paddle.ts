/**
 * Paddle server-side helpers — webhook signature verification +
 * narrow Paddle Billing API client. We hit the API directly with
 * fetch instead of pulling in the official SDK to keep the bundle
 * lean (we only need a couple of endpoints for now).
 *
 * Env vars:
 *  - PADDLE_API_KEY        — server-side secret (Paddle dashboard → Authentication)
 *  - PADDLE_WEBHOOK_SECRET — the webhook secret (Paddle dashboard → Notifications)
 *  - PADDLE_ENVIRONMENT    — "sandbox" | "production"
 */
import crypto from 'crypto'

const API_BASES = {
  sandbox: 'https://sandbox-api.paddle.com',
  production: 'https://api.paddle.com',
} as const

function paddleEnv(): 'sandbox' | 'production' {
  const v = process.env.PADDLE_ENVIRONMENT?.toLowerCase()
  return v === 'production' ? 'production' : 'sandbox'
}

export function paddleApiBase(): string {
  return API_BASES[paddleEnv()]
}

/**
 * Verify a Paddle webhook signature.
 *
 * Paddle posts the header `Paddle-Signature: ts=<unix>;h1=<hex_hmac>`.
 * The HMAC is computed over `${ts}:${rawBody}` using the webhook
 * secret (sha256). We reject anything older than 5 minutes to defeat
 * trivial replay.
 *
 * Pass the *raw* request body string — JSON.parse first will mangle
 * whitespace and break the signature.
 */
export function verifyPaddleSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  toleranceSeconds = 300,
): boolean {
  if (!signatureHeader) return false
  const parts = Object.fromEntries(
    signatureHeader.split(';').map((kv) => {
      const i = kv.indexOf('=')
      return i === -1 ? [kv, ''] : [kv.slice(0, i), kv.slice(i + 1)]
    }),
  )
  const ts = parts.ts
  const sig = parts.h1
  if (!ts || !sig) return false
  const tsNum = parseInt(ts, 10)
  if (!Number.isFinite(tsNum)) return false
  const ageSec = Math.abs(Date.now() / 1000 - tsNum)
  if (ageSec > toleranceSeconds) return false

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${ts}:${rawBody}`)
    .digest('hex')
  // Constant-time compare to avoid timing leaks.
  const a = Buffer.from(sig, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

interface PaddleApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
}

async function paddleFetch<T>(path: string, opts: PaddleApiOptions = {}): Promise<T> {
  const apiKey = process.env.PADDLE_API_KEY
  if (!apiKey) throw new Error('PADDLE_API_KEY is not set')
  const res = await fetch(`${paddleApiBase()}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Paddle API ${res.status} on ${path}: ${text.slice(0, 400)}`)
  }
  return (await res.json()) as T
}

/**
 * Build a self-service customer-portal URL. Paddle exposes one
 * endpoint per customer that renders the "manage subscription"
 * page (update card, cancel, view invoices). We pre-fetch the URL
 * each time the user visits /account so it stays signed/current.
 */
export interface PortalSession {
  urls: {
    general: { overview: string }
    subscriptions: Array<{ id: string; cancel_subscription: string; update_subscription_payment_method: string }>
  }
}

export async function createPortalSession(paddleCustomerId: string): Promise<PortalSession> {
  const json = await paddleFetch<{ data: PortalSession }>(
    `/customers/${paddleCustomerId}/portal-sessions`,
    { method: 'POST', body: {} },
  )
  return json.data
}

/**
 * Look up a single subscription by id. Used by the webhook handler
 * to refresh state after a `subscription.updated` event when we
 * want to be sure of the canonical values.
 */
export interface PaddleSubscription {
  id: string
  status: 'active' | 'canceled' | 'past_due' | 'paused' | 'trialing'
  customer_id: string
  current_billing_period: { starts_at: string; ends_at: string } | null
  items: Array<{ price: { id: string }; quantity: number }>
  custom_data: Record<string, unknown> | null
}

export async function getSubscription(subscriptionId: string): Promise<PaddleSubscription> {
  const json = await paddleFetch<{ data: PaddleSubscription }>(
    `/subscriptions/${subscriptionId}`,
  )
  return json.data
}
