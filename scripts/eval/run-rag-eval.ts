/**
 * RAG eval runner: 30 referans soruyu prod chat API'sinden geçirir,
 * her cevabın `sources` listesini topla, recall@K + MRR hesapla.
 *
 * Kullanım:
 *   npx tsx scripts/eval/run-rag-eval.ts \
 *     --base https://quilpen.com \
 *     --label baseline-haiku \
 *     [--limit 5]
 *
 * Gerekli env:
 *   EVAL_TOKEN — chat API'sinin X-Eval-Token ile beklediği değer
 *   DATABASE_URL — expected entry hint'lerini ID'lere çevirmek için
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { PrismaClient } from '@prisma/client'

interface ExpectedHint {
  authorSurname: string
  titleHint: string
}

interface Question {
  id: string
  category: 'S' | 'T' | 'K'
  question: string
  expectedEntries: ExpectedHint[]
}

interface EvalSet {
  name: string
  userId: string
  userEmail: string
  questions: Question[]
}

interface ChatSource {
  marker: number
  kind: 'chunk' | 'note'
  entryId: string
  title: string
  authorSurname: string | null
  page: number | null
  pageLabel: string | null
  text: string
}

interface QResult {
  id: string
  category: string
  question: string
  expectedIds: string[]
  expectedHints: ExpectedHint[]
  retrievedEntryIds: string[]
  /** Distinct entry IDs in source list order (de-duped, ordering preserved). */
  retrievedEntryIdsDistinct: string[]
  recallAt8: number
  recallAtAll: number
  mrr: number
  hits: number
  expectedCount: number
  latencyMs: number
  errorMsg?: string
}

const args = parseArgs(process.argv.slice(2))
const BASE = args.base ?? 'https://quilpen.com'
const LABEL = args.label ?? 'unlabeled'
const LIMIT = args.limit ? parseInt(args.limit, 10) : undefined
const EVAL_TOKEN = process.env.EVAL_TOKEN
if (!EVAL_TOKEN) {
  console.error('EVAL_TOKEN env yok')
  process.exit(1)
}

const SET_PATH = resolve(process.cwd(), 'scripts/eval/library-rag-set.json')
const OUT_DIR = resolve(process.cwd(), 'scripts/eval/results')

const prisma = new PrismaClient()

async function main() {
  const set: EvalSet = JSON.parse(readFileSync(SET_PATH, 'utf-8'))
  const questions = LIMIT ? set.questions.slice(0, LIMIT) : set.questions
  console.log(`▶ ${set.name} (${questions.length} soru) → ${BASE}, label=${LABEL}`)

  const results: QResult[] = []
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    process.stdout.write(`[${i + 1}/${questions.length}] ${q.id} ${q.category}  `)
    const r = await runOne(set.userId, q)
    results.push(r)
    if (r.errorMsg) {
      console.log(`✗ ${r.errorMsg}`)
    } else {
      console.log(
        `recall@8=${r.recallAt8.toFixed(2)} mrr=${r.mrr.toFixed(2)} hits=${r.hits}/${r.expectedCount} (${r.latencyMs}ms)`,
      )
    }
  }

  // Aggregate
  const ok = results.filter((r) => !r.errorMsg)
  const avgRecall = ok.length ? ok.reduce((a, r) => a + r.recallAt8, 0) / ok.length : 0
  const avgRecallAll = ok.length ? ok.reduce((a, r) => a + r.recallAtAll, 0) / ok.length : 0
  const avgMrr = ok.length ? ok.reduce((a, r) => a + r.mrr, 0) / ok.length : 0
  const avgLatency = ok.length ? Math.round(ok.reduce((a, r) => a + r.latencyMs, 0) / ok.length) : 0
  const byCategory = (cat: string) => {
    const subset = ok.filter((r) => r.category === cat)
    if (!subset.length) return { recall: 0, count: 0 }
    return {
      recall: subset.reduce((a, r) => a + r.recallAt8, 0) / subset.length,
      count: subset.length,
    }
  }

  console.log('\n── Özet ─────────────────────────────────────────')
  console.log(`  label:           ${LABEL}`)
  console.log(`  toplam:          ${results.length}, OK: ${ok.length}, hata: ${results.length - ok.length}`)
  console.log(`  avg recall@8:    ${avgRecall.toFixed(3)}`)
  console.log(`  avg recall (∞):  ${avgRecallAll.toFixed(3)}`)
  console.log(`  avg MRR:         ${avgMrr.toFixed(3)}`)
  console.log(`  avg latency:     ${avgLatency} ms`)
  console.log(`  spesifik (S):    recall@8=${byCategory('S').recall.toFixed(3)} (${byCategory('S').count})`)
  console.log(`  tematik (T):     recall@8=${byCategory('T').recall.toFixed(3)} (${byCategory('T').count})`)
  console.log(`  karşılaşt (K):   recall@8=${byCategory('K').recall.toFixed(3)} (${byCategory('K').count})`)

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outPath = resolve(OUT_DIR, `${stamp}__${LABEL}.json`)
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        label: LABEL,
        runAt: new Date().toISOString(),
        base: BASE,
        total: results.length,
        ok: ok.length,
        avgRecall,
        avgRecallAll,
        avgMrr,
        avgLatency,
        byCategory: { S: byCategory('S'), T: byCategory('T'), K: byCategory('K') },
        results,
      },
      null,
      2,
    ),
  )
  console.log(`\n  sonuç: ${outPath}`)

  await prisma.$disconnect()
}

async function runOne(userId: string, q: Question): Promise<QResult> {
  // 1) Expected hint'leri DB'de ID'ye çevir
  const expectedIds = await resolveExpectedIds(userId, q.expectedEntries)
  if (expectedIds.length === 0) {
    return {
      id: q.id,
      category: q.category,
      question: q.question,
      expectedHints: q.expectedEntries,
      expectedIds: [],
      retrievedEntryIds: [],
      retrievedEntryIdsDistinct: [],
      recallAt8: 0,
      recallAtAll: 0,
      mrr: 0,
      hits: 0,
      expectedCount: q.expectedEntries.length,
      latencyMs: 0,
      errorMsg: 'expected ID çözümlenemedi',
    }
  }

  // 2) Chat API'sine POST
  const sessionId = `eval-${LABEL}-${q.id}-${Date.now()}`
  const t0 = Date.now()
  let sources: ChatSource[] = []
  let errorMsg: string | undefined
  try {
    const res = await fetch(`${BASE}/api/library/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Eval-Token': EVAL_TOKEN as string,
        'X-Eval-User-Id': userId,
      },
      body: JSON.stringify({
        sessionId,
        message: q.question,
        scope: 'all',
      }),
    })
    if (!res.ok) {
      errorMsg = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`
    } else if (!res.body) {
      errorMsg = 'no body'
    } else {
      sources = await readSourcesFromSSE(res.body)
    }
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err)
  }
  const latencyMs = Date.now() - t0

  // 3) Retrieved entry IDs (distinct, sıralı)
  const retrievedEntryIds = sources.map((s) => s.entryId)
  const distinct: string[] = []
  for (const eid of retrievedEntryIds) if (!distinct.includes(eid)) distinct.push(eid)

  // 4) Metrikler
  const expectedSet = new Set(expectedIds)
  const hitsAt8 = retrievedEntryIds.slice(0, 8).filter((id, i, arr) => arr.indexOf(id) === i && expectedSet.has(id)).length
  const hitsAll = distinct.filter((id) => expectedSet.has(id)).length
  const recallAt8 = expectedIds.length ? hitsAt8 / expectedIds.length : 0
  const recallAtAll = expectedIds.length ? hitsAll / expectedIds.length : 0
  // MRR: ilk beklenen entry ilk kaç. sırada (distinct sırasında)
  let mrr = 0
  for (let i = 0; i < distinct.length; i++) {
    if (expectedSet.has(distinct[i])) {
      mrr = 1 / (i + 1)
      break
    }
  }

  return {
    id: q.id,
    category: q.category,
    question: q.question,
    expectedHints: q.expectedEntries,
    expectedIds,
    retrievedEntryIds,
    retrievedEntryIdsDistinct: distinct,
    recallAt8,
    recallAtAll,
    mrr,
    hits: hitsAll,
    expectedCount: expectedIds.length,
    latencyMs,
    errorMsg,
  }
}

async function resolveExpectedIds(
  userId: string,
  hints: ExpectedHint[],
): Promise<string[]> {
  const ids: string[] = []
  for (const h of hints) {
    const found = await prisma.libraryEntry.findMany({
      where: {
        userId,
        authorSurname: { contains: h.authorSurname, mode: 'insensitive' },
        title: { contains: h.titleHint, mode: 'insensitive' },
      },
      select: { id: true },
      take: 5,
    })
    for (const row of found) if (!ids.includes(row.id)) ids.push(row.id)
  }
  return ids
}

async function readSourcesFromSSE(body: ReadableStream<Uint8Array>): Promise<ChatSource[]> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let sources: ChatSource[] = []
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl
    while ((nl = buffer.indexOf('\n\n')) !== -1) {
      const evt = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 2)
      if (!evt.startsWith('data:')) continue
      const payload = evt.slice(5).trim()
      if (payload === '[DONE]') break
      try {
        const obj = JSON.parse(payload)
        if (obj.done && Array.isArray(obj.sources)) {
          sources = obj.sources as ChatSource[]
        }
      } catch {
        // delta chunks
      }
    }
  }
  return sources
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2)
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true'
      out[key] = val
      if (val !== 'true') i++
    }
  }
  return out
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
