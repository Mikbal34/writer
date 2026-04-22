import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  const bibs = await prisma.bibliography.findMany({
    where: { sourceId: { not: null } },
    select: { id: true, sourceId: true },
  })

  console.log(`Found ${bibs.length} bibliographies with primary sourceId`)

  let created = 0
  let skipped = 0

  for (const bib of bibs) {
    if (!bib.sourceId) continue

    const existing = await prisma.bibliographyAttachment.findUnique({
      where: {
        bibliographyId_sourceId: {
          bibliographyId: bib.id,
          sourceId: bib.sourceId,
        },
      },
    })

    if (existing) {
      skipped++
      continue
    }

    await prisma.bibliographyAttachment.create({
      data: {
        bibliographyId: bib.id,
        sourceId: bib.sourceId,
      },
    })
    created++
  }

  console.log(`Created ${created} attachment records, skipped ${skipped} (already present)`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
