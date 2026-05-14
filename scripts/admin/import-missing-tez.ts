/**
 * One-shot import for the 6 tez_kaynaklar_pdf books that didn't make
 * it into Berat's library on the initial pass (no _cXX suffix and not
 * matched by his earlier manual uploads). Each is treated as a single
 * book — created via /api/bulk-import/entry, file attached as cilt 1
 * via /api/bulk-import/cilt.
 *
 * Usage:
 *   ADMIN_TOKEN="..." TARGET_USER_ID="..." \
 *     npx tsx scripts/admin/import-missing-tez.ts
 */
import fs from 'node:fs'
import path from 'node:path'

const BASE_URL = process.env.BASE_URL ?? 'https://quilpen.com'
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? ''
const TARGET_USER_ID = process.env.TARGET_USER_ID ?? ''
const ROOT = process.env.WORKS_ROOT ?? '/Users/ikbalkoc/Desktop/tez_kaynaklar_pdf'

if (!ADMIN_TOKEN || !TARGET_USER_ID) {
  console.error('ADMIN_TOKEN ve TARGET_USER_ID gerekli')
  process.exit(1)
}

interface Item {
  file: string
  authorSurname: string
  authorName: string
  title: string
  year: string
}

const ITEMS: Item[] = [
  {
    file: '13_Bell_RitualPerspectivesDimensions/EN_Bell_RitualPerspectivesDimensions.pdf',
    authorSurname: 'Bell',
    authorName: 'Catherine',
    title: 'Ritual: Perspectives and Dimensions',
    year: '1997',
  },
  {
    file: '15_Gimaret_DoctrineAlAshari/FR_Gimaret_DoctrineAlAshari.pdf',
    authorSurname: 'Gimaret',
    authorName: 'Daniel',
    title: "La doctrine d'al-Ash'arī",
    year: '1990',
  },
  {
    file: '21_Peters_MeccaLiteraryHistory/EN_Peters_MeccaLiteraryHistory.pdf',
    authorSurname: 'Peters',
    authorName: 'F. E.',
    title: 'Mecca: A Literary History of the Muslim Holy Land',
    year: '1994',
  },
  {
    file: '26_Wolfson_PhilosophyOfKalam/EN_Wolfson_PhilosophyOfKalam.pdf',
    authorSurname: 'Wolfson',
    authorName: 'Harry Austryn',
    title: 'The Philosophy of the Kalam',
    year: '1976',
  },
  {
    file: '35_Douglas_PurityAndDanger/EN_Douglas_PurityAndDanger.pdf',
    authorSurname: 'Douglas',
    authorName: 'Mary',
    title: 'Purity and Danger: An Analysis of Concepts of Pollution and Taboo',
    year: '1966',
  },
  {
    file: '41_Frank_GhazaliAsharite/EN_Frank_GhazaliAsharite.pdf',
    authorSurname: 'Frank',
    authorName: 'Richard M.',
    title: "Al-Ghazali and the Ash'arite School",
    year: '1994',
  },
]

async function api(p: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE_URL}${p}`, {
    ...init,
    headers: {
      'x-admin-token': ADMIN_TOKEN,
      ...(init.headers ?? {}),
    },
  })
}

async function createEntry(item: Item): Promise<string> {
  const res = await api('/api/bulk-import/entry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: TARGET_USER_ID,
      authorSurname: item.authorSurname,
      authorName: item.authorName,
      title: item.title,
      year: item.year,
      // These are single-PDF books, not multi-volume works. The cilt
      // endpoint still gets called once with volumeNumber=1, but we
      // tag the parent differently so the UI shows them as standalone.
      importSource: 'admin-import',
    }),
  })
  if (!res.ok) throw new Error(`entry ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { id: string }
  return data.id
}

async function uploadCilt(entryId: string, filePath: string): Promise<void> {
  const buf = fs.readFileSync(filePath)
  const fd = new FormData()
  fd.set('file', new Blob([buf], { type: 'application/pdf' }), path.basename(filePath))
  fd.set('entryId', entryId)
  fd.set('volumeNumber', '1')
  const res = await api('/api/bulk-import/cilt', { method: 'POST', body: fd })
  if (!res.ok) throw new Error(`cilt ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

async function main() {
  console.log(`Base: ${BASE_URL}\nTarget: ${TARGET_USER_ID}\n`)
  const done: string[] = []
  const failed: string[] = []

  for (let i = 0; i < ITEMS.length; i++) {
    const item = ITEMS[i]
    const tag = `[${i + 1}/${ITEMS.length}] ${item.authorSurname} — ${item.title}`
    console.log(tag)
    const filePath = path.join(ROOT, item.file)
    if (!fs.existsSync(filePath)) {
      console.error(`    ✗ dosya yok: ${filePath}`)
      failed.push(`${item.title}: file missing`)
      continue
    }
    try {
      const entryId = await createEntry(item)
      console.log(`    entry: ${entryId}`)
      await uploadCilt(entryId, filePath)
      console.log(`    ✓ yüklendi`)
      done.push(item.title)
      // Give Python a moment between uploads.
      if (i < ITEMS.length - 1) await new Promise((r) => setTimeout(r, 8000))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`    ✗ ${msg}`)
      failed.push(`${item.title}: ${msg}`)
    }
  }

  console.log(`\n=== Özet ===`)
  console.log(`✓ Yüklenen: ${done.length}`)
  console.log(`✗ Başarısız: ${failed.length}`)
  if (failed.length) {
    for (const f of failed) console.log(`  - ${f}`)
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
