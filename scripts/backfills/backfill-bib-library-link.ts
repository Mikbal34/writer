/**
 * Bir-kerelik: orphan Bibliography satırlarını (libraryEntryId IS NULL)
 * kullanıcının kütüphanesindeki eşleşen LibraryEntry'lere bağla ve eksik
 * metadata kolonlarını (year/publisher/publishPlace/editor/translator/…)
 * doldur.
 *
 * Strateji (`lib/bibliography.ts`'deki resolveLibraryMatch ile aynı):
 *   1. Strict eşleşme: (project.userId, authorSurname, title) tam eşit
 *   2. Fuzzy: normalize(surname) + normalize(title) — case/punctuation
 *      insensitive, combining mark stripping
 *
 * Eksik metadata yalnızca NULL kolonlara yazılır (non-destructive).
 *
 * Kullanım:
 *   - Dry-run (default):   npx tsx scripts/backfills/backfill-bib-library-link.ts
 *   - Apply:               npx tsx scripts/backfills/backfill-bib-library-link.ts --apply
 *   - Tek user:            npx tsx scripts/backfills/backfill-bib-library-link.ts --user <userId>
 *   - Tek proje:           npx tsx scripts/backfills/backfill-bib-library-link.ts --project <projectId>
 *
 * Production VM'de:
 *   docker compose -f docker-compose.prod.yml exec web npx tsx \
 *     scripts/backfills/backfill-bib-library-link.ts --apply
 */
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { normalizeForMatch } from '../../src/lib/bibliography'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

type Args = { apply: boolean; user?: string; project?: string }

function parseArgs(): Args {
  const args = process.argv.slice(2)
  const result: Args = { apply: false }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--apply') result.apply = true
    else if (a === '--user') result.user = args[++i]
    else if (a === '--project') result.project = args[++i]
  }
  return result
}

const METADATA_FIELDS = [
  'authorName',
  'shortTitle',
  'editor',
  'translator',
  'publisher',
  'publishPlace',
  'year',
  'volume',
  'edition',
  'journalName',
  'journalVolume',
  'journalIssue',
  'pageRange',
  'doi',
  'url',
  'accessDate',
] as const

async function main() {
  const { apply, user, project } = parseArgs()
  console.log(`[backfill-bib-library-link] mode=${apply ? 'APPLY' : 'DRY-RUN'}`)
  if (user) console.log(`[backfill-bib-library-link] filter userId=${user}`)
  if (project) console.log(`[backfill-bib-library-link] filter projectId=${project}`)

  const projectWhere: Record<string, unknown> = {}
  if (project) projectWhere.id = project
  if (user) projectWhere.userId = user

  // Pull all orphan bibs (with their project's userId so we can scope the
  // library lookup to the owning user).
  const orphans = await prisma.bibliography.findMany({
    where: {
      libraryEntryId: null,
      project: Object.keys(projectWhere).length > 0 ? projectWhere : undefined,
    },
    select: {
      id: true,
      projectId: true,
      authorSurname: true,
      title: true,
      authorName: true,
      shortTitle: true,
      editor: true,
      translator: true,
      publisher: true,
      publishPlace: true,
      year: true,
      volume: true,
      edition: true,
      journalName: true,
      journalVolume: true,
      journalIssue: true,
      pageRange: true,
      doi: true,
      url: true,
      accessDate: true,
      project: { select: { userId: true } },
    },
  })

  console.log(`[backfill-bib-library-link] found ${orphans.length} orphan bibs`)

  // Group orphans by userId so we cache each user's library lookups.
  const byUser = new Map<string, typeof orphans>()
  for (const o of orphans) {
    const uid = o.project.userId
    const arr = byUser.get(uid) ?? []
    arr.push(o)
    byUser.set(uid, arr)
  }

  let exactMatches = 0
  let fuzzyMatches = 0
  let unchanged = 0
  let fieldsFilled = 0

  for (const [userId, bibs] of byUser) {
    // Per-user library cache: pull all entries once and normalize keys.
    const libEntries = await prisma.libraryEntry.findMany({
      where: { userId },
    })
    const exactIndex = new Map<string, typeof libEntries[number]>()
    // Group library entries by normalized surname so prefix lookup is O(per-surname).
    const bySurname = new Map<string, typeof libEntries>()
    for (const e of libEntries) {
      exactIndex.set(`${e.authorSurname}|||${e.title}`, e)
      const ns = normalizeForMatch(e.authorSurname)
      if (!ns) continue
      const arr = bySurname.get(ns) ?? []
      arr.push(e)
      bySurname.set(ns, arr)
    }

    for (const bib of bibs) {
      const exactKey = `${bib.authorSurname}|||${bib.title}`
      const exact = exactIndex.get(exactKey)

      let fuzzy: typeof libEntries[number] | undefined
      if (!exact) {
        const ns = normalizeForMatch(bib.authorSurname)
        const nt = normalizeForMatch(bib.title)
        if (ns && nt) {
          const minTokens = (s: string) => s.split(' ').length >= 3
          const candidates = bySurname.get(ns) ?? []
          fuzzy = candidates.find((c) => {
            const ct = normalizeForMatch(c.title)
            if (ct === nt) return true
            if (!minTokens(ct) || !minTokens(nt)) return false
            return ct.startsWith(nt + ' ') || nt.startsWith(ct + ' ')
          })
        }
      }

      const match = exact ?? fuzzy
      if (!match) {
        unchanged++
        continue
      }

      if (exact) exactMatches++
      else fuzzyMatches++

      const updateData: Record<string, unknown> = { libraryEntryId: match.id }
      let filled = 0
      for (const f of METADATA_FIELDS) {
        const current = (bib as unknown as Record<string, unknown>)[f]
        const fromLib = (match as unknown as Record<string, unknown>)[f]
        if (current == null && fromLib != null) {
          updateData[f] = fromLib
          filled++
        }
      }
      fieldsFilled += filled

      console.log(
        `  ${exact ? '✓ exact' : '~ fuzzy'} bib=${bib.id} (${bib.authorSurname}, ${bib.title.slice(0, 60)}) → lib=${match.id}` +
          (filled > 0 ? `  + ${filled} metadata field${filled > 1 ? 's' : ''} filled` : ''),
      )

      if (apply) {
        await prisma.bibliography.update({
          where: { id: bib.id },
          data: updateData,
        })
      }
    }
  }

  console.log('')
  console.log(`[backfill-bib-library-link] summary:`)
  console.log(`  exact matches: ${exactMatches}`)
  console.log(`  fuzzy matches: ${fuzzyMatches}`)
  console.log(`  unmatched   : ${unchanged}`)
  console.log(`  metadata fields filled: ${fieldsFilled}`)
  console.log(`  mode: ${apply ? 'APPLIED' : 'DRY-RUN (re-run with --apply to commit)'}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
