/**
 * Backfill ProjectAcademicMeta from the old flat columns on Project.
 *
 * For every project with projectType === 'ACADEMIC' we build an
 * AcademicMeta object that matches the project's citationFormat, using
 * whatever values are present on the old flat columns. Missing fields
 * are null — the user fills them in via the new format-aware form on
 * the next edit.
 *
 * Safe to re-run: upserts by projectId; existing ProjectAcademicMeta
 * rows are updated with the newest flat-column snapshot.
 *
 *   npx tsx scripts/backfill-academic-meta.ts [--dry]
 *
 * The old flat columns are NOT deleted by this script. Keep them one
 * release cycle so exports and the old form keep working during the
 * rollout. A follow-up migration drops them after we confirm the new
 * table is in use.
 */

import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, type CitationFormat } from '@prisma/client'
import { emptyMetaFor, type AcademicMeta } from '../../src/lib/academic-meta'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

const DRY_RUN = process.argv.includes('--dry')

type FlatSnapshot = {
  id: string
  citationFormat: CitationFormat
  author: string | null
  institution: string | null
  department: string | null
  advisor: string | null
  abstractTr: string | null
  abstractEn: string | null
  keywordsTr: string[]
  keywordsEn: string[]
  acknowledgments: string | null
  dedication: string | null
}

/**
 * Build a format-correct AcademicMeta from the flat snapshot. The old
 * schema only carried a Turkish-thesis subset of fields, so formats
 * other than ISNAD get a sparse object — enough to preserve author /
 * institution / acknowledgments but without the per-format specifics.
 */
function buildMeta(snap: FlatSnapshot): AcademicMeta {
  const empty = emptyMetaFor(snap.citationFormat)

  // Common fields that existed on the old flat shape.
  const author = snap.author?.trim() || '—'
  const institution = snap.institution?.trim() || null
  const department = snap.department?.trim() || null
  const acknowledgments = snap.acknowledgments?.trim() || null
  const dedication = snap.dedication?.trim() || null
  const abstract = snap.abstractEn?.trim() || snap.abstractTr?.trim() || null
  const keywords =
    snap.keywordsEn.length > 0 ? snap.keywordsEn : snap.keywordsTr

  switch (empty.format) {
    case 'APA':
      return {
        ...empty,
        author,
        institution,
        department,
        abstract,
        keywords,
        acknowledgments,
        dedication,
      }
    case 'MLA':
      return { ...empty, author, abstract, keywords, acknowledgments, dedication }
    case 'CHICAGO':
      return {
        ...empty,
        author,
        institution,
        department,
        abstract,
        keywords,
        acknowledgments,
        dedication,
      }
    case 'TURABIAN':
      return {
        ...empty,
        author,
        institution,
        department,
        advisor: snap.advisor?.trim() || null,
        abstract,
        keywords,
        acknowledgments,
        dedication,
      }
    case 'HARVARD':
      return {
        ...empty,
        author,
        institution,
        supervisor: snap.advisor?.trim() || null,
        abstract,
        keywords,
        acknowledgments,
        dedication,
      }
    case 'IEEE':
      return {
        ...empty,
        authors: [
          {
            ...empty.authors[0],
            name: author,
            department,
            institution,
          },
        ],
        abstract,
        indexTerms: keywords,
        acknowledgments,
      }
    case 'VANCOUVER':
      return {
        ...empty,
        authors: [
          {
            ...empty.authors[0],
            name: author,
            department,
            institution,
          },
        ],
        // The old flat `abstract` was one paragraph — park it in
        // `background` so no prose is lost. The user re-splits into
        // Methods/Results/Conclusions on the new form.
        structuredAbstract: {
          ...empty.structuredAbstract,
          background: abstract,
        },
        keywords,
        acknowledgments,
      }
    case 'AMA':
      return {
        ...empty,
        authors: [
          {
            ...empty.authors[0],
            name: author,
            department,
            institution,
          },
        ],
        structuredAbstract: {
          ...empty.structuredAbstract,
          importance: abstract,
        },
        keywords,
        acknowledgments,
      }
    case 'ISNAD':
      return {
        ...empty,
        author,
        institution,
        department,
        advisor: snap.advisor?.trim() || null,
        abstractTr: snap.abstractTr?.trim() || null,
        abstractEn: snap.abstractEn?.trim() || null,
        keywordsTr: snap.keywordsTr,
        keywordsEn: snap.keywordsEn,
        acknowledgments,
        dedication,
      }
  }
}

async function main() {
  const projects = await prisma.project.findMany({
    where: { projectType: 'ACADEMIC' },
    select: {
      id: true,
      citationFormat: true,
      author: true,
      institution: true,
      department: true,
      advisor: true,
      abstractTr: true,
      abstractEn: true,
      keywordsTr: true,
      keywordsEn: true,
      acknowledgments: true,
      dedication: true,
    },
  })

  console.log(
    `${DRY_RUN ? '[dry-run] ' : ''}Processing ${projects.length} academic projects`
  )

  let created = 0
  let skipped = 0
  for (const snap of projects) {
    const meta = buildMeta(snap as FlatSnapshot)
    if (DRY_RUN) {
      console.log(`  ${snap.id} → ${meta.format}`)
      created++
      continue
    }
    try {
      await prisma.projectAcademicMeta.upsert({
        where: { projectId: snap.id },
        create: {
          projectId: snap.id,
          format: meta.format,
          schemaVersion: 1,
          meta: meta as unknown as object,
        },
        update: {
          format: meta.format,
          schemaVersion: 1,
          meta: meta as unknown as object,
        },
      })
      created++
    } catch (err) {
      console.error(`  ! ${snap.id}`, err)
      skipped++
    }
  }

  console.log(`Done. ${created} upserted, ${skipped} failed.`)
  await prisma.$disconnect()
  await pool.end()
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect().catch(() => {})
  await pool.end().catch(() => {})
  process.exit(1)
})
