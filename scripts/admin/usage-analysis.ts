/**
 * One-shot usage analytics — pulls real CreditTransaction data from
 * the production DB and builds a pricing-ready picture: per-user
 * volume, per-operation distribution, monthly burn rate, free-tier
 * sizing, $/user math.
 *
 *   DATABASE_URL=... npx tsx scripts/admin/usage-analysis.ts
 */

import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

// Anthropic Claude pricing (USD per million tokens, 2025/2026 published).
// Sonnet 4.6: $3 input / $15 output  → $0.000003 / $0.000015 per token
// Haiku 4.5:  $0.25 input / $1.25 output
// Imagen 4:   $0.04 per image (rough est. for stock 4:3 generation)
const PRICE_PER_TOKEN = {
  sonnet: { input: 3 / 1_000_000, output: 15 / 1_000_000 },
  haiku:  { input: 0.25 / 1_000_000, output: 1.25 / 1_000_000 },
}
const IMAGE_COST_USD = 0.04

// Match the operation types in CreditTransaction.metadata.action — pulled
// from src/lib/credits.ts ESTIMATED_COSTS keys.
type Op = string

interface UserAgg {
  userId: string
  email: string | null
  totalCredits: number
  totalSpend: number       // USD
  ops: Map<Op, { count: number; credits: number }>
  firstSeen: Date | null
  lastSeen: Date | null
}

async function main() {
  console.log('='.repeat(80))
  console.log('USAGE ANALYSIS — pricing input')
  console.log('='.repeat(80))

  // ---- 1. Aggregate transactions per user ----------------------------
  const txns = await prisma.creditTransaction.findMany({
    select: {
      userId: true,
      amount: true,
      type: true,
      operation: true,
      inputTokens: true,
      outputTokens: true,
      cacheReadTokens: true,
      creditsUsed: true,
      model: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })
  const users = await prisma.user.findMany({
    select: { id: true, email: true, creditBalance: true, createdAt: true },
  })

  const usersById = new Map(users.map((u) => [u.id, u]))
  const agg = new Map<string, UserAgg>()
  for (const tx of txns) {
    if (!agg.has(tx.userId)) {
      const u = usersById.get(tx.userId)
      agg.set(tx.userId, {
        userId: tx.userId,
        email: u?.email ?? null,
        totalCredits: 0,
        totalSpend: 0,
        ops: new Map(),
        firstSeen: null,
        lastSeen: null,
      })
    }
    const a = agg.get(tx.userId)!
    if (tx.amount < 0) {
      // Spend (deduction) — positive credits used.
      a.totalCredits += -tx.amount
      const op = tx.operation ?? tx.type
      const opStat = a.ops.get(op) ?? { count: 0, credits: 0 }
      opStat.count++
      opStat.credits += -tx.amount
      a.ops.set(op, opStat)
      // Real token-cost using top-level fields. cacheReadTokens are
      // billed at 10% input rate by Anthropic, so we factor that in.
      const inTok = tx.inputTokens ?? 0
      const outTok = tx.outputTokens ?? 0
      const cacheTok = tx.cacheReadTokens ?? 0
      const model = tx.model?.toLowerCase().includes('haiku') ? 'haiku' as const : 'sonnet' as const
      const tokenUsd =
        inTok * PRICE_PER_TOKEN[model].input
        + outTok * PRICE_PER_TOKEN[model].output
        + cacheTok * PRICE_PER_TOKEN[model].input * 0.1
      const imageUsd = op.includes('image') || op.includes('cover') || op.includes('portrait')
        ? IMAGE_COST_USD : 0
      a.totalSpend += tokenUsd + imageUsd
    }
    if (!a.firstSeen || tx.createdAt < a.firstSeen) a.firstSeen = tx.createdAt
    if (!a.lastSeen || tx.createdAt > a.lastSeen) a.lastSeen = tx.createdAt
  }

  // ---- 2. Headline numbers --------------------------------------------
  const activeUsers = Array.from(agg.values()).filter((a) => a.totalCredits > 0)
  const totalCredits = activeUsers.reduce((s, a) => s + a.totalCredits, 0)
  const totalSpend = activeUsers.reduce((s, a) => s + a.totalSpend, 0)
  console.log()
  console.log(`Total registered users:  ${users.length}`)
  console.log(`Users with any spend:    ${activeUsers.length}`)
  console.log(`Total credits spent:     ${totalCredits.toLocaleString()}`)
  console.log(`Total spend (est. USD):  $${totalSpend.toFixed(2)}`)
  console.log(`Avg per active user:     ${(totalCredits / Math.max(1, activeUsers.length)).toFixed(0)} credits / $${(totalSpend / Math.max(1, activeUsers.length)).toFixed(2)}`)

  // ---- 3. Distribution percentiles ------------------------------------
  const sorted = activeUsers.map((a) => a.totalCredits).sort((a, b) => a - b)
  const pct = (p: number) => sorted[Math.floor((sorted.length - 1) * p)] ?? 0
  console.log()
  console.log('Credit-spend distribution (active users):')
  console.log(`  P25 (light):    ${pct(0.25).toLocaleString()} credits`)
  console.log(`  P50 (median):   ${pct(0.50).toLocaleString()} credits`)
  console.log(`  P75:            ${pct(0.75).toLocaleString()} credits`)
  console.log(`  P90 (heavy):    ${pct(0.90).toLocaleString()} credits`)
  console.log(`  P95:            ${pct(0.95).toLocaleString()} credits`)
  console.log(`  P99:            ${pct(0.99).toLocaleString()} credits`)
  console.log(`  max:            ${(sorted[sorted.length - 1] ?? 0).toLocaleString()} credits`)

  // ---- 4. Operation breakdown (across all users) ----------------------
  const opTotals = new Map<Op, { count: number; credits: number; users: Set<string> }>()
  for (const a of activeUsers) {
    for (const [op, stat] of a.ops) {
      const t = opTotals.get(op) ?? { count: 0, credits: 0, users: new Set<string>() }
      t.count += stat.count
      t.credits += stat.credits
      t.users.add(a.userId)
      opTotals.set(op, t)
    }
  }
  const opList = Array.from(opTotals.entries()).sort((a, b) => b[1].credits - a[1].credits)
  console.log()
  console.log('Operations by total credit spend:')
  console.log('  ' + 'Operation'.padEnd(35) + ' Calls'.padStart(10) + ' Credits'.padStart(12) + ' Users'.padStart(8) + ' Avg/call'.padStart(10))
  for (const [op, t] of opList.slice(0, 20)) {
    const avg = (t.credits / t.count).toFixed(0)
    console.log(`  ${op.padEnd(35)}${String(t.count).padStart(10)}${t.credits.toLocaleString().padStart(12)}${String(t.users.size).padStart(8)}${avg.padStart(10)}`)
  }

  // ---- 5. Pricing simulations -----------------------------------------
  // Cost per 1000 credits in USD. Credit = 1000 weighted tokens at
  // Haiku-input rate. So 1000 credits ~= a chunk of mostly-Sonnet output.
  // Empirically: total USD / total credits gives a useful $/credit.
  const usdPerCredit = totalCredits > 0 ? totalSpend / totalCredits : 0.0001
  console.log()
  console.log(`Empirical $/credit (model-weighted): $${usdPerCredit.toFixed(6)}`)
  console.log(`So 1500 starter credits ≈ $${(1500 * usdPerCredit).toFixed(3)}`)
  console.log(`     5000 credits        ≈ $${(5000 * usdPerCredit).toFixed(3)}`)
  console.log(`     10000 credits       ≈ $${(10000 * usdPerCredit).toFixed(3)}`)
  console.log(`     25000 credits       ≈ $${(25000 * usdPerCredit).toFixed(3)}`)

  // Pricing tier proposals
  console.log()
  console.log('=== Tier proposal (USD/month, 70% margin) ===')
  const margin = 0.70
  const tiers = [
    { name: 'Free',         credits:  1500 },
    { name: 'Student',      credits:  8000 },
    { name: 'Researcher',   credits: 25000 },
    { name: 'Power',        credits: 80000 },
  ]
  for (const t of tiers) {
    const cost = t.credits * usdPerCredit
    const price = t.name === 'Free' ? 0 : Math.ceil(cost / (1 - margin))
    console.log(`  ${t.name.padEnd(13)} ${t.credits.toLocaleString().padStart(7)} credits → cost $${cost.toFixed(2).padStart(7)} → price $${String(price).padStart(3)}/mo`)
  }

  // ---- 6. Power-user audit (potential subscribers) --------------------
  console.log()
  console.log('=== Top 10 active users (potential paying customers) ===')
  const top = [...activeUsers].sort((a, b) => b.totalCredits - a.totalCredits).slice(0, 10)
  console.log('  ' + 'Email'.padEnd(35) + 'Credits'.padStart(10) + 'Spend(USD)'.padStart(12) + 'Days active'.padStart(13))
  for (const a of top) {
    const days = a.firstSeen && a.lastSeen
      ? Math.max(1, Math.round((+a.lastSeen - +a.firstSeen) / (1000 * 60 * 60 * 24)))
      : 0
    console.log(`  ${(a.email ?? a.userId).slice(0, 33).padEnd(35)}${a.totalCredits.toLocaleString().padStart(10)}${('$' + a.totalSpend.toFixed(2)).padStart(12)}${String(days).padStart(13)}`)
  }

  await prisma.$disconnect()
  await pool.end()
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect().catch(() => {})
  await pool.end().catch(() => {})
  process.exit(1)
})
