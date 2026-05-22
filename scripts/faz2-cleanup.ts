// Verify Faz 2 test entries' final state, then delete them.
// Run: node --env-file=.env.faz2 --import tsx scripts/faz2-cleanup.ts
import { prisma } from '@/lib/db'

async function main() {
  const rows = await prisma.$queryRaw<{ st: string; n: bigint; chunks: bigint; emb: bigint }[]>`
    SELECT e."pdfStatus" st, COUNT(DISTINCT e.id) n,
      COUNT(c.id) chunks,
      COUNT(c.id) FILTER (WHERE c.embedding IS NOT NULL) emb
    FROM "LibraryEntry" e
    LEFT JOIN "LibraryChunk" c ON c."libraryEntryId" = e.id
    WHERE e."importSource" = 'faz2-test'
    GROUP BY e."pdfStatus"`
  console.log('Faz2 test entries by status:')
  for (const r of rows) console.log(`  ${r.st}: ${r.n} entry, ${r.chunks} chunk (${r.emb} embedded)`)

  const ids = await prisma.libraryEntry.findMany({
    where: { importSource: 'faz2-test' }, select: { id: true },
  })
  for (const { id } of ids) {
    await prisma.$executeRaw`DELETE FROM "LibraryChunk" WHERE "libraryEntryId" = ${id}`
    await prisma.libraryEntry.delete({ where: { id } })
  }
  console.log(`cleanup: ${ids.length} test entry + chunks silindi`)
  await prisma.$disconnect()
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
