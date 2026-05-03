'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, Crown } from 'lucide-react'
import { CheckoutButton } from './CheckoutButton'

type Interval = 'month' | 'year'

interface Props {
  userId: string | null
  userEmail: string | null
  /** the user's current tier — used to show "Current plan" instead of "Get …". */
  currentTier?: 'free' | 'starter' | 'pro'
}

const FREE_FEATURES = [
  '1,500 credits per month',
  '1 active project',
  'DOCX export',
  'All 9 citation formats',
  'BibTeX / Zotero import',
]

const STARTER_FEATURES = [
  '7,000 credits per month',
  'Up to 3 active projects',
  'DOCX & PDF export',
  'Everything in Free',
  'Email support',
]

const PRO_FEATURES = [
  '17,000 credits per month',
  'Unlimited active projects',
  'PDF print-ready (bleed + crop marks)',
  'EPUB export',
  'Charts, tables, equations',
  'Writing-twin style profile',
  'Priority email support',
]

export function PricingCards({ userId, userEmail, currentTier = 'free' }: Props) {
  const [interval, setInterval] = useState<Interval>('month')
  const yearly = interval === 'year'

  const starterPrice = yearly ? 7 : 9
  const proPrice = yearly ? 15 : 19

  return (
    <div>
      {/* Billing-period toggle */}
      <div className="flex items-center justify-center gap-1 mb-8 mx-auto w-fit p-1 rounded-sm bg-[#FAF7F0]/60 border border-[#d4c9b5]/60">
        <button
          type="button"
          onClick={() => setInterval('month')}
          className={`font-ui text-sm font-medium px-4 py-1.5 rounded-sm transition-all ${
            !yearly
              ? 'bg-white text-ink shadow-sm'
              : 'text-ink-light hover:text-ink'
          }`}
        >
          Monthly
        </button>
        <button
          type="button"
          onClick={() => setInterval('year')}
          className={`font-ui text-sm font-medium px-4 py-1.5 rounded-sm transition-all flex items-center gap-1.5 ${
            yearly
              ? 'bg-white text-ink shadow-sm'
              : 'text-ink-light hover:text-ink'
          }`}
        >
          Annual
          <span className="font-ui text-[10px] uppercase tracking-wider px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded-sm">
            Save 20%
          </span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-14">
        {/* Free */}
        <article className="rounded-sm bg-[#FAF7F0]/80 border border-[#d4c9b5]/60 p-7 flex flex-col">
          <div className="mb-5">
            <h2 className="font-display text-2xl font-bold text-ink mb-1">Free</h2>
            <p className="font-body text-sm text-ink-light">
              Try Quilpen end-to-end at no cost
            </p>
          </div>
          <div className="mb-5">
            <span className="font-display text-4xl font-bold text-ink">$0</span>
            <span className="font-ui text-sm text-ink-light ml-2">/ month</span>
          </div>
          <ul className="space-y-2 mb-7 flex-1">
            {FREE_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2">
                <Check className="w-4 h-4 mt-0.5 shrink-0 text-forest" />
                <span className="font-ui text-sm text-ink">{f}</span>
              </li>
            ))}
          </ul>
          {currentTier === 'free' ? (
            userId ? (
              <span className="flex items-center justify-center font-ui text-sm font-semibold px-4 py-2.5 rounded-sm border border-[#d4c9b5]/80 text-ink-light bg-[#FAF7F0]">
                Your current plan
              </span>
            ) : (
              <Link
                href="/api/auth/signin?callbackUrl=/pricing"
                className="flex items-center justify-center font-ui text-sm font-semibold px-4 py-2.5 rounded-sm border border-[#d4c9b5]/80 text-ink hover:border-[#C9A84C]/60 hover:bg-[#C9A84C]/5 transition-all"
              >
                Start Free
              </Link>
            )
          ) : (
            <Link
              href="/api/billing/portal"
              className="flex items-center justify-center font-ui text-sm font-semibold px-4 py-2.5 rounded-sm border border-[#d4c9b5]/80 text-ink hover:border-[#C9A84C]/60 hover:bg-[#C9A84C]/5 transition-all"
            >
              Downgrade
            </Link>
          )}
        </article>

        {/* Starter */}
        <article className="rounded-sm bg-[#FAF7F0]/95 border-2 border-[#C9A84C]/40 p-7 flex flex-col shadow-sm">
          <div className="mb-5">
            <h2 className="font-display text-2xl font-bold text-ink mb-1">Starter</h2>
            <p className="font-body text-sm text-ink-light">
              For students and a single book
            </p>
          </div>
          <div className="mb-5">
            <span className="font-display text-4xl font-bold text-ink">${starterPrice}</span>
            <span className="font-ui text-sm text-ink-light ml-2">/ month</span>
            {yearly && (
              <p className="font-ui text-xs text-emerald-700 mt-1">
                Billed ${starterPrice * 12}/year
              </p>
            )}
          </div>
          <ul className="space-y-2 mb-7 flex-1">
            {STARTER_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2">
                <Check className="w-4 h-4 mt-0.5 shrink-0 text-forest" />
                <span className="font-ui text-sm text-ink">{f}</span>
              </li>
            ))}
          </ul>
          {currentTier === 'starter' ? (
            <Link
              href="/api/billing/portal"
              className="flex items-center justify-center font-ui text-sm font-semibold px-4 py-2.5 rounded-sm border border-[#d4c9b5]/80 text-ink hover:border-[#C9A84C]/60 hover:bg-[#C9A84C]/5 transition-all"
            >
              Manage subscription
            </Link>
          ) : (
            <CheckoutButton
              tier="starter"
              interval={interval}
              userId={userId}
              userEmail={userEmail}
              className="flex items-center justify-center font-ui text-sm font-semibold px-4 py-2.5 rounded-sm bg-[#2D1F0E] text-[#FAF7F0] hover:bg-[#3d2914] transition-all w-full"
            >
              Get Starter
            </CheckoutButton>
          )}
        </article>

        {/* Pro */}
        <article className="relative rounded-sm bg-[#2D1F0E] border-2 border-[#C9A84C]/60 shadow-lg p-7 flex flex-col">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 px-3 py-1 bg-[#C9A84C] rounded-sm">
            <Crown className="w-3 h-3 text-[#1a0f05]" />
            <span className="font-ui text-[10px] font-bold text-[#1a0f05] uppercase tracking-wider">
              Most popular
            </span>
          </div>
          <div className="mb-5">
            <h2 className="font-display text-2xl font-bold text-[#FAF7F0] mb-1">Pro</h2>
            <p className="font-body text-sm text-[#e8dfd0]/60">
              Everything you need to finish a manuscript
            </p>
          </div>
          <div className="mb-5">
            <span className="font-display text-4xl font-bold text-[#C9A84C]">${proPrice}</span>
            <span className="font-ui text-sm text-[#e8dfd0]/60 ml-2">/ month</span>
            {yearly && (
              <p className="font-ui text-xs text-[#C9A84C]/80 mt-1">
                Billed ${proPrice * 12}/year
              </p>
            )}
          </div>
          <ul className="space-y-2 mb-7 flex-1">
            {PRO_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2">
                <Check className="w-4 h-4 mt-0.5 shrink-0 text-[#C9A84C]" />
                <span className="font-ui text-sm text-[#e8dfd0]/85">{f}</span>
              </li>
            ))}
          </ul>
          {currentTier === 'pro' ? (
            <Link
              href="/api/billing/portal"
              className="flex items-center justify-center font-ui text-sm font-semibold px-4 py-2.5 rounded-sm bg-[#C9A84C] text-[#1a0f05] hover:bg-[#d4b85a] transition-all"
            >
              Manage subscription
            </Link>
          ) : (
            <CheckoutButton
              tier="pro"
              interval={interval}
              userId={userId}
              userEmail={userEmail}
              className="flex items-center justify-center font-ui text-sm font-semibold px-4 py-2.5 rounded-sm bg-[#C9A84C] text-[#1a0f05] hover:bg-[#d4b85a] transition-all w-full"
            >
              Get Pro
            </CheckoutButton>
          )}
        </article>
      </div>
    </div>
  )
}
