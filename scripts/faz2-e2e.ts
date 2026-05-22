// Faz 2 end-to-end: create a throwaway entry pointing at a small existing
// R2 PDF, run the worker's runIngestJob directly (R2 download → extract →
// chunk → embed → ready), verify, then clean up. Validates the whole
// pipeline + type-checks the module chain via tsx.
// Run: node --env-file=.env.faz2 --import tsx scripts/faz2-e2e.ts
import { prisma } from '@/lib/db'
import { runIngestJob } from '@/worker/run-ingest'

async function main() {
  // Pick a small migrated PDF to reuse as the test fixture (cheap to embed).
  const src = await prisma.$queryRaw<{ id: string; userId: string; filePath: string; fileType: string | null; title: string }[]>`
    SELECT e.id, e."userId", e."filePath", e."fileType", e.title
    FROM "LibraryEntry" e
    WHERE e."filePath" IS NOT NULL
    ORDER BY length(e.title) ASC LIMIT 1`
  if (!src.length) throw new Error('no source entry with filePath')
  const fix = src[0]
  console.log(`fixture: "${fix.title}" filePath=${fix.filePath}`)

  const test = await prisma.libraryEntry.create({
    data: {
      userId: fix.userId, entryType: 'kitap',
      title: `__FAZ2_TEST__ ${Date.now()}`,
      authorSurname: `(test ${Date.now()})`,
      importSource: 'faz2-test', pdfStatus: 'queued',
      fileType: fix.fileType ?? 'pdf', filePath: fix.filePath, keywords: [],
    },
    select: { id: true },
  })
  console.log(`test entry: ${test.id} → runIngestJob…`)

  try {
    const result = await runIngestJob({ kind: 'entry', entryId: test.id })
    console.log('runIngestJob:', JSON.stringify(result))

    const counts = await prisma.$queryRaw<{ total: bigint; emb: bigint }[]>`
      SELECT COUNT(*) total, COUNT(*) FILTER (WHERE embedding IS NOT NULL) emb
      FROM "LibraryChunk" WHERE "libraryEntryId" = ${test.id}`
    const st = await prisma.libraryEntry.findUnique({ where: { id: test.id }, select: { pdfStatus: true } })
    console.log(`RESULT → status=${st?.pdfStatus} chunks=${counts[0].total} embedded=${counts[0].emb}`)
  } finally {
    // cleanup
    await prisma.$executeRaw`DELETE FROM "LibraryChunk" WHERE "libraryEntryId" = ${test.id}`
    await prisma.libraryEntry.delete({ where: { id: test.id } })
    console.log('cleanup: test entry + chunks silindi')
  }
  await prisma.$disconnect()
  process.exit(0)
}
main().catch((e) => { console.error('E2E FAIL:', e); process.exit(1) })
