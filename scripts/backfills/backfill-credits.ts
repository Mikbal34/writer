import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  const users = await prisma.user.findMany({
    where: { creditBalance: 0 },
    select: { id: true, email: true },
  })

  console.log(`Found ${users.length} users with 0 credit balance`)

  for (const user of users) {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { creditBalance: 50 },
      }),
      prisma.creditTransaction.create({
        data: {
          userId: user.id,
          amount: 50,
          balance: 50,
          type: 'initial_grant',
          metadata: { reason: 'backfill_signup_bonus' },
        },
      }),
    ])
    console.log(`Granted 50 credits to ${user.email ?? user.id}`)
  }

  console.log('Backfill complete')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
