// Faz 2 smoke test: verify queue (Upstash) + R2 storage modules connect.
// Run: node --env-file=.env.faz2 --import tsx scripts/faz2-smoke.ts
import { ingestQueue, enqueueIngest, makeRedis } from '@/lib/queue'
import { pdfExistsR2, getBytesFromFilePath } from '@/lib/r2-storage'
import { prisma } from '@/lib/db'

async function main() {
  // --- R2: pick a real migrated filePath from Neon, verify it exists ---
  const entry = await prisma.libraryEntry.findFirst({
    where: { filePath: { not: null } },
    select: { id: true, filePath: true, title: true },
  })
  if (!entry?.filePath) throw new Error('no entry with filePath in Neon')
  const exists = await pdfExistsR2(entry.filePath)
  const bytes = exists ? await getBytesFromFilePath(entry.filePath) : Buffer.alloc(0)
  console.log(`R2: "${entry.title?.slice(0, 30)}" exists=${exists} bytes=${bytes.length}`)

  // --- Queue: enqueue a smoke job, read counts, then remove it ---
  const job = await enqueueIngest({ kind: 'entry', entryId: '__smoke__' })
  const counts = await ingestQueue().getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed')
  console.log('Queue counts:', JSON.stringify(counts))
  await job.remove()
  console.log('Queue: smoke job enqueued + removed OK')

  await ingestQueue().close()
  await prisma.$disconnect()
  // BullMQ keeps a redis handle; force-exit so the script doesn't hang.
  setTimeout(() => process.exit(0), 200)
}
main().catch((e) => { console.error('SMOKE FAIL:', e); process.exit(1) })
