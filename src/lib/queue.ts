/**
 * BullMQ ingest queue over Upstash Redis (TLS). The web process only
 * ENQUEUES; the worker process (src/worker/index.ts) consumes. This is
 * the decoupling that fixes the saturation cascade — uploads return in
 * ms and heavy extract/OCR/embed work flows through bounded workers.
 *
 * Env: REDIS_URL = rediss://default:<pw>@<host>:6379 (Upstash).
 */
import { Queue, type JobsOptions } from 'bullmq'
import IORedis from 'ioredis'

export const INGEST_QUEUE = 'library-ingest'

export type IngestJob =
  | { kind: 'entry'; entryId: string; filename?: string }
  | { kind: 'volume'; entryId: string; volumeId: string; filename?: string }

function redisUrl(): string {
  const url = process.env.REDIS_URL
  if (!url) throw new Error('REDIS_URL is not set (Upstash rediss:// URL required)')
  return url
}

/**
 * BullMQ requires maxRetriesPerRequest=null on the shared connection.
 * A single ioredis instance is reused for the Queue; the Worker creates
 * its own (BullMQ blocks on it, so it can't be shared).
 */
export function makeRedis(): IORedis {
  return new IORedis(redisUrl(), {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  })
}

let _queue: Queue<IngestJob> | null = null

export function ingestQueue(): Queue<IngestJob> {
  if (!_queue) {
    _queue = new Queue<IngestJob>(INGEST_QUEUE, {
      connection: makeRedis(),
      defaultJobOptions: {
        // 2 attempts (was 4) — every BullMQ retry of a heavy-scan
        // entry re-fires ALL Surya chunk requests to Modal. With 4
        // attempts × 29 chunks = 116 zombie Modal calls per cilt
        // when something flakes. 2 attempts keeps the safety net but
        // caps wasted GPU work.
        attempts: 2,
        // Longer initial delay so transient blips (Modal cold start,
        // Redis hiccup) clear before retry hits.
        backoff: { type: 'exponential', delay: 15000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    })
  }
  return _queue
}

/**
 * Enqueue an ingest job. jobId is derived from the target so a duplicate
 * enqueue (double-click, retry) dedupes instead of processing twice.
 *
 * `priority` semantics (BullMQ: smaller = higher priority):
 *   • interactive uploads (default)      → priority 1 (front of queue)
 *   • bulk imports / batch ops           → priority 10 via { batch: true }
 * This keeps a user's freshly-uploaded book from waiting behind a 500-
 * row admin Zotero sync.
 */
export async function enqueueIngest(
  job: IngestJob,
  opts: JobsOptions & { batch?: boolean } = {},
) {
  const jobId =
    job.kind === 'volume' ? `vol_${job.volumeId}` : `entry_${job.entryId}`
  const { batch, priority, ...rest } = opts
  return ingestQueue().add(job.kind, job, {
    jobId,
    priority: priority ?? (batch ? 10 : 1),
    ...rest,
  })
}
