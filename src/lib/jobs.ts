import { prisma } from '@/lib/db'

export type JobType =
  | 'roadmap'
  | 'subsection'
  | 'batch_writing'
  | 'literature_search'
  | 'zotero_sync'
  | 'pdf_pipeline'

export type JobStatus = 'running' | 'done' | 'failed'

export interface StartJobInput {
  userId: string
  type: JobType
  title: string
  projectId?: string
  subsectionId?: string
  resultUrl?: string
  message?: string
}

export async function startJob(input: StartJobInput): Promise<string> {
  const job = await prisma.backgroundJob.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      projectId: input.projectId ?? null,
      subsectionId: input.subsectionId ?? null,
      resultUrl: input.resultUrl ?? null,
      message: input.message ?? null,
      status: 'running',
    },
    select: { id: true },
  })
  return job.id
}

export async function updateJob(
  jobId: string,
  patch: { progress?: number; message?: string }
): Promise<void> {
  await prisma.backgroundJob.update({
    where: { id: jobId },
    data: {
      ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
      ...(patch.message !== undefined ? { message: patch.message } : {}),
    },
  })
}

export async function completeJob(
  jobId: string,
  patch?: { resultUrl?: string; message?: string }
): Promise<void> {
  await prisma.backgroundJob.update({
    where: { id: jobId },
    data: {
      status: 'done',
      progress: 100,
      finishedAt: new Date(),
      ...(patch?.resultUrl ? { resultUrl: patch.resultUrl } : {}),
      ...(patch?.message ? { message: patch.message } : {}),
    },
  })
}

export async function failJob(jobId: string, error: string): Promise<void> {
  await prisma.backgroundJob.update({
    where: { id: jobId },
    data: {
      status: 'failed',
      error: error.slice(0, 2000),
      finishedAt: new Date(),
    },
  })
}

/**
 * Wrap a promise in start/complete/fail bookkeeping. Failures re-throw so
 * callers can still react if they want to.
 */
export async function runAsJob<T>(
  input: StartJobInput,
  work: (jobId: string) => Promise<T>
): Promise<T> {
  const jobId = await startJob(input)
  try {
    const result = await work(jobId)
    await completeJob(jobId)
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await failJob(jobId, message)
    throw err
  }
}
