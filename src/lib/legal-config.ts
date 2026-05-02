/**
 * Single source of truth for legal-page constants. Change these values
 * here and they propagate through /terms, /privacy, /refund, /pricing.
 */
export const LEGAL = {
  brand: 'Quilpen',
  domain: 'quilpen.com',
  // Operating entity. Change to match your registered company in Türkiye
  // (Alphacore — şahıs şirketi or LTD). Paddle is the Merchant of Record
  // for end-customer transactions, so the customer's contract for the
  // payment is with Paddle; the contract for the service is with us.
  legalEntity: 'Alphacore',
  legalEntityCountry: 'Türkiye',
  // TODO before going live: replace with real registered business address.
  legalAddress: 'İstanbul, Türkiye',
  // Customer-facing email for support, billing and data-subject requests.
  contactEmail: 'support@quilpen.com',
  privacyEmail: 'privacy@quilpen.com',
  // Date shown as "last updated" — bump whenever the policies change.
  lastUpdated: 'April 28, 2026',
  // Paddle is our Merchant of Record + payment processor.
  paymentProcessor: 'Paddle.com Market Limited',
  paymentProcessorAddress: 'Judd House, 18-29 Mora Street, London EC1V 8BT, United Kingdom',
} as const
