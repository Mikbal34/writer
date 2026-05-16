import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Crown, ExternalLink, Receipt } from 'lucide-react'
import { getServerSession } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { tierByName, TIERS } from '@/lib/billing/tiers'
import { ensureMonthlyAllowance } from '@/lib/credits'
import WorkspaceShell from '@/components/shared/WorkspaceShell'

export const metadata = { title: 'Account — Quilpen' }
export const dynamic = 'force-dynamic'

export default async function AccountPage() {
  const session = await getServerSession()
  if (!session?.user?.id) {
    redirect('/api/auth/signin?callbackUrl=/account')
  }

  // Refill the bucket if the month rolled over before reading.
  await ensureMonthlyAllowance(session.user.id as string)

  const user = await prisma.user.findUnique({
    where: { id: session.user.id as string },
    select: {
      email: true,
      name: true,
      creditBalance: true,
      subscriptionTier: true,
      subscriptionStatus: true,
      currentPeriodEnd: true,
      creditsResetAt: true,
      paddleCustomerId: true,
      createdAt: true,
    },
  })
  if (!user) redirect('/api/auth/signin')

  const tier = tierByName(user.subscriptionTier)
  const isPaid = tier.name !== 'free'
  const isCanceled = user.subscriptionStatus === 'canceled'
  const allowance = tier.monthlyCredits
  const usedThisPeriod = Math.max(0, allowance - user.creditBalance)
  const usedPct = allowance > 0 ? Math.round((usedThisPeriod / allowance) * 100) : 0

  const recentTx = await prisma.creditTransaction.findMany({
    where: { userId: session.user.id as string },
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: {
      id: true,
      amount: true,
      type: true,
      operation: true,
      balance: true,
      createdAt: true,
    },
  })

  const periodLabel = (() => {
    if (isPaid && user.currentPeriodEnd) {
      const action = isCanceled ? 'Access ends' : 'Renews'
      return `${action} ${user.currentPeriodEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
    }
    if (!isPaid && user.creditsResetAt) {
      return `Credits reset ${user.creditsResetAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
    }
    return null
  })()

  return (
    <WorkspaceShell>
      <div className="max-w-4xl w-full mx-auto px-6 py-10">
        <header className="mb-8">
          <h1 className="font-display text-3xl font-bold text-ink mb-1">Account</h1>
          <p className="font-ui text-sm text-ink-light">{user.email}</p>
        </header>

        {/* Plan card */}
        <section className="rounded-sm border border-sandy/60 bg-white p-6 mb-6">
          <div className="flex items-start justify-between mb-5">
            <div>
              <div className="flex items-center gap-2 mb-1">
                {isPaid && <Crown className="w-4 h-4 text-gold" />}
                <h2 className="font-display text-xl font-semibold text-ink">
                  {tier.label} plan
                </h2>
                {isCanceled && (
                  <span className="font-ui text-[10px] uppercase tracking-wider px-2 py-0.5 bg-amber-100 text-amber-900 rounded-sm">
                    Cancelled
                  </span>
                )}
              </div>
              {periodLabel && (
                <p className="font-ui text-sm text-ink-light">{periodLabel}</p>
              )}
            </div>
            <div className="flex gap-2">
              {!isPaid && (
                <Link
                  href="/pricing"
                  className="font-ui text-sm font-semibold px-4 py-2 bg-gold text-ink rounded-sm hover:bg-gold-hover transition-colors"
                >
                  Upgrade
                </Link>
              )}
              {isPaid && user.paddleCustomerId && (
                <Link
                  href="/api/billing/portal"
                  className="flex items-center gap-1.5 font-ui text-sm font-medium px-4 py-2 border border-sandy/80 text-ink rounded-sm hover:border-gold/60 hover:bg-gold/5 transition-all"
                >
                  Manage subscription
                  <ExternalLink className="w-3.5 h-3.5" />
                </Link>
              )}
            </div>
          </div>

          {/* Credit usage bar */}
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="font-ui text-xs uppercase tracking-wider text-ink-light">
                Credits this period
              </span>
              <span className="font-display text-sm font-semibold text-ink">
                {user.creditBalance.toLocaleString()}{' '}
                <span className="font-ui text-xs text-ink-light font-normal">
                  / {allowance.toLocaleString()} remaining
                </span>
              </span>
            </div>
            <div className="h-2 rounded-full bg-sandy/40 overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, 100 - usedPct)}%`,
                  background: 'linear-gradient(to right, #C9A84C, #e8c96a)',
                }}
              />
            </div>
            <p className="font-ui text-xs text-ink-light">
              {usedThisPeriod.toLocaleString()} used so far
            </p>
          </div>
        </section>

        {/* Plan comparison upsell */}
        {!isPaid && (
          <section className="rounded-sm border border-gold/30 bg-gold/5 p-5 mb-6">
            <div className="flex items-start gap-3">
              <Crown className="w-5 h-5 text-gold mt-0.5 shrink-0" />
              <div>
                <h3 className="font-display font-semibold text-ink mb-1">
                  Need more room?
                </h3>
                <p className="font-body text-sm text-ink-light mb-3">
                  Starter ({TIERS.starter.monthlyCredits.toLocaleString()} credits, $9/mo)
                  or Pro ({TIERS.pro.monthlyCredits.toLocaleString()} credits, $19/mo) lift
                  the limits and unlock PDF print-ready and EPUB export.
                </p>
                <Link
                  href="/pricing"
                  className="font-ui text-sm font-medium text-gold hover:text-gold-hover"
                >
                  See plans →
                </Link>
              </div>
            </div>
          </section>
        )}

        {/* Recent activity */}
        <section className="rounded-sm border border-sandy/60 bg-white p-6">
          <div className="flex items-center gap-2 mb-4">
            <Receipt className="w-4 h-4 text-ink-light" />
            <h2 className="font-display text-lg font-semibold text-ink">
              Recent activity
            </h2>
          </div>
          {recentTx.length === 0 ? (
            <p className="font-body text-sm text-ink-light">No activity yet.</p>
          ) : (
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-sandy/40">
                  <th className="py-2 font-ui text-xs uppercase tracking-wider text-ink-light">
                    Date
                  </th>
                  <th className="py-2 font-ui text-xs uppercase tracking-wider text-ink-light">
                    Operation
                  </th>
                  <th className="py-2 font-ui text-xs uppercase tracking-wider text-ink-light text-right">
                    Credits
                  </th>
                  <th className="py-2 font-ui text-xs uppercase tracking-wider text-ink-light text-right">
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentTx.map((tx) => (
                  <tr key={tx.id} className="border-b border-sandy/20 last:border-0">
                    <td className="py-2 font-ui text-sm text-ink">
                      {tx.createdAt.toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-2 font-ui text-sm text-ink-light">
                      {tx.operation ?? tx.type}
                    </td>
                    <td
                      className={`py-2 font-ui text-sm text-right ${
                        tx.amount < 0 ? 'text-red-700' : 'text-emerald-700'
                      }`}
                    >
                      {tx.amount > 0 ? '+' : ''}
                      {tx.amount.toLocaleString()}
                    </td>
                    <td className="py-2 font-ui text-sm text-ink text-right">
                      {tx.balance.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </WorkspaceShell>
  )
}
