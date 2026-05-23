// Clean end-to-end deploy smoke test: enqueue 1 test entry, poll DB
// until terminal status, then verify + cleanup. No inline shell-eval
// quoting traps; no cleanup-before-done race that creates "entry not
// found" retry storms.
// Run: node --env-file=.env.faz2 --import tsx scripts/faz4-e2e.ts
import { prisma } from '@/lib/db'
import { enqueueIngest } from '@/lib/queue'

async function main() {
  const src = await prisma.$queryRaw<{ userId: string; filePath: string; fileType: string | null }[]>`
    SELECT e."userId", e."filePath", e."fileType" FROM "LibraryEntry" e
    WHERE e."filePath" IS NOT NULL ORDER BY length(e.title) ASC LIMIT 1`
  const fix = src[0]

  const ent = await prisma.libraryEntry.create({
    data: {
      userId: fix.userId, entryType: 'kitap',
      title: `__FAZ4_E2E__ ${Date.now()}`,
      authorSurname: `(faz4 ${Date.now()})`,
      importSource: 'faz4-e2e', pdfStatus: 'queued',
      fileType: fix.fileType ?? 'pdf', filePath: fix.filePath, keywords: [],
    },
    select: { id: true },
  })
  await enqueueIngest({ kind: 'entry', entryId: ent.id })
  console.log(`enqueued ${ent.id}`)

  const t0 = Date.now()
  const maxMs = 360_000 // 6 min
  let st: { pdfStatus: string; pdfError: string | null } | null = null
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 5000))
    st = await prisma.libraryEntry.findUnique({
      where: { id: ent.id },
      select: { pdfStatus: true, pdfError: true },
    })
    const sec = Math.round((Date.now() - t0) / 1000)
    console.log(`  ${sec}s: ${st?.pdfStatus}`)
    if (st?.pdfStatus === 'ready' || st?.pdfStatus === 'failed') break
  }

  const counts = await prisma.$queryRaw<{ total: bigint; emb: bigint }[]>`
    SELECT COUNT(*) total, COUNT(*) FILTER (WHERE embedding IS NOT NULL) emb
    FROM "LibraryChunk" WHERE "libraryEntryId" = ${ent.id}`
  console.log(`final: status=${st?.pdfStatus} chunks=${counts[0].total} embedded=${counts[0].emb}`)
  if (st?.pdfStatus === 'failed') console.log(`error: ${st.pdfError}`)

  await prisma.$executeRaw`DELETE FROM "LibraryChunk" WHERE "libraryEntryId" = ${ent.id}`
  await prisma.libraryEntry.delete({ where: { id: ent.id } })
  console.log('cleanup done')
  await prisma.$disconnect()
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
