/**
 * Single source of truth for subscription tiers. Update this file to
 * add a tier, change credit allowances, or alter feature flags — the
 * pricing page, /account, webhook, and credit gate all read from here.
 *
 * Paddle Price IDs are env-driven so the same code runs against
 * sandbox and production without rebuilding.
 */
export type TierName = 'free' | 'starter' | 'pro'
export type BillingInterval = 'month' | 'year'

export interface TierConfig {
  /** machine name; matches User.subscriptionTier */
  name: TierName
  /** human-facing label */
  label: string
  /** monthly credit allowance */
  monthlyCredits: number
  /** max active projects (null = unlimited) */
  maxActiveProjects: number | null
  /** feature gates — keep in sync with /pricing comparison table */
  features: {
    pdfExportBasic: boolean
    pdfExportPrintReady: boolean
    epubExport: boolean
    chartsAndEquations: 'limited' | 'full'
    writingTwin: boolean
    prioritySupport: boolean
  }
  /** USD published price (cents-free, just for display) */
  priceUsd: { month: number; year: number } // year is the *monthly equivalent* when billed yearly
  /** Paddle Price IDs, env-driven. Free tier has no priceId. */
  priceId: { month: string | null; year: string | null }
}

const env = (key: string): string | null => {
  const v = process.env[key]
  return v && v.length > 0 ? v : null
}

export const TIERS: Record<TierName, TierConfig> = {
  free: {
    name: 'free',
    label: 'Free',
    monthlyCredits: 1500,
    maxActiveProjects: 1,
    features: {
      pdfExportBasic: false,
      pdfExportPrintReady: false,
      epubExport: false,
      chartsAndEquations: 'limited',
      writingTwin: false,
      prioritySupport: false,
    },
    priceUsd: { month: 0, year: 0 },
    priceId: { month: null, year: null },
  },
  starter: {
    name: 'starter',
    label: 'Starter',
    monthlyCredits: 7000,
    maxActiveProjects: 3,
    features: {
      pdfExportBasic: true,
      pdfExportPrintReady: false,
      epubExport: false,
      chartsAndEquations: 'limited',
      writingTwin: false,
      prioritySupport: false,
    },
    priceUsd: { month: 9, year: 7 },
    priceId: {
      month: env('PADDLE_PRICE_STARTER_MONTH'),
      year: env('PADDLE_PRICE_STARTER_YEAR'),
    },
  },
  pro: {
    name: 'pro',
    label: 'Pro',
    monthlyCredits: 17000,
    maxActiveProjects: null,
    features: {
      pdfExportBasic: true,
      pdfExportPrintReady: true,
      epubExport: true,
      chartsAndEquations: 'full',
      writingTwin: true,
      prioritySupport: true,
    },
    priceUsd: { month: 19, year: 15 },
    priceId: {
      month: env('PADDLE_PRICE_PRO_MONTH'),
      year: env('PADDLE_PRICE_PRO_YEAR'),
    },
  },
}

export function tierByName(name: string): TierConfig {
  return TIERS[(name as TierName) in TIERS ? (name as TierName) : 'free']
}

/**
 * Reverse lookup — given a Paddle Price ID (from a webhook event),
 * find which tier + interval it belongs to. Returns null if the
 * price id is unknown (likely an old/test product).
 */
export function tierFromPriceId(
  priceId: string,
): { tier: TierConfig; interval: BillingInterval } | null {
  for (const tier of Object.values(TIERS)) {
    if (tier.priceId.month === priceId) return { tier, interval: 'month' }
    if (tier.priceId.year === priceId) return { tier, interval: 'year' }
  }
  return null
}
