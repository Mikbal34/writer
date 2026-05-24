// One-shot script: re-embed every LibraryChunk via Voyage AI.
// Run on the Azure VM:
//   docker compose -f docker-compose.prod.yml exec worker \
//     node /app/scripts/deploy/reembed-voyage.mjs
//
// Idempotent + resumable: marker column `embeddingModel` skips already-
// migrated chunks on resume. Cost: ~$1.90 for 157k chunks at $0.05/M
// (voyage-multilingual-2).

import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY
const VOYAGE_MODEL = process.env.VOYAGE_MODEL || 'voyage-multilingual-2'

if (!DATABASE_URL || !VOYAGE_API_KEY) {
  console.error('DATABASE_URL or VOYAGE_API_KEY missing')
  process.exit(1)
}

const sql = postgres(DATABASE_URL, { max: 4 })
const BATCH_SIZE = 100
const CONCURRENCY = 4
const FORCE = process.argv.includes('--force')

// Add resume marker column (no-op on subsequent runs)
await sql`
  ALTER TABLE "LibraryChunk"
  ADD COLUMN IF NOT EXISTS "embeddingModel" TEXT,
  ADD COLUMN IF NOT EXISTS "embeddedAt" TIMESTAMPTZ
`

async function fetchBatch(after) {
  if (FORCE) {
    return sql`
      SELECT id, content FROM "LibraryChunk"
      WHERE id > ${after} ORDER BY id LIMIT ${BATCH_SIZE}
    `
  }
  return sql`
    SELECT id, content FROM "LibraryChunk"
    WHERE id > ${after}
      AND ("embeddingModel" IS NULL OR "embeddingModel" != ${VOYAGE_MODEL})
    ORDER BY id LIMIT ${BATCH_SIZE}
  `
}

async function embedViaVoyage(texts) {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${VOYAGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: texts,
      input_type: 'document',
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Voyage HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
  const data = await res.json()
  const sorted = [...data.data].sort((a, b) => a.index - b.index)
  return {
    embeddings: sorted.map((e) => e.embedding),
    tokens: data.usage?.total_tokens ?? 0,
  }
}

async function processBatch(rows) {
  const { embeddings, tokens } = await embedViaVoyage(rows.map((r) => r.content))
  // Bulk UPDATE via VALUES (avoids 100 round-trips)
  const values = rows.map((r, i) => [r.id, `[${embeddings[i].join(',')}]`])
  await sql`
    UPDATE "LibraryChunk" SET
      embedding = u.embedding::vector(1024),
      "embeddingModel" = ${VOYAGE_MODEL},
      "embeddedAt" = NOW()
    FROM (VALUES ${sql(values)}) AS u(id, embedding)
    WHERE "LibraryChunk".id = u.id
  `
  return tokens
}

async function main() {
  const totalRow = await sql`SELECT COUNT(*)::int n FROM "LibraryChunk"`
  const total = totalRow[0].n
  const doneRow = await sql`
    SELECT COUNT(*)::int n FROM "LibraryChunk"
    WHERE "embeddingModel" = ${VOYAGE_MODEL}
  `
  const alreadyDone = doneRow[0].n
  console.log(`Total chunks: ${total.toLocaleString()}`)
  console.log(`Already on ${VOYAGE_MODEL}: ${alreadyDone.toLocaleString()}`)
  console.log(`To re-embed: ${(total - alreadyDone).toLocaleString()}`)
  console.log(`Batch=${BATCH_SIZE} concurrency=${CONCURRENCY} force=${FORCE}`)
  console.log('')

  let after = ''
  let processed = alreadyDone
  let totalTokens = 0
  const t0 = Date.now()

  while (true) {
    const batches = []
    let lastSeen = after
    for (let i = 0; i < CONCURRENCY; i++) {
      const rows = await fetchBatch(lastSeen)
      if (rows.length === 0) break
      batches.push(rows)
      lastSeen = rows[rows.length - 1].id
    }
    if (batches.length === 0) break

    const tokens = await Promise.all(batches.map(processBatch))
    totalTokens += tokens.reduce((s, t) => s + t, 0)
    const justProcessed = batches.reduce((s, b) => s + b.length, 0)
    processed += justProcessed
    after = lastSeen

    const elapsed = (Date.now() - t0) / 1000
    const rate = (processed - alreadyDone) / elapsed
    const eta = (total - processed) / rate
    console.log(
      `${processed.toLocaleString()}/${total.toLocaleString()} ` +
        `(${((processed / total) * 100).toFixed(1)}%) ` +
        `${rate.toFixed(0)} ch/s ` +
        `ETA ${(eta / 60).toFixed(1)} min ` +
        `tokens ${(totalTokens / 1e6).toFixed(2)}M ` +
        `cost $${((totalTokens / 1e6) * 0.05).toFixed(3)}`,
    )
  }

  console.log('')
  console.log(`DONE — ${processed.toLocaleString()} chunks (model: ${VOYAGE_MODEL})`)
  console.log(`Total cost: $${((totalTokens / 1e6) * 0.05).toFixed(2)}`)
  console.log(`Time: ${((Date.now() - t0) / 60_000).toFixed(1)} min`)
  await sql.end()
}

await main()
