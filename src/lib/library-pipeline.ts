/**
 * Library-level PDF pipeline.
 *
 * Railway services don't share a filesystem, so this module never relies on
 * Next.js and the Python service seeing the same file. Two content-delivery
 * modes are used instead:
 *
 *   - URL source (literature-search open-access links):
 *       Next.js calls Python /process-url; Python downloads + chunks; Next.js
 *       stores chunks + embeds them.
 *   - Bytes source (manual attach-pdf upload):
 *       Next.js forwards the multipart file to Python /process-bytes.
 *
 * pdfStatus progression: pending → extracting → embedding → ready (or failed)
 *
 * All jobs are fire-and-forget; callers should not await them unless they
 * want synchronous behaviour (e.g. in tests).
 */

import { prisma } from '@/lib/db'

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? 'http://localhost:8000'
const EMBED_BATCH_SIZE = 100

interface ProcessResponse {
  sourceId: string
  totalPages: number
  extractedText: string
  chunks: Array<{ pageNumber: number; chunkIndex: number; content: string }>
  ocrPending: boolean
}

async function setStatus(
  entryId: string,
  pdfStatus: string,
  patch: { pdfError?: string | null } = {}
): Promise<void> {
  await prisma.libraryEntry.update({
    where: { id: entryId },
    data: { pdfStatus, ...patch },
  })
}

async function embedBatch(texts: string[]): Promise<number[][] | null> {
  try {
    const res = await fetch(`${PYTHON_SERVICE_URL}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts }),
    })
    if (!res.ok) {
      console.error(`[library-pipeline] Python /embed returned ${res.status}`)
      return null
    }
    const data = (await res.json()) as { embeddings: number[][] }
    return data.embeddings
  } catch (err) {
    console.error('[library-pipeline] Python /embed failed:', err)
    return null
  }
}

async function persistChunks(entryId: string, chunks: ProcessResponse['chunks']): Promise<void> {
  await prisma.libraryChunk.deleteMany({ where: { libraryEntryId: entryId } })
  if (chunks.length === 0) return

  const created = await prisma.$transaction(
    chunks.map((c) =>
      prisma.libraryChunk.create({
        data: {
          libraryEntryId: entryId,
          pageNumber: c.pageNumber,
          chunkIndex: c.chunkIndex,
          content: c.content,
        },
      })
    )
  )

  await setStatus(entryId, 'embedding')

  for (let i = 0; i < created.length; i += EMBED_BATCH_SIZE) {
    const batch = created.slice(i, i + EMBED_BATCH_SIZE)
    const vectors = await embedBatch(batch.map((c) => c.content))
    if (!vectors || vectors.length !== batch.length) continue
    for (let j = 0; j < batch.length; j++) {
      await prisma.$executeRawUnsafe(
        `UPDATE "LibraryChunk" SET embedding = $1::vector WHERE id = $2`,
        JSON.stringify(vectors[j]),
        batch[j].id
      )
    }
  }
}

/**
 * Process a literature-search open-access URL: Python downloads + chunks,
 * we embed and persist.
 */
export async function processLibraryPdfFromUrl(entryId: string, pdfUrl: string): Promise<void> {
  try {
    await setStatus(entryId, 'extracting', { pdfError: null })

    const res = await fetch(`${PYTHON_SERVICE_URL}/process-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: entryId, url: pdfUrl }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const msg = `Python /process-url HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`
      console.error('[library-pipeline]', msg)
      await setStatus(entryId, 'failed', { pdfError: msg })
      return
    }

    const data = (await res.json()) as ProcessResponse

    if (!data.chunks || data.chunks.length === 0) {
      await setStatus(entryId, 'failed', { pdfError: 'No text extracted' })
      return
    }

    // Record openAccessUrl as the PDF source. We no longer store the file
    // on writer-agent-app disk.
    await prisma.libraryEntry.update({
      where: { id: entryId },
      data: { openAccessUrl: pdfUrl, fileType: 'pdf' },
    })

    await persistChunks(entryId, data.chunks)
    await setStatus(entryId, 'ready')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[library-pipeline] processFromUrl failed for ${entryId}:`, err)
    await setStatus(entryId, 'failed', { pdfError: message })
  }
}

/**
 * Process a raw PDF byte buffer: forward to Python /process-bytes, embed,
 * persist. Used by the manual attach-pdf flow.
 */
export async function processLibraryPdfFromBytes(
  entryId: string,
  filename: string,
  bytes: Buffer
): Promise<void> {
  try {
    await setStatus(entryId, 'extracting', { pdfError: null })

    const form = new FormData()
    form.append('sourceId', entryId)
    form.append(
      'file',
      new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }),
      filename
    )

    const res = await fetch(`${PYTHON_SERVICE_URL}/process-bytes`, {
      method: 'POST',
      body: form,
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const msg = `Python /process-bytes HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`
      console.error('[library-pipeline]', msg)
      await setStatus(entryId, 'failed', { pdfError: msg })
      return
    }

    const data = (await res.json()) as ProcessResponse

    if (!data.chunks || data.chunks.length === 0) {
      await setStatus(entryId, 'failed', { pdfError: 'No text extracted' })
      return
    }

    await prisma.libraryEntry.update({
      where: { id: entryId },
      data: { fileType: 'pdf' },
    })

    await persistChunks(entryId, data.chunks)
    await setStatus(entryId, 'ready')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[library-pipeline] processFromBytes failed for ${entryId}:`, err)
    await setStatus(entryId, 'failed', { pdfError: message })
  }
}

/**
 * Background kickoff for a batch of URL-based jobs (bulk-add-from-search).
 */
export function startLibraryPdfBatch(jobs: Array<{ entryId: string; pdfUrl: string }>): void {
  for (const job of jobs) {
    setImmediate(() => {
      processLibraryPdfFromUrl(job.entryId, job.pdfUrl).catch((err) => {
        console.error('[library-pipeline] URL job failed:', job.entryId, err)
      })
    })
  }
}
