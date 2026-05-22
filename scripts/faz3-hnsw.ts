// Build HNSW cosine indexes on the 1024-dim embedding columns after the
// BGE-M3 backfill. Run: node --env-file=.env.faz2 --import tsx scripts/faz3-hnsw.ts
import postgres from 'postgres'

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, {
    ssl: 'require', max: 1, idle_timeout: 0, max_lifetime: 0,
  })
  console.log('HNSW cosine index kuruluyor (LibraryChunk ~157k × 1024-dim, birkaç dakika)...')
  let t = Date.now()
  await sql`CREATE INDEX IF NOT EXISTS "LibraryChunk_embedding_hnsw_idx"
    ON "LibraryChunk" USING hnsw (embedding vector_cosine_ops)`
  console.log(`✓ LibraryChunk: ${((Date.now() - t) / 1000).toFixed(0)}s`)
  t = Date.now()
  await sql`CREATE INDEX IF NOT EXISTS "LibraryNote_embedding_hnsw_idx"
    ON "LibraryNote" USING hnsw (embedding vector_cosine_ops)`
  await sql`CREATE INDEX IF NOT EXISTS "SourceChunk_embedding_hnsw_idx"
    ON "SourceChunk" USING hnsw (embedding vector_cosine_ops)`
  console.log(`✓ LibraryNote + SourceChunk: ${((Date.now() - t) / 1000).toFixed(0)}s`)
  const idx = await sql<{ indexname: string; sz: string }[]>`
    SELECT indexname, pg_size_pretty(pg_relation_size(c.oid)) AS sz
    FROM pg_indexes pi JOIN pg_class c ON c.relname = pi.indexname
    WHERE indexname LIKE '%embedding_hnsw%' ORDER BY indexname`
  console.log('index boyutları:')
  for (const x of idx) console.log(`  ${x.indexname}: ${x.sz}`)
  await sql.end()
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
