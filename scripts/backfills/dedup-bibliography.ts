/**
 * Bir-kerelik: aynı (projectId, libraryEntryId) çiftinde birden fazla
 * Bibliography satırı varsa tek kanonik kayda indir.
 *
 * Sorun: LLM aynı eseri hem tam title hem kısa title ile iki kez
 * eklediği için (örn "Wolfson — Kelam Felsefeleri: Müslüman..." ve
 * "Wolfson — Kelam Felsefeleri") proje başına aynı kütüphane eserine
 * bağlı 2-6 ayrı bibliography satırı oluşmuş.
 *
 * Strateji:
 *   1. Her duplicate grup için kanonik = en çok SourceMapping'i olan
 *      satır (eşitlikte en eski).
 *   2. Duplicate'lerdeki SourceMapping/BibliographyAttachment/Citation/
 *      SourceChunk referanslarını kanoniğe taşı.
 *   3. Kalan duplicate satırları sil.
 *
 * Sonra schema'ya @@unique([projectId, libraryEntryId]) ekle, migration
 * apply — yeni duplicate üretimi imkansızlaşır.
 *
 * Kullanım:
 *   - Dry-run (default):   npx tsx scripts/backfills/dedup-bibliography.ts
 *   - Apply:               npx tsx scripts/backfills/dedup-bibliography.ts --apply
 */
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

const apply = process.argv.includes('--apply')

interface Group {
  projectId: string
  libraryEntryId: string
  bibIds: string[]
}

async function main() {
  console.log(`[dedup-bibliography] mode=${apply ? 'APPLY' : 'DRY-RUN'}`)

  // 1. Find every duplicate group.
  const groups = await prisma.$queryRaw<Group[]>`
    SELECT
      "projectId",
      "libraryEntryId",
      array_agg(id ORDER BY "createdAt") AS "bibIds"
    FROM "Bibliography"
    WHERE "libraryEntryId" IS NOT NULL
    GROUP BY "projectId", "libraryEntryId"
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  `
  console.log(`[dedup-bibliography] found ${groups.length} duplicate groups`)

  let mergedRefs = 0
  let deletedBibs = 0

  for (const g of groups) {
    // Pull mapping counts for each bib in the group → choose canonical
    // as the one with the most SourceMappings (sticky to the roadmap),
    // tiebreak: earliest created.
    const counts = await Promise.all(
      g.bibIds.map(async (id) => ({
        id,
        mappings: await prisma.sourceMapping.count({ where: { bibliographyId: id } }),
      })),
    )
    counts.sort((a, b) => b.mappings - a.mappings)
    const canonical = counts[0].id
    const duplicates = g.bibIds.filter((id) => id !== canonical)

    console.log(
      `  group project=${g.projectId.slice(0, 10)} library=${g.libraryEntryId.slice(0, 10)} — ` +
        `canonical=${canonical.slice(0, 10)} (${counts[0].mappings} mappings) ` +
        `+ ${duplicates.length} duplicate(s)`,
    )

    if (!apply) continue

    // Move every reference to the canonical bib. Conflicts on the
    // unique constraints (subsectionId+bibliographyId,
    // bibliographyId+sourceId) are silently dropped — the canonical
    // already has its own row for that (subsection, source).
    for (const dup of duplicates) {
      // --- SourceMapping
      const dupMappings = await prisma.sourceMapping.findMany({
        where: { bibliographyId: dup },
        select: { id: true, subsectionId: true },
      })
      for (const m of dupMappings) {
        const conflict = await prisma.sourceMapping.findUnique({
          where: {
            subsectionId_bibliographyId: {
              subsectionId: m.subsectionId,
              bibliographyId: canonical,
            },
          },
          select: { id: true },
        })
        if (conflict) {
          await prisma.sourceMapping.delete({ where: { id: m.id } })
        } else {
          await prisma.sourceMapping.update({
            where: { id: m.id },
            data: { bibliographyId: canonical },
          })
          mergedRefs++
        }
      }

      // --- BibliographyAttachment
      const dupAtts = await prisma.bibliographyAttachment.findMany({
        where: { bibliographyId: dup },
        select: { id: true, sourceId: true },
      })
      for (const a of dupAtts) {
        const conflict = await prisma.bibliographyAttachment.findUnique({
          where: {
            bibliographyId_sourceId: {
              bibliographyId: canonical,
              sourceId: a.sourceId,
            },
          },
          select: { id: true },
        })
        if (conflict) {
          await prisma.bibliographyAttachment.delete({ where: { id: a.id } })
        } else {
          await prisma.bibliographyAttachment.update({
            where: { id: a.id },
            data: { bibliographyId: canonical },
          })
          mergedRefs++
        }
      }

      // --- SourceChunk (nullable FK, no unique constraint — just rewrite)
      const chunkUpdate = await prisma.sourceChunk.updateMany({
        where: { bibliographyId: dup },
        data: { bibliographyId: canonical },
      })
      mergedRefs += chunkUpdate.count

      // Now safe to delete the duplicate bib row.
      await prisma.bibliography.delete({ where: { id: dup } })
      deletedBibs++
    }
  }

  console.log('')
  console.log(`[dedup-bibliography] summary:`)
  console.log(`  groups        : ${groups.length}`)
  console.log(`  refs migrated : ${mergedRefs}`)
  console.log(`  bibs deleted  : ${deletedBibs}`)
  console.log(`  mode          : ${apply ? 'APPLIED' : 'DRY-RUN (re-run with --apply to commit)'}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
