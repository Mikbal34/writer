// One-shot: re-embed every LibraryChunk via Voyage AI.
// Uses Prisma (already in worker container) so it runs without extra
// npm installs. Idempotent + resumable via embeddingModel marker col.
//
// Run on Azure VM:
//   docker compose -f docker-compose.prod.yml cp \
//     scripts/deploy/reembed-voyage.mjs worker:/tmp/reembed.mjs
//   docker compose -f docker-compose.prod.yml exec worker \
//     node /tmp/reembed.mjs

import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY
const VOYAGE_MODEL = process.env.VOYAGE_MODEL || 'voyage-multilingual-2'

if (!VOYAGE_API_KEY) {
  console.error('VOYAGE_API_KEY missing')
  process.exit(1)
}

// Match src/lib/db.ts construction — Prisma 7 needs an adapter
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })
const BATCH_SIZE = 100
const CONCURRENCY = 4
const FORCE = process.argv.includes('--force')

// Resume marker columns (no-op on subsequent runs)
await prisma.$executeRawUnsafe(`
  ALTER TABLE "LibraryChunk"
  ADD COLUMN IF NOT EXISTS "embeddingModel" TEXT,
  ADD COLUMN IF NOT EXISTS "embeddedAt" TIMESTAMPTZ
`)

async function fetchBatch(after) {
  // Skip already-migrated rows on resume (unless --force)
  if (FORCE) {
    return prisma.$queryRawUnsafe(
      `SELECT id, content FROM "LibraryChunk"
       WHERE id > $1 ORDER BY id LIMIT $2`,
      after,
      BATCH_SIZE,
    )
  }
  return prisma.$queryRawUnsafe(
    `SELECT id, content FROM "LibraryChunk"
     WHERE id > $1
       AND ("embeddingModel" IS NULL OR "embeddingModel" != $2)
     ORDER BY id LIMIT $3`,
    after,
    VOYAGE_MODEL,
    BATCH_SIZE,
  )
}

async function embedViaVoyage(texts) {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
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
  // Per-row UPDATE — Prisma doesn't have a nice VALUES bulk helper for
  // vector types, but 100 sequential UPDATEs on a local DB take <500ms
  // total so we don't bother batching. The Voyage call itself dominates.
  await prisma.$transaction(
    rows.map((r, i) =>
      prisma.$executeRawUnsafe(
        `UPDATE "LibraryChunk" SET
           embedding = $1::vector(1024),
           "embeddingModel" = $2,
           "embeddedAt" = NOW()
         WHERE id = $3`,
        `[${embeddings[i].join(',')}]`,
        VOYAGE_MODEL,
        r.id,
      ),
    ),
  )
  return tokens
}

async function main() {
  const totalRow = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int as n FROM "LibraryChunk"`,
  )
  const total = Number(totalRow[0].n)
  const doneRow = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int as n FROM "LibraryChunk" WHERE "embeddingModel" = $1`,
    VOYAGE_MODEL,
  )
  const alreadyDone = Number(doneRow[0].n)
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
  await prisma.$disconnect()
}

await main()
