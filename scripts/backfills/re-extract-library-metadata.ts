/**
 * Bir-kerelik: PDF-upload pipeline'ının ilk versiyonu Haiku'ya zayıf bir
 * prompt verdiği için bir kısım LibraryEntry kirli metadata ile yüklendi
 * (publisher field'ında adres, OCR tipo'ları, makale → journal eksik).
 *
 * Bu script `lib/bibliography-extract.ts`'in iki-pass extraction'ını
 * kullanıp R2'deki PDF'lerden temiz metadata çıkarır ve sonucu (a)
 * LibraryEntry'e (b) bağlı tüm Bibliography satırlarına yansıtır.
 *
 * Sadece "kirli görünen" entry'ler işlenir (publisher quality flags ile
 * filtrelenir) — temiz olanlar dokunmaz.
 *
 * Kullanım:
 *   - Dry-run (default):  npx tsx scripts/backfills/re-extract-library-metadata.ts
 *   - Apply:              npx tsx scripts/backfills/re-extract-library-metadata.ts --apply
 *   - Tek user:           npx tsx scripts/backfills/re-extract-library-metadata.ts --user <id>
 */
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { getBytesFromFilePath } from '../../src/lib/r2-storage'
import { extractBibliographyFromText } from '../../src/lib/bibliography-extract'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

const apply = process.argv.includes('--apply')
const userArg = process.argv.find((a, i, arr) => arr[i - 1] === '--user')

// Same red flags that `bibliography-extract.ts` uses to trigger the
// Sonnet fallback. If an existing entry would have triggered them, it
// needs a re-pull.
function looksDirty(publisher: string | null, entryType: string, journalName: string | null): string | null {
  if (publisher) {
    if (publisher.length > 70) return 'publisher too long'
    if (/\b(Tel|Faks?|Phone|Fax)\s*[:.]/i.test(publisher)) return 'publisher has phone/fax'
    if (/(www\.|https?:\/\/)/i.test(publisher)) return 'publisher has URL'
    if (/\b\d{4,}\b/.test(publisher)) return 'publisher has long digit run'
    if (/\b(Cad\.|Sok\.|Caddesi|Sokağı|Mah\.|Mahallesi|Street|Avenue|Road)\b/i.test(publisher)) {
      return 'publisher has address keyword'
    }
  }
  if (entryType === 'makale' && !journalName) return 'article missing journalName'
  return null
}

const FIELDS = [
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
] as const

async function main() {
  console.log(`[re-extract-library-metadata] mode=${apply ? 'APPLY' : 'DRY-RUN'}`)
  if (userArg) console.log(`[re-extract-library-metadata] filter user=${userArg}`)

  const entries = await prisma.libraryEntry.findMany({
    where: {
      ...(userArg && { userId: userArg }),
      pdfStatus: 'ready',
      filePath: { not: null },
    },
  })

  const dirty = entries
    .map((e) => ({ e, reason: looksDirty(e.publisher, e.entryType, e.journalName) }))
    .filter((x) => x.reason !== null)

  console.log(
    `[re-extract-library-metadata] scanned ${entries.length}, found ${dirty.length} dirty`,
  )

  const pythonServiceUrl = process.env.PYTHON_SERVICE_URL ?? 'http://localhost:8001'
  let fixedCount = 0
  let sonnetUsedCount = 0
  let totalInTok = 0
  let totalOutTok = 0

  for (const { e, reason } of dirty) {
    console.log(`\n— ${e.authorSurname} — ${e.title.slice(0, 60)}`)
    console.log(`  reason : ${reason}`)
    console.log(`  before : publisher="${(e.publisher ?? '').slice(0, 70)}"`)

    // 1. Pull bytes from R2 → Python /process-bytes multipart → text.
    if (!e.filePath) {
      console.log('  skip: no filePath')
      continue
    }
    let firstPagesText = ''
    try {
      const bytes = await getBytesFromFilePath(e.filePath)
      const form = new FormData()
      form.append('sourceId', `re-extract-${e.id}`)
      form.append(
        'file',
        new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }),
        'work.pdf',
      )
      const response = await fetch(`${pythonServiceUrl}/process-bytes`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(120_000),
      })
      if (!response.ok) {
        console.log(`  skip: python /process-bytes HTTP ${response.status}`)
        continue
      }
      const data = (await response.json()) as { extractedText?: string }
      firstPagesText = (data.extractedText ?? '').slice(0, 8000)
    } catch (err) {
      console.log(`  skip: text extraction failed (${(err as Error).message})`)
      continue
    }

    if (firstPagesText.trim().length < 200) {
      console.log('  skip: not enough text extracted')
      continue
    }

    // 2. Two-pass extraction (Haiku → Sonnet fallback when needed).
    let extracted
    try {
      extracted = await extractBibliographyFromText(firstPagesText)
    } catch (err) {
      console.log(`  skip: extraction failed (${(err as Error).message})`)
      continue
    }
    if (extracted.modelUsed === 'sonnet') sonnetUsedCount++
    totalInTok += extracted.inputTokens
    totalOutTok += extracted.outputTokens

    console.log(`  model  : ${extracted.modelUsed}${extracted.fallbackReason ? ` (fallback: ${extracted.fallbackReason})` : ''}`)
    console.log(`  after  : publisher="${(extracted.data.publisher ?? '').slice(0, 70)}"`)

    // 3. Build per-field diff vs the current row.
    const updateData: Record<string, unknown> = {}
    for (const f of FIELDS) {
      const cur = (e as unknown as Record<string, unknown>)[f]
      const next = (extracted.data as unknown as Record<string, unknown>)[f]
      // Only overwrite when:
      //   - the new value is non-null AND
      //   - the new value differs from current AND
      //   - either current was the dirty one (publisher) or current was null
      // For publisher specifically the whole point IS to replace dirty
      // values, so we always overwrite when the new is non-null.
      const isPublisherFix = f === 'publisher' && reason?.startsWith('publisher')
      if (next == null) continue
      if (cur === next) continue
      if (cur != null && !isPublisherFix) continue
      updateData[f] = next
    }

    if (Object.keys(updateData).length === 0) {
      console.log('  no metadata changes after diff')
      continue
    }
    console.log(`  changes: ${Object.keys(updateData).join(', ')}`)

    if (apply) {
      // 4. Apply to LibraryEntry.
      await prisma.libraryEntry.update({
        where: { id: e.id },
        data: updateData,
      })
      // 5. Propagate to bibliography rows that link to this entry — only
      //    fill columns that are currently null/empty there (a manual
      //    edit on a bib row wins over re-extract).
      const bibUpdate: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(updateData)) {
        // For publisher we mirror the cleaned value to bibs that still
        // show the OLD dirty publisher value (so the user's cleanup is
        // visible in every project that cites this entry).
        if (k === 'publisher') {
          bibUpdate[k] = v
        } else {
          bibUpdate[k] = v
        }
      }
      // Run two updateMany calls so publisher overwrites even when the
      // bib row already has a value (synced from the dirty version),
      // but other fields only fill nulls.
      if ('publisher' in bibUpdate) {
        await prisma.bibliography.updateMany({
          where: { libraryEntryId: e.id },
          data: { publisher: bibUpdate.publisher as string },
        })
      }
      const otherFields = { ...bibUpdate }
      delete otherFields.publisher
      for (const [k, v] of Object.entries(otherFields)) {
        await prisma.bibliography.updateMany({
          where: { libraryEntryId: e.id, [k]: null },
          data: { [k]: v },
        })
      }
      fixedCount++
    }
  }

  console.log('')
  console.log('[re-extract-library-metadata] summary:')
  console.log(`  dirty found    : ${dirty.length}`)
  console.log(`  fixed          : ${fixedCount}`)
  console.log(`  sonnet used    : ${sonnetUsedCount}`)
  console.log(`  tokens in/out  : ${totalInTok} / ${totalOutTok}`)
  console.log(`  mode           : ${apply ? 'APPLIED' : 'DRY-RUN (re-run with --apply to commit)'}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
