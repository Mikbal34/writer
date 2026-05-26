/**
 * Multiple-run eval aggregator: N koşum sonucunu okur, soru başına recall
 * ortalamasını alır, LLM rerank stochasticity'sini filtreler.
 *
 * Kullanım:
 *   npx tsx scripts/eval/aggregate-eval.ts \
 *     scripts/eval/results/*__hyde-evalmode-run1.json \
 *     scripts/eval/results/*__hyde-evalmode-run2.json \
 *     scripts/eval/results/*__hyde-evalmode-run3.json
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

interface RunResult {
  id: string
  category: string
  question: string
  expectedIds: string[]
  recallAt8: number
  mrr: number
  hits: number
  expectedCount: number
  latencyMs: number
  errorMsg?: string
}

interface RunFile {
  label: string
  results: RunResult[]
}

const files = process.argv.slice(2)
if (files.length < 2) {
  console.error('Kullanım: aggregate-eval.ts <run1.json> <run2.json> [run3.json ...]')
  process.exit(1)
}

const runs: RunFile[] = files.map((f) => JSON.parse(readFileSync(f, 'utf-8')))
const labels = runs.map((r) => r.label)
console.log(`▶ ${runs.length} koşum birleştiriliyor: ${labels.join(', ')}`)
console.log()

// Soru başına ortalama
const questionIds = runs[0].results.map((r) => r.id)
const agg: Array<{
  id: string
  category: string
  question: string
  expectedCount: number
  recalls: number[]
  mrrs: number[]
  avgRecall: number
  avgMrr: number
  stdRecall: number
}> = []

for (const qid of questionIds) {
  const rows = runs
    .map((r) => r.results.find((x) => x.id === qid))
    .filter((x): x is RunResult => Boolean(x))
  if (rows.length === 0) continue
  const recalls = rows.map((r) => r.recallAt8)
  const mrrs = rows.map((r) => r.mrr)
  const avgRecall = recalls.reduce((a, b) => a + b, 0) / recalls.length
  const avgMrr = mrrs.reduce((a, b) => a + b, 0) / mrrs.length
  const variance =
    recalls.reduce((a, b) => a + (b - avgRecall) ** 2, 0) / recalls.length
  const stdRecall = Math.sqrt(variance)
  agg.push({
    id: qid,
    category: rows[0].category,
    question: rows[0].question,
    expectedCount: rows[0].expectedCount,
    recalls,
    mrrs,
    avgRecall,
    avgMrr,
    stdRecall,
  })
}

// Toplam
const okAgg = agg.filter((a) => a.avgRecall > 0 || a.avgMrr > 0 || true)
const avgRecall = okAgg.reduce((a, b) => a + b.avgRecall, 0) / okAgg.length
const avgMrr = okAgg.reduce((a, b) => a + b.avgMrr, 0) / okAgg.length
const avgStd = okAgg.reduce((a, b) => a + b.stdRecall, 0) / okAgg.length

const byCategory = (cat: string) => {
  const subset = okAgg.filter((a) => a.category === cat)
  if (!subset.length) return { recall: 0, std: 0, count: 0 }
  return {
    recall: subset.reduce((a, b) => a + b.avgRecall, 0) / subset.length,
    std: subset.reduce((a, b) => a + b.stdRecall, 0) / subset.length,
    count: subset.length,
  }
}

console.log('── Toplam Özet (3-run ortalama) ─────────────────')
console.log(`  avg recall@8:    ${avgRecall.toFixed(3)} (±${avgStd.toFixed(3)})`)
console.log(`  avg MRR:         ${avgMrr.toFixed(3)}`)
const sCat = byCategory('S')
const tCat = byCategory('T')
const kCat = byCategory('K')
console.log(`  Spesifik (S):    ${sCat.recall.toFixed(3)} (±${sCat.std.toFixed(3)}, n=${sCat.count})`)
console.log(`  Tematik (T):     ${tCat.recall.toFixed(3)} (±${tCat.std.toFixed(3)}, n=${tCat.count})`)
console.log(`  Karşılaşt (K):   ${kCat.recall.toFixed(3)} (±${kCat.std.toFixed(3)}, n=${kCat.count})`)
console.log()

// Per-soru tablo
console.log('── Per-soru (3 koşumun ortalaması + std) ────────────')
console.log('  ID   Cat  ExpC  Recalls           Avg±Std       MRR')
for (const a of agg) {
  const recs = a.recalls.map((r) => r.toFixed(2)).join(',')
  console.log(
    `  ${a.id} ${a.category}    ${String(a.expectedCount).padStart(2)}    [${recs}]    ${a.avgRecall.toFixed(2)}±${a.stdRecall.toFixed(2)}   ${a.avgMrr.toFixed(2)}`,
  )
}

// JSON çıktı
const outDir = resolve(process.cwd(), 'scripts/eval/results')
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const outPath = resolve(outDir, `aggregated-${stamp}.json`)
writeFileSync(
  outPath,
  JSON.stringify(
    {
      runs: labels,
      runCount: runs.length,
      avgRecall,
      avgMrr,
      avgStd,
      byCategory: { S: sCat, T: tCat, K: kCat },
      perQuestion: agg,
    },
    null,
    2,
  ),
)
console.log()
console.log(`  Aggregated: ${outPath}`)
