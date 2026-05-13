/**
 * One-shot diagnostic: read a user's current balance + recent
 * CreditTransaction rows to figure out the pre-wipe state and the
 * delta we need to restore.
 *
 *   DATABASE_URL=... npx tsx scripts/admin/inspect-user-credits.ts <email>
 */
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const email = process.argv[2]
if (!email) {
  console.error('usage: inspect-user-credits.ts <email>')
  process.exit(1)
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

async function main() {
  const user = await prisma.user.findFirst({
    where: { email },
    select: {
      id: true,
      email: true,
      creditBalance: true,
      subscriptionTier: true,
      subscriptionStatus: true,
      creditsResetAt: true,
      currentPeriodEnd: true,
      createdAt: true,
    },
  })
  if (!user) {
    console.log(`No user with email ${email}`)
    return
  }
  console.log('USER:')
  console.log(JSON.stringify(user, null, 2))

  const tx = await prisma.creditTransaction.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      amount: true,
      balance: true,
      type: true,
      operation: true,
      createdAt: true,
    },
  })
  console.log('\nRECENT TRANSACTIONS (newest first):')
  for (const t of tx) {
    console.log(
      `  ${t.createdAt.toISOString()}  ${String(t.type).padEnd(20)}  ` +
        `${String(t.amount).padStart(8)}  → balance=${String(t.balance).padStart(8)}  ` +
        `(${t.operation ?? ''})`,
    )
  }

  // Highest balance ever recorded — gives us the pre-wipe peak.
  const highest = await prisma.creditTransaction.findFirst({
    where: { userId: user.id },
    orderBy: { balance: 'desc' },
    select: { balance: true, createdAt: true, type: true },
  })
  console.log(`\nHIGHEST RECORDED BALANCE: ${highest?.balance.toLocaleString()} on ${highest?.createdAt.toISOString()} (${highest?.type})`)
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
