import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  const result = await prisma.project.updateMany({
    where: { projectType: { in: ['BOOK', 'STORY'] } },
    data: { projectType: 'CREATIVE' },
  })

  console.log(`Migrated ${result.count} projects from BOOK/STORY → CREATIVE`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
