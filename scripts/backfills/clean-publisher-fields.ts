/**
 * Bir-kerelik: PDF-upload pipeline'ının eski Haiku prompt'u publisher
 * field'ına telif sayfasının tamamını (kuruluş + adres + telefon + seri
 * no + URL) yazıyordu. Şu an publisher kolonu kullanılabilir ama görsel
 * olarak çöp.
 *
 * Bu script Haiku'ya HİÇBİR PDF içeriği vermez — sadece mevcut kirli
 * publisher string'ini verir ve "yalnızca organizasyon adını döndür"
 * der. Böylece:
 *   - Hallüsinasyon riski yok (yeni bilgi üretmez)
 *   - Yanlış publisher seçemez (çünkü seçim yapmıyor, kısaltıyor)
 *   - Boş döndüremez (en kötü orijinali döner)
 *   - Dil korunur (Türkçe → Türkçe, Arapça → Arapça)
 *
 * Sadece LibraryEntry.publisher kolonu güncellenir + bağlı tüm
 * Bibliography rows'da AYNI eski kirli değere sahip olanlar yenisiyle
 * değiştirilir (kullanıcının elle düzelttiği bib'ler dokunmaz).
 *
 * Kullanım:
 *   - Dry-run (default):  npx tsx scripts/backfills/clean-publisher-fields.ts
 *   - Apply:              npx tsx scripts/backfills/clean-publisher-fields.ts --apply
 *   - Tek user:           npx tsx scripts/backfills/clean-publisher-fields.ts --user <id>
 */
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { generateJSONWithUsage, HAIKU } from '../../src/lib/claude'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

const apply = process.argv.includes('--apply')
const userArg = process.argv.find((a, i, arr) => arr[i - 1] === '--user')

// Same red flags the rest of the codebase uses to mark a publisher as
// dirty — see lib/bibliography-extract.ts shouldFallback().
function isDirty(publisher: string | null): string | null {
  if (!publisher) return null
  if (publisher.length > 70) return 'too long'
  if (/\b(Tel|Faks?|Phone|Fax)\s*[:.]/i.test(publisher)) return 'phone/fax'
  if (/(www\.|https?:\/\/)/i.test(publisher)) return 'URL'
  if (/\b\d{4,}\b/.test(publisher)) return 'long digit run'
  if (/\b(Cad\.|Sok\.|Caddesi|Sokağı|Mah\.|Mahallesi|Street|Avenue|Road)\b/i.test(publisher)) {
    return 'address keyword'
  }
  return null
}

interface CleanResult {
  cleaned: string
}

async function cleanPublisher(messy: string): Promise<{ cleaned: string; inTok: number; outTok: number }> {
  const prompt = `You are a bibliographic data cleaner. The following "publisher" field has been polluted with extra data (street addresses, phone/fax numbers, postal codes, series numbers, catalog labels, URLs, sister-imprints). Your job is to strip everything except the publisher's actual organization name.

Input publisher string:
"""
${messy}
"""

Rules — non-negotiable:
1. Return ONLY the organization's official name (e.g. "Oxford University Press", "Klasik Yayınları", "دار الكتب العلمية").
2. PRESERVE THE LANGUAGE of the original. If the input is in Turkish, return Turkish. Arabic → Arabic. English → English. Do NOT translate. Do NOT transliterate Arabic into Latin.
3. If multiple publishers are co-listed (e.g. "X — Y co-published"), keep the first/primary one only.
4. NEVER invent or substitute a different publisher. If you cannot identify a clear organization name in the input, return the input exactly as you received it (unchanged).
5. NEVER return an empty string. If unsure, return the original.
6. Strip catalog metadata: "(yayın no. 108)", "(67. Kitap)", "Sertifika no. 17613", "Düşünce — İslam Felsefesi 14".
7. Strip addresses: "198 Madison Avenue", "Çaydamlı Basın", "Caferağa Mah.", "EH8 8PJ", "Vefa, İstanbul".
8. Strip contact info: "Tel: …", "Faks: …", "www.…", "https://…".
9. Strip co-imprint subtitles after em-dash or middot: " — Wiley Blackwell", " · Institute of Asian".

Return JSON: {"cleaned": "the cleaned publisher name"}`

  const result = await generateJSONWithUsage<CleanResult>(
    prompt,
    'You are a careful bibliographic data cleaner. You never invent new information. You always preserve the source language. You respond with valid JSON only.',
    { model: HAIKU },
  )

  return {
    cleaned: result.data.cleaned?.trim() || messy,
    inTok: result.inputTokens,
    outTok: result.outputTokens,
  }
}

async function main() {
  console.log(`[clean-publisher-fields] mode=${apply ? 'APPLY' : 'DRY-RUN'}`)
  if (userArg) console.log(`[clean-publisher-fields] filter user=${userArg}`)

  const entries = await prisma.libraryEntry.findMany({
    where: {
      ...(userArg && { userId: userArg }),
    },
    select: { id: true, authorSurname: true, title: true, publisher: true },
  })

  const dirty = entries
    .map((e) => ({ e, reason: isDirty(e.publisher) }))
    .filter((x) => x.reason !== null)

  console.log(`[clean-publisher-fields] scanned ${entries.length}, found ${dirty.length} dirty`)

  let fixedEntries = 0
  let fixedBibs = 0
  let unchanged = 0
  let totalIn = 0
  let totalOut = 0

  for (const { e, reason } of dirty) {
    const before = e.publisher!
    console.log(`\n— ${e.authorSurname} — ${e.title.slice(0, 50)}`)
    console.log(`  reason : ${reason}`)
    console.log(`  before : "${before.slice(0, 80)}${before.length > 80 ? '…' : ''}"`)

    let cleaned: string
    try {
      const r = await cleanPublisher(before)
      cleaned = r.cleaned
      totalIn += r.inTok
      totalOut += r.outTok
    } catch (err) {
      console.log(`  skip   : clean failed (${(err as Error).message})`)
      continue
    }

    if (cleaned === before) {
      console.log('  no change (Haiku kept original — likely already clean per heuristic)')
      unchanged++
      continue
    }
    if (!cleaned) {
      console.log('  skip   : Haiku returned empty (refused to delete data)')
      unchanged++
      continue
    }

    console.log(`  after  : "${cleaned}"`)

    if (apply) {
      // Update LibraryEntry.
      await prisma.libraryEntry.update({
        where: { id: e.id },
        data: { publisher: cleaned },
      })
      fixedEntries++

      // Update every Bibliography row that links to this entry AND still
      // carries the OLD dirty value. Bibs the user manually edited
      // (different from `before`) are left untouched.
      const bibUpdate = await prisma.bibliography.updateMany({
        where: { libraryEntryId: e.id, publisher: before },
        data: { publisher: cleaned },
      })
      fixedBibs += bibUpdate.count
    }
  }

  console.log('')
  console.log('[clean-publisher-fields] summary:')
  console.log(`  dirty found    : ${dirty.length}`)
  console.log(`  entries fixed  : ${fixedEntries}`)
  console.log(`  bib rows fixed : ${fixedBibs}`)
  console.log(`  unchanged      : ${unchanged}`)
  console.log(`  tokens in/out  : ${totalIn} / ${totalOut}`)
  console.log(`  mode           : ${apply ? 'APPLIED' : 'DRY-RUN (re-run with --apply to commit)'}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
