import Link from 'next/link'
import React from 'react'
import { LEGAL } from '@/lib/legal-config'

const TEXTURE_URL =
  'https://d2xsxph8kpxj0f.cloudfront.net/310419663027387604/L3DyhJpdXQXWDPUTXv57iD/book-texture-bg-hJmgUJE5GQFpbmBrLLMri5.webp'

export function MarketingFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        backgroundImage: `url(${TEXTURE_URL})`,
        backgroundSize: 'cover',
        backgroundAttachment: 'fixed',
      }}
    >
      <nav className="sticky top-0 z-50 bg-ink/85 backdrop-blur-md border-b border-gold/15">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <img
              src="/images/quilpen-logo-horizontal.png"
              alt="Quilpen"
              className="h-20"
              style={{ filter: 'brightness(0) invert(1)' }}
            />
          </Link>
          <div className="flex items-center gap-6">
            <Link
              href="/pricing"
              className="font-ui text-sm text-sandy-soft/70 hover:text-page transition-colors"
            >
              Pricing
            </Link>
            <Link
              href="/api/auth/signin"
              className="font-ui text-sm text-sandy-soft/70 hover:text-page transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/api/auth/signin"
              className="font-ui text-sm font-medium px-4 py-2 bg-gold text-ink rounded-sm hover:bg-gold-hover transition-colors"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-sandy/40 py-8 px-6 bg-page/40">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/images/quilpen-logo-horizontal.png" alt="Quilpen" className="h-14" />
          </div>
          <p className="font-ui text-xs text-muted-foreground">
            © {new Date().getFullYear()} {LEGAL.legalEntity}. All rights reserved.
          </p>
          <div className="flex gap-4">
            <Link href="/pricing" className="font-ui text-xs text-muted-foreground hover:text-ink transition-colors">
              Pricing
            </Link>
            <Link href="/privacy" className="font-ui text-xs text-muted-foreground hover:text-ink transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="font-ui text-xs text-muted-foreground hover:text-ink transition-colors">
              Terms
            </Link>
            <Link href="/refund" className="font-ui text-xs text-muted-foreground hover:text-ink transition-colors">
              Refund
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

export function LegalShell({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <MarketingFrame>
      <article className="max-w-3xl mx-auto px-6 py-16">
        <header className="mb-10">
          <h1 className="font-display text-4xl font-bold text-ink mb-2">{title}</h1>
          <p className="font-ui text-xs text-ink-light/70">
            Last updated: {LEGAL.lastUpdated}
          </p>
        </header>
        <div className="font-body text-ink leading-relaxed space-y-5 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-ink [&_h3]:font-display [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-ink [&_p]:text-[15px] [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1 [&_li]:text-[15px] [&_a]:text-forest [&_a]:underline [&_a:hover]:text-gold-dark">
          {children}
        </div>
      </article>
    </MarketingFrame>
  )
}
