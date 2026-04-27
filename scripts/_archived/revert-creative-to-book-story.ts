import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  const creativeProjects = await prisma.project.findMany({
    where: { projectType: 'CREATIVE' },
    select: { id: true, title: true, styleProfile: true },
  })

  console.log(`Found ${creativeProjects.length} CREATIVE projects to revert`)

  let toStory = 0
  let toBook = 0

  for (const p of creativeProjects) {
    const sp = (p.styleProfile ?? {}) as Record<string, unknown>
    const isFictionLeaning = Boolean(
      sp.narrativePOV || sp.genre || sp.dialogueStyle || sp.moodAtmosphere
    )

    const newType = isFictionLeaning ? 'STORY' : 'BOOK'

    await prisma.project.update({
      where: { id: p.id },
      data: { projectType: newType },
    })

    if (newType === 'STORY') toStory++
    else toBook++

    console.log(`  ${p.id} "${p.title}" → ${newType}`)
  }

  console.log(`\nReverted: ${toStory} → STORY, ${toBook} → BOOK`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
