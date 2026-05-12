/**
 * Bulk-import classical Islamic works into a user's library.
 *
 * Walks `WORKS_ROOT` (default: /Users/ikbalkoc/Desktop/klasik_eserler),
 * matches each numbered folder against the canonical Arabic metadata
 * table below, then uploads via the production API as the logged-in
 * user identified by NEXTAUTH_COOKIE.
 *
 *   - 1 PDF, no `_cXX` suffix → standalone book (/api/library/upload-pdf)
 *   - 1+ PDFs with `_cXX` suffix → multi-volume work: POST /api/library
 *     to create the parent, then POST /api/library/[id]/volumes per cilt
 *     with the explicit volumeNumber parsed from the filename.
 *
 * Idempotent-ish: GET /api/library is consulted once at startup to skip
 * works already present (matched by authorSurname + title).
 *
 * Files >50MB are skipped and reported at the end so the user can
 * upload them manually (after compressing) — that's the route limit.
 *
 * Usage:
 *   NEXTAUTH_COOKIE="<cookie-value>" \
 *     npx tsx scripts/admin/bulk-import-classical.ts
 *
 * Cookie source: Chrome devtools → Application → Cookies → quilpen.com
 *   → "__Secure-next-auth.session-token" (or "next-auth.session-token"
 *   in non-HTTPS contexts). Copy the whole value.
 */
import fs from 'node:fs'
import path from 'node:path'

interface WorkMeta {
  authorSurname: string
  authorName?: string
  title: string
  year?: string
}

// Canonical Arabic author + title for each numbered folder. Surname is
// what shows in citations (nisbah for classical authors), authorName is
// the given name / kunya. Year is the author's death year in hijri.
const WORKS: Record<string, WorkMeta> = {
  '01_Maturidi_KitabuTevhid': {
    authorSurname: 'الماتريدي',
    authorName: 'أبو منصور محمد بن محمد',
    title: 'كتاب التوحيد',
    year: '333 هـ',
  },
  '02_Maturidi_TevilatuEhlisSunne': {
    authorSurname: 'الماتريدي',
    authorName: 'أبو منصور محمد بن محمد',
    title: 'تأويلات أهل السنة',
    year: '333 هـ',
  },
  '03_Nesefi_TebsiratulEdille': {
    authorSurname: 'النسفي',
    authorName: 'أبو المعين ميمون بن محمد',
    title: 'تبصرة الأدلة في أصول الدين',
    year: '508 هـ',
  },
  '04_Sabuni_BidayeMinKifaye': {
    authorSurname: 'الصابوني',
    authorName: 'نور الدين أحمد بن محمود',
    title: 'البداية من الكفاية في الهداية في أصول الدين',
    year: '580 هـ',
  },
  '05_Bakillani_Temhid': {
    authorSurname: 'الباقلاني',
    authorName: 'أبو بكر محمد بن الطيب',
    title: 'التمهيد في الرد على الملحدة المعطلة والرافضة والخوارج والمعتزلة',
    year: '403 هـ',
  },
  '06_KadiAbdulcabbar_SerhUsulHamse': {
    authorSurname: 'القاضي عبد الجبار',
    authorName: 'أبو الحسن عبد الجبار بن أحمد الهمداني',
    title: 'شرح الأصول الخمسة',
    year: '415 هـ',
  },
  '07_Cuveyni_Irsad': {
    authorSurname: 'الجويني',
    authorName: 'إمام الحرمين أبو المعالي عبد الملك',
    title: 'الإرشاد إلى قواطع الأدلة في أصول الاعتقاد',
    year: '478 هـ',
  },
  '08_Gazali_Ihya': {
    authorSurname: 'الغزالي',
    authorName: 'أبو حامد محمد بن محمد',
    title: 'إحياء علوم الدين',
    year: '505 هـ',
  },
  '09_Gazali_EsraruelHac': {
    authorSurname: 'الغزالي',
    authorName: 'أبو حامد محمد بن محمد',
    title: 'أسرار الحج',
    year: '505 هـ',
  },
  '10_Gazali_Munkiz': {
    authorSurname: 'الغزالي',
    authorName: 'أبو حامد محمد بن محمد',
    title: 'المنقذ من الضلال',
    year: '505 هـ',
  },
  '11_Gazali_IktisadFilItikad': {
    authorSurname: 'الغزالي',
    authorName: 'أبو حامد محمد بن محمد',
    title: 'الاقتصاد في الاعتقاد',
    year: '505 هـ',
  },
  '12_Razi_MefatihulGayb': {
    authorSurname: 'الرازي',
    authorName: 'فخر الدين أبو عبد الله محمد بن عمر',
    title: 'مفاتيح الغيب (التفسير الكبير)',
    year: '606 هـ',
  },
  '13_Razi_LevamiulBeyyinat': {
    authorSurname: 'الرازي',
    authorName: 'فخر الدين أبو عبد الله محمد بن عمر',
    title: 'لوامع البينات شرح أسماء الله تعالى والصفات',
    year: '606 هـ',
  },
  '14_Razi_MetalibulAliye': {
    authorSurname: 'الرازي',
    authorName: 'فخر الدين أبو عبد الله محمد بن عمر',
    title: 'المطالب العالية من العلم الإلهي',
    year: '606 هـ',
  },
  '15_Mevakif_Ici': {
    authorSurname: 'الإيجي',
    authorName: 'عضد الدين عبد الرحمن بن أحمد',
    title: 'المواقف في علم الكلام',
    year: '756 هـ',
  },
  '16_Curcani_SerhulMevakif': {
    authorSurname: 'الجرجاني',
    authorName: 'السيد الشريف علي بن محمد',
    title: 'شرح المواقف',
    year: '816 هـ',
  },
  '17_Teftazani_SerhulAkaid': {
    authorSurname: 'التفتازاني',
    authorName: 'سعد الدين مسعود بن عمر',
    title: 'شرح العقائد النسفية',
    year: '793 هـ',
  },
  '18_Taberi_CamiulBeyan': {
    authorSurname: 'الطبري',
    authorName: 'أبو جعفر محمد بن جرير',
    title: 'جامع البيان عن تأويل آي القرآن',
    year: '310 هـ',
  },
  '19_Zemahseri_Kessaf': {
    authorSurname: 'الزمخشري',
    authorName: 'جار الله أبو القاسم محمود بن عمر',
    title: 'الكشاف عن حقائق غوامض التنزيل',
    year: '538 هـ',
  },
  '20_Kurtubi_CamiLiAhkam': {
    authorSurname: 'القرطبي',
    authorName: 'أبو عبد الله محمد بن أحمد الأنصاري',
    title: 'الجامع لأحكام القرآن',
    year: '671 هـ',
  },
  '21_Kurtubi_Tezkire': {
    authorSurname: 'القرطبي',
    authorName: 'أبو عبد الله محمد بن أحمد الأنصاري',
    title: 'التذكرة بأحوال الموتى وأمور الآخرة',
    year: '671 هـ',
  },
  '22_IbnAsur_TahrirvetTenvir': {
    authorSurname: 'ابن عاشور',
    authorName: 'محمد الطاهر',
    title: 'التحرير والتنوير',
    year: '1393 هـ',
  },
  '23_Vahidi_EsbabuNuzul': {
    authorSurname: 'الواحدي',
    authorName: 'أبو الحسن علي بن أحمد النيسابوري',
    title: 'أسباب نزول القرآن',
    year: '468 هـ',
  },
  '24_Suyuti_Itkan': {
    authorSurname: 'السيوطي',
    authorName: 'جلال الدين عبد الرحمن بن أبي بكر',
    title: 'الإتقان في علوم القرآن',
    year: '911 هـ',
  },
  '25_Suyuti_DurrulMensur': {
    authorSurname: 'السيوطي',
    authorName: 'جلال الدين عبد الرحمن بن أبي بكر',
    title: 'الدر المنثور في التفسير بالمأثور',
    year: '911 هـ',
  },
  '26_Salebi_AraisulMecalis': {
    authorSurname: 'الثعلبي',
    authorName: 'أبو إسحاق أحمد بن محمد',
    title: 'عرائس المجالس في قصص الأنبياء',
    year: '427 هـ',
  },
  '27_Muhasibi_RiayeLiHukukillah': {
    authorSurname: 'المحاسبي',
    authorName: 'أبو عبد الله الحارث بن أسد',
    title: 'الرعاية لحقوق الله',
    year: '243 هـ',
  },
  '28_Kuseyri_RisaletulKuseyriyye': {
    authorSurname: 'القشيري',
    authorName: 'أبو القاسم عبد الكريم بن هوازن',
    title: 'الرسالة القشيرية',
    year: '465 هـ',
  },
  '29_IbnArabi_FutuhatMekkiye': {
    authorSurname: 'ابن عربي',
    authorName: 'محيي الدين أبو عبد الله محمد بن علي',
    title: 'الفتوحات المكية',
    year: '638 هـ',
  },
  '30_IbnArabi_FususHikem': {
    authorSurname: 'ابن عربي',
    authorName: 'محيي الدين أبو عبد الله محمد بن علي',
    title: 'فصوص الحكم',
    year: '638 هـ',
  },
  '31_IbnHaldun_Mukaddime': {
    authorSurname: 'ابن خلدون',
    authorName: 'عبد الرحمن بن محمد',
    title: 'المقدمة',
    year: '808 هـ',
  },
  '32_IbnHisam_SiretunNebeviyye': {
    authorSurname: 'ابن هشام',
    authorName: 'أبو محمد عبد الملك',
    title: 'السيرة النبوية',
    year: '213 هـ',
  },
  '33_IbnSad_TabakatulKubra': {
    authorSurname: 'ابن سعد',
    authorName: 'أبو عبد الله محمد بن سعد',
    title: 'الطبقات الكبرى',
    year: '230 هـ',
  },
  '34_Vakidi_Megazi': {
    authorSurname: 'الواقدي',
    authorName: 'أبو عبد الله محمد بن عمر',
    title: 'المغازي',
    year: '207 هـ',
  },
  '35_Taberi_TarihuRusul': {
    authorSurname: 'الطبري',
    authorName: 'أبو جعفر محمد بن جرير',
    title: 'تاريخ الرسل والملوك',
    year: '310 هـ',
  },
  '36_Ezreki_AhbarMekke': {
    authorSurname: 'الأزرقي',
    authorName: 'أبو الوليد محمد بن عبد الله',
    title: 'أخبار مكة وما جاء فيها من الآثار',
    year: '250 هـ',
  },
  '37_IbnKelbi_Asnam': {
    authorSurname: 'ابن الكلبي',
    authorName: 'أبو المنذر هشام بن محمد',
    title: 'كتاب الأصنام',
    year: '204 هـ',
  },
  '38_IbnBattuta_Rihle': {
    authorSurname: 'ابن بطوطة',
    authorName: 'أبو عبد الله محمد بن عبد الله',
    title: 'تحفة النظار في غرائب الأمصار وعجائب الأسفار (الرحلة)',
    year: '779 هـ',
  },
  '39_IbnCubeyr_Rihle': {
    authorSurname: 'ابن جبير',
    authorName: 'أبو الحسين محمد بن أحمد',
    title: 'رحلة ابن جبير',
    year: '614 هـ',
  },
  '40_IbnKayyim_ZadulMead': {
    authorSurname: 'ابن قيم الجوزية',
    authorName: 'شمس الدين أبو عبد الله محمد بن أبي بكر',
    title: 'زاد المعاد في هدي خير العباد',
    year: '751 هـ',
  },
  '41_Serahsi_Mebsut': {
    authorSurname: 'السرخسي',
    authorName: 'شمس الأئمة أبو بكر محمد بن أحمد',
    title: 'المبسوط',
    year: '483 هـ',
  },
  '42_Kasani_BedaiusSanai': {
    authorSurname: 'الكاساني',
    authorName: 'علاء الدين أبو بكر بن مسعود',
    title: 'بدائع الصنائع في ترتيب الشرائع',
    year: '587 هـ',
  },
}

const BASE_URL = process.env.BASE_URL ?? 'https://quilpen.com'
const COOKIE = process.env.NEXTAUTH_COOKIE ?? ''
const WORKS_ROOT = process.env.WORKS_ROOT ?? '/Users/ikbalkoc/Desktop/klasik_eserler'
const MAX_BYTES = 50 * 1024 * 1024
const DELAY_MS = parseInt(process.env.DELAY_MS ?? '5000', 10)

if (!COOKIE) {
  console.error('NEXTAUTH_COOKIE env var gerekli — Chrome devtools → Application → Cookies → quilpen.com → __Secure-next-auth.session-token değerini ver.')
  process.exit(1)
}

// Accept either bare token or "name=value" form.
const cookieHeader = COOKIE.includes('=')
  ? COOKIE
  : `__Secure-next-auth.session-token=${COOKIE}`

interface FileMeta {
  path: string
  volumeNumber: number | null
  size: number
}

function parseCilt(filename: string): number | null {
  const m = filename.match(/_c(\d+)/i)
  return m ? parseInt(m[1], 10) : null
}

function listPdfs(dir: string): FileMeta[] {
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(pdf|epub|docx)$/i.test(f))
    .map((f) => {
      const full = path.join(dir, f)
      return {
        path: full,
        volumeNumber: parseCilt(f),
        size: fs.statSync(full).size,
      }
    })
    .sort((a, b) => (a.volumeNumber ?? 0) - (b.volumeNumber ?? 0))
}

async function api(p: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE_URL}${p}`, {
    ...init,
    headers: {
      cookie: cookieHeader,
      ...(init.headers ?? {}),
    },
  })
}

async function loadExisting(): Promise<Set<string>> {
  // Pages of 50, walk until empty.
  const keys = new Set<string>()
  for (let page = 1; page < 100; page++) {
    const res = await api(`/api/library?page=${page}&limit=50`)
    if (!res.ok) {
      throw new Error(`GET /api/library page ${page} → ${res.status}`)
    }
    const data = (await res.json()) as {
      entries: Array<{ authorSurname: string; title: string }>
    }
    if (!data.entries.length) break
    for (const e of data.entries) {
      keys.add(`${e.authorSurname}|${e.title}`)
    }
    if (data.entries.length < 50) break
  }
  return keys
}

async function uploadSingle(file: FileMeta): Promise<void> {
  const buf = fs.readFileSync(file.path)
  const fd = new FormData()
  fd.set('file', new Blob([buf], { type: 'application/pdf' }), path.basename(file.path))
  const res = await api('/api/library/upload-pdf', { method: 'POST', body: fd })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`upload-pdf ${res.status}: ${err.slice(0, 200)}`)
  }
}

async function createParent(meta: WorkMeta): Promise<string> {
  const res = await api('/api/library', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      authorSurname: meta.authorSurname,
      authorName: meta.authorName,
      title: meta.title,
      year: meta.year,
      importSource: 'multi-volume',
    }),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`POST /api/library ${res.status}: ${err.slice(0, 200)}`)
  }
  const data = (await res.json()) as { id: string }
  return data.id
}

async function uploadVolume(
  parentId: string,
  file: FileMeta,
  fallbackCilt: number,
): Promise<void> {
  const buf = fs.readFileSync(file.path)
  const fd = new FormData()
  fd.set('file', new Blob([buf], { type: 'application/pdf' }), path.basename(file.path))
  fd.set('volumeNumber', String(file.volumeNumber ?? fallbackCilt))
  const res = await api(`/api/library/${parentId}/volumes`, { method: 'POST', body: fd })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`volumes POST ${res.status}: ${err.slice(0, 200)}`)
  }
}

async function main() {
  console.log(`Base: ${BASE_URL}`)
  console.log(`Works root: ${WORKS_ROOT}`)
  console.log(`Delay between cilt uploads: ${DELAY_MS}ms\n`)

  console.log('Mevcut kütüphane okunuyor…')
  const existing = await loadExisting()
  console.log(`  → ${existing.size} mevcut entry bulundu\n`)

  const folders = fs
    .readdirSync(WORKS_ROOT)
    .filter((f) => /^\d+_/.test(f))
    .sort()

  const skipped: string[] = []
  const failed: string[] = []
  const done: string[] = []
  const already: string[] = []

  for (const folder of folders) {
    const meta = WORKS[folder]
    if (!meta) {
      console.warn(`[?] ${folder}: metadata yok, atlandı`)
      continue
    }

    const key = `${meta.authorSurname}|${meta.title}`
    if (existing.has(key)) {
      already.push(folder)
      console.log(`[=] ${folder}: zaten mevcut, atlandı`)
      continue
    }

    const dir = path.join(WORKS_ROOT, folder)
    const files = listPdfs(dir)
    if (files.length === 0) {
      console.warn(`[?] ${folder}: PDF yok`)
      continue
    }

    const usable = files.filter((f) => {
      if (f.size > MAX_BYTES) {
        skipped.push(`${folder}/${path.basename(f.path)} (${(f.size / 1024 / 1024).toFixed(1)}MB)`)
        return false
      }
      return true
    })

    if (usable.length === 0) {
      console.log(`[~] ${folder}: tüm dosyalar >50MB, atlandı`)
      continue
    }

    try {
      console.log(`\n[+] ${folder} — ${meta.title} (${usable.length} dosya)`)

      // Standalone book: single PDF without cilt suffix.
      if (usable.length === 1 && usable[0].volumeNumber === null) {
        console.log(`    tek kitap olarak yükleniyor…`)
        await uploadSingle(usable[0])
        done.push(folder)
        continue
      }

      // Multi-volume path (also covers 1-cilt-with-suffix).
      console.log(`    parent oluşturuluyor…`)
      const parentId = await createParent(meta)

      for (let i = 0; i < usable.length; i++) {
        const f = usable[i]
        const cilt = f.volumeNumber ?? i + 1
        const sizeMb = (f.size / 1024 / 1024).toFixed(1)
        console.log(`    cilt ${cilt} (${sizeMb}MB) → ${path.basename(f.path)}`)
        await uploadVolume(parentId, f, i + 1)
        if (i < usable.length - 1) {
          await new Promise((r) => setTimeout(r, DELAY_MS))
        }
      }
      done.push(folder)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`    ✗ ${folder}: ${msg}`)
      failed.push(`${folder}: ${msg}`)
    }
  }

  console.log('\n=== Özet ===')
  console.log(`✓ Tamamlanan eser: ${done.length}`)
  console.log(`= Zaten mevcut: ${already.length}`)
  console.log(`✗ Başarısız: ${failed.length}`)
  console.log(`⊘ >50MB skip: ${skipped.length}`)
  if (skipped.length) {
    console.log('\nManuel yüklenecek (>50MB — sıkıştırıp tekrar dene):')
    for (const s of skipped) console.log(`  - ${s}`)
  }
  if (failed.length) {
    console.log('\nHatalar:')
    for (const f of failed) console.log(`  - ${f}`)
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
