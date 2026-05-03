'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Script from 'next/script'

type BillingInterval = 'month' | 'year'
type TierName = 'starter' | 'pro'

interface PaddleCheckoutOpenOptions {
  items: Array<{ priceId: string; quantity: number }>
  customer?: { email?: string; id?: string }
  customData?: Record<string, string>
  successUrl?: string
}

interface PaddleGlobal {
  Environment: { set: (env: 'sandbox' | 'production') => void }
  Initialize: (opts: { token: string; eventCallback?: (e: unknown) => void }) => void
  Checkout: { open: (opts: PaddleCheckoutOpenOptions) => void }
}

declare global {
  interface Window {
    Paddle?: PaddleGlobal
  }
}

interface CheckoutButtonProps {
  tier: TierName
  interval: BillingInterval
  /** the signed-in user's id (passed as customData.userId so the webhook can map back) */
  userId: string | null
  /** the signed-in user's email (prefills the checkout) */
  userEmail: string | null
  className?: string
  children: React.ReactNode
}

const PADDLE_JS_URL = 'https://cdn.paddle.com/paddle/v2/paddle.js'

export function CheckoutButton({
  tier,
  interval,
  userId,
  userEmail,
  className,
  children,
}: CheckoutButtonProps) {
  const router = useRouter()
  const [paddleReady, setPaddleReady] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.Paddle && paddleReady) return
    if (!window.Paddle) return
    const env = (process.env.NEXT_PUBLIC_PADDLE_ENVIRONMENT === 'production'
      ? 'production'
      : 'sandbox') as 'sandbox' | 'production'
    const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN
    if (!token) {
      console.warn('[CheckoutButton] NEXT_PUBLIC_PADDLE_CLIENT_TOKEN not set')
      return
    }
    window.Paddle.Environment.set(env)
    window.Paddle.Initialize({ token })
    setPaddleReady(true)
  }, [paddleReady])

  const handleClick = () => {
    if (!userId) {
      router.push(`/api/auth/signin?callbackUrl=/pricing`)
      return
    }
    if (!window.Paddle) {
      // Script hasn't loaded yet — fall back to /pricing reload so the
      // user gets a fresh attempt.
      router.refresh()
      return
    }
    const priceId = priceIdFor(tier, interval)
    if (!priceId) {
      alert(
        `Pricing for ${tier} (${interval}ly) is not configured yet. Please try again shortly.`,
      )
      return
    }
    window.Paddle.Checkout.open({
      items: [{ priceId, quantity: 1 }],
      customer: userEmail ? { email: userEmail } : undefined,
      customData: { userId },
      successUrl: `${window.location.origin}/account?subscribed=1`,
    })
  }

  return (
    <>
      <Script
        src={PADDLE_JS_URL}
        strategy="afterInteractive"
        onLoad={() => {
          // Initialize once Paddle.js has attached to window.
          if (window.Paddle && !paddleReady) {
            const env = (process.env.NEXT_PUBLIC_PADDLE_ENVIRONMENT === 'production'
              ? 'production'
              : 'sandbox') as 'sandbox' | 'production'
            const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN
            if (token) {
              window.Paddle.Environment.set(env)
              window.Paddle.Initialize({ token })
              setPaddleReady(true)
            }
          }
        }}
      />
      <button type="button" onClick={handleClick} className={className}>
        {children}
      </button>
    </>
  )
}

function priceIdFor(tier: TierName, interval: BillingInterval): string | null {
  const map: Record<string, string | undefined> = {
    'starter:month': process.env.NEXT_PUBLIC_PADDLE_PRICE_STARTER_MONTH,
    'starter:year': process.env.NEXT_PUBLIC_PADDLE_PRICE_STARTER_YEAR,
    'pro:month': process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO_MONTH,
    'pro:year': process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO_YEAR,
  }
  const v = map[`${tier}:${interval}`]
  return v && v.length > 0 ? v : null
}
