import Link from 'next/link'
import { Check, Crown, X } from 'lucide-react'
import { MarketingFrame } from '@/components/marketing/MarketingFrame'

export const metadata = {
  title: 'Pricing — Quilpen',
  description:
    'Simple monthly pricing for AI-assisted academic writing. Free, Starter at $9/month, or Pro at $19/month.',
}

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

export default function PricingPage() {
  return (
    <MarketingFrame>
      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <header className="text-center mb-14">
            <span className="font-ui text-xs text-[#C9A84C] tracking-[0.2em] uppercase">
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
                {[
                  '1,500 credits per month',
                  '1 active project',
                  'DOCX export',
                  'All 9 citation formats',
                  'BibTeX / Zotero import',
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="w-4 h-4 mt-0.5 shrink-0 text-forest" />
                    <span className="font-ui text-sm text-ink">{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/api/auth/signin"
                className="flex items-center justify-center font-ui text-sm font-semibold px-4 py-2.5 rounded-sm border border-[#d4c9b5]/80 text-ink hover:border-[#C9A84C]/60 hover:bg-[#C9A84C]/5 transition-all"
              >
                Start Free
              </Link>
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
                <span className="font-display text-4xl font-bold text-ink">$9</span>
                <span className="font-ui text-sm text-ink-light ml-2">/ month</span>
                <p className="font-ui text-xs text-ink-light/70 mt-1">
                  Or $7/month billed annually
                </p>
              </div>
              <ul className="space-y-2 mb-7 flex-1">
                {[
                  '7,000 credits per month',
                  'Up to 3 active projects',
                  'DOCX & PDF export',
                  'Everything in Free',
                  'Email support',
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="w-4 h-4 mt-0.5 shrink-0 text-forest" />
                    <span className="font-ui text-sm text-ink">{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/api/auth/signin"
                className="flex items-center justify-center font-ui text-sm font-semibold px-4 py-2.5 rounded-sm bg-[#2D1F0E] text-[#FAF7F0] hover:bg-[#3d2914] transition-all"
              >
                Get Starter
              </Link>
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
                <span className="font-display text-4xl font-bold text-[#C9A84C]">$19</span>
                <span className="font-ui text-sm text-[#e8dfd0]/60 ml-2">/ month</span>
                <p className="font-ui text-xs text-[#e8dfd0]/50 mt-1">
                  Or $15/month billed annually
                </p>
              </div>
              <ul className="space-y-2 mb-7 flex-1">
                {[
                  '17,000 credits per month',
                  'Unlimited active projects',
                  'PDF print-ready (bleed + crop marks)',
                  'EPUB export',
                  'Charts, tables, equations',
                  'Writing-twin style profile',
                  'Priority email support',
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="w-4 h-4 mt-0.5 shrink-0 text-[#C9A84C]" />
                    <span className="font-ui text-sm text-[#e8dfd0]/85">{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/api/auth/signin"
                className="flex items-center justify-center font-ui text-sm font-semibold px-4 py-2.5 rounded-sm bg-[#C9A84C] text-[#1a0f05] hover:bg-[#d4b85a] transition-all"
              >
                Get Pro
              </Link>
            </article>
          </div>

          <div className="rounded-sm bg-[#FAF7F0]/70 border border-[#d4c9b5]/60 overflow-hidden">
            <header className="px-6 py-4 border-b border-[#d4c9b5]/60">
              <h3 className="font-display text-lg font-semibold text-ink">
                Compare features
              </h3>
            </header>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[#d4c9b5]/40">
                  <th className="px-6 py-3 font-ui text-xs uppercase tracking-wider text-ink-light">
                    Feature
                  </th>
                  <th className="px-4 py-3 font-ui text-xs uppercase tracking-wider text-ink-light text-center w-28">
                    Free
                  </th>
                  <th className="px-4 py-3 font-ui text-xs uppercase tracking-wider text-ink-light text-center w-28">
                    Starter
                  </th>
                  <th className="px-4 py-3 font-ui text-xs uppercase tracking-wider text-[#C9A84C] text-center w-28">
                    Pro
                  </th>
                </tr>
              </thead>
              <tbody>
                {FEATURES.map((row) => (
                  <tr key={row.label} className="border-b border-[#d4c9b5]/30 last:border-0">
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
