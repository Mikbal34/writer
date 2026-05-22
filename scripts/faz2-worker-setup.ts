// Create N throwaway entries (reusing a small R2 PDF) + enqueue them, to
// test the real BullMQ worker consuming with bounded concurrency.
// Run: node --env-file=.env.faz2 --import tsx scripts/faz2-worker-setup.ts 5
import { prisma } from '@/lib/db'
import { enqueueIngest } from '@/lib/queue'

async function main() {
  const n = Number(process.argv[2] || 5)
  const src = await prisma.$queryRaw<{ userId: string; filePath: string; fileType: string | null }[]>`
    SELECT e."userId", e."filePath", e."fileType" FROM "LibraryEntry" e
    WHERE e."filePath" IS NOT NULL ORDER BY length(e.title) ASC LIMIT 1`
  const fix = src[0]
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    const e = await prisma.libraryEntry.create({
      data: {
        userId: fix.userId, entryType: 'kitap',
        title: `__FAZ2_TEST__ ${Date.now()}_${i}`,
        authorSurname: `(test ${Date.now()}_${i})`,
        importSource: 'faz2-test', pdfStatus: 'queued',
        fileType: fix.fileType ?? 'pdf', filePath: fix.filePath, keywords: [],
      },
      select: { id: true },
    })
    await enqueueIngest({ kind: 'entry', entryId: e.id, filename: 'test.pdf' })
    ids.push(e.id)
  }
  console.log(`enqueued ${n}: ${ids.join(',')}`)
  await prisma.$disconnect()
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
