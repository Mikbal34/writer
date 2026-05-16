import Link from 'next/link'
import { Check, X } from 'lucide-react'
import { MarketingFrame } from '@/components/marketing/MarketingFrame'
import { PricingCards } from '@/components/billing/PricingCards'
import { getServerSession } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const metadata = {
  title: 'Pricing — Quilpen',
  description:
    'Simple monthly pricing for AI-assisted academic writing. Free, Starter at $9/month, or Pro at $19/month.',
}
export const dynamic = 'force-dynamic'

const FEATURES = [
  { label: 'AI-assisted writing', free: true, starter: true, pro: true },
  { label: 'All 9 citation formats (APA, MLA, Chicago, etc.)', free: true, starter: true, pro: true },
  { label: 'BibTeX & Zotero import', free: true, starter: true, pro: true },
  { label: 'DOCX export', free: true, starter: true, pro: true },
  { label: 'PDF export (standard)', free: false, starter: true, pro: true },
  { label: 'PDF export (print-ready, bleed + crop marks)', free: false, starter: false, pro: true },
  { label: 'EPUB export', free: false, starter: false, pro: true },
  { label: 'Charts, tables, equations & cross-references', free: 'limited', starter: 'limited', pro: true },
  { label: 'Writing-twin style profile', free: false, starter: false, pro: true },
  { label: 'Active projects', free: '1', starter: '3', pro: 'Unlimited' },
  { label: 'Monthly credits', free: '1,500', starter: '7,000', pro: '17,000' },
  { label: 'Email support', free: false, starter: true, pro: 'Priority' },
] as const

function FeatureCell({ value }: { value: boolean | string }) {
  if (value === true) {
    return <Check className="w-4 h-4 text-forest mx-auto" aria-label="Included" />
  }
  if (value === false) {
    return <X className="w-4 h-4 text-ink-light/40 mx-auto" aria-label="Not included" />
  }
  return <span className="font-ui text-xs text-ink">{value}</span>
}

export default async function PricingPage() {
  const session = await getServerSession()
  let userTier: 'free' | 'starter' | 'pro' = 'free'
  let userEmail: string | null = null
  let userId: string | null = null
  if (session?.user?.id) {
    userId = session.user.id as string
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, subscriptionTier: true },
    })
    userEmail = u?.email ?? null
    userTier = (u?.subscriptionTier as 'free' | 'starter' | 'pro') ?? 'free'
  }

  return (
    <MarketingFrame>
      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <header className="text-center mb-14">
            <span className="font-ui text-xs text-gold tracking-[0.2em] uppercase">
              Pricing
            </span>
            <h1 className="font-display text-5xl font-bold text-ink mt-3 mb-4">
              Three plans. No surprises.
            </h1>
            <p className="font-body text-lg text-ink-light max-w-xl mx-auto leading-relaxed">
              Start free. Upgrade when you need more. Cancel anytime — your manuscripts
              are always yours to keep.
            </p>
          </header>

          <PricingCards userId={userId} userEmail={userEmail} currentTier={userTier} />

          <div className="rounded-sm bg-page/70 border border-sandy/60 overflow-hidden">
            <header className="px-6 py-4 border-b border-sandy/60">
              <h3 className="font-display text-lg font-semibold text-ink">
                Compare features
              </h3>
            </header>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-sandy/40">
                  <th className="px-6 py-3 font-ui text-xs uppercase tracking-wider text-ink-light">
                    Feature
                  </th>
                  <th className="px-4 py-3 font-ui text-xs uppercase tracking-wider text-ink-light text-center w-28">
                    Free
                  </th>
                  <th className="px-4 py-3 font-ui text-xs uppercase tracking-wider text-ink-light text-center w-28">
                    Starter
                  </th>
                  <th className="px-4 py-3 font-ui text-xs uppercase tracking-wider text-gold text-center w-28">
                    Pro
                  </th>
                </tr>
              </thead>
              <tbody>
                {FEATURES.map((row) => (
                  <tr key={row.label} className="border-b border-sandy/30 last:border-0">
                    <td className="px-6 py-3 font-ui text-sm text-ink">{row.label}</td>
                    <td className="px-4 py-3 text-center">
                      <FeatureCell value={row.free} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <FeatureCell value={row.starter} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <FeatureCell value={row.pro} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-16">
            <h2 className="font-display text-2xl font-bold text-ink mb-6 text-center">
              Frequently asked
            </h2>
            <dl className="space-y-6 max-w-2xl mx-auto">
              {[
                {
                  q: 'How are credits counted?',
                  a: 'Each AI operation (drafting a section, generating an abstract, refining a paragraph) costs credits proportional to the model used and the length of the output. Most users finish a full chapter on a few hundred credits. Unused credits do not roll over to the next month.',
                },
                {
                  q: 'Do I own what I write?',
                  a: 'Yes — every manuscript, citation, and exported file you produce on Quilpen is yours. We do not claim copyright over your work, and we do not train models on your content.',
                },
                {
                  q: 'Can I cancel or change plans anytime?',
                  a: 'Yes. Cancel or switch tiers from your account page. Cancellations stop future billing; you keep access until the end of the current paid period. Upgrades take effect immediately and are prorated.',
                },
                {
                  q: 'Refunds?',
                  a: (
                    <>
                      First-time paid subscribers (Starter or Pro) can request a full
                      refund within 14 days. See our{' '}
                      <Link href="/refund">refund policy</Link>.
                    </>
                  ),
                },
                {
                  q: 'Who handles payments?',
                  a: 'Payments are processed by Paddle, our Merchant of Record. Paddle handles billing, taxes (VAT, sales tax), and invoicing in 200+ countries.',
                },
                {
                  q: 'Discounts for students?',
                  a: 'Yes — drop us a note from your university email at support@quilpen.com and we will share the student rate.',
                },
              ].map((item) => (
                <div key={item.q}>
                  <dt className="font-display font-semibold text-ink mb-1">{item.q}</dt>
                  <dd className="font-body text-sm text-ink-light leading-relaxed">{item.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>
    </MarketingFrame>
  )
}
