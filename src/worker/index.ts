/**
 * Library ingest worker — separate process from the web app. Consumes the
 * BullMQ ingest queue with BOUNDED concurrency, so any burst of uploads
 * queues up and drains in order instead of saturating one process (the
 * van Ess failure mode). Scale by raising WORKER_CONCURRENCY or running
 * more worker machines — config, not a rewrite.
 *
 * Run: node --env-file=.env.faz2 --import tsx src/worker/index.ts
 */
import { Worker, type Job } from 'bullmq'
import { INGEST_QUEUE, makeRedis, type IngestJob } from '@/lib/queue'
import { runIngestJob } from './run-ingest'

const concurrency = Number(process.env.WORKER_CONCURRENCY || 2)

const worker = new Worker<IngestJob>(
  INGEST_QUEUE,
  async (job: Job<IngestJob>) => {
    const t0 = Date.now()
    console.log(`[worker] start ${job.name} ${job.id} (attempt ${job.attemptsMade + 1})`)
    const result = await runIngestJob(job.data)
    console.log(`[worker] done  ${job.id} in ${Date.now() - t0}ms`, JSON.stringify(result))
    return result
  },
  { connection: makeRedis(), concurrency },
)

worker.on('failed', (job, err) => {
  console.error(`[worker] FAILED ${job?.id} (attempt ${job?.attemptsMade}): ${err?.message}`)
})
worker.on('error', (err) => console.error('[worker] error:', err))

console.log(`[worker] up — queue="${INGEST_QUEUE}" concurrency=${concurrency}`)

async function shutdown(sig: string) {
  console.log(`[worker] ${sig} — closing…`)
  await worker.close()
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
