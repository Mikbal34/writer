/**
 * Library-level PDF pipeline.
 *
 * After a user adds a literature-search result to their library (or attaches
 * a PDF manually), this module:
 *   1. Downloads the PDF (if needed) into uploads/library/<userId>/
 *   2. Calls the Python service to extract + chunk the text
 *   3. Generates embeddings via the Python service
 *   4. Persists chunks + embeddings to LibraryChunk (pgvector)
 *   5. Transitions pdfStatus: pending → downloading → extracting → embedding → ready
 *
 * All jobs are fire-and-forget; callers should not await them unless they
 * want synchronous behaviour (e.g. in tests).
 */

import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '@/lib/db'

const UPLOADS_DIR = path.join(process.cwd(), 'uploads')
const LIBRARY_DIR = path.join(UPLOADS_DIR, 'library')

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? 'http://localhost:8001'

const EMBED_BATCH_SIZE = 100

async function setStatus(
  entryId: string,
  pdfStatus: string,
  patch: { filePath?: string; fileType?: string; pdfError?: string | null } = {}
): Promise<void> {
  await prisma.libraryEntry.update({
    where: { id: entryId },
    data: { pdfStatus, ...patch },
  })
}

function safeSlug(str: string, max = 80): string {
  return str
    .replace(/[^a-zA-Z0-9_\u00C0-\u024F\u0400-\u04FF\u0600-\u06FF-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, max)
}

interface ProcessResponse {
  sourceId: string
  totalPages: number
  extractedText: string
  chunks: Array<{ pageNumber: number; chunkIndex: number; content: string }>
  ocrPending: boolean
}

/**
 * Call Python /process to extract + chunk a PDF. Returns chunks (may be empty
 * for scanned PDFs whose OCR is still running in the background — caller
 * should handle that). Returns null on hard failure.
 */
async function extractChunks(
  entryId: string,
  filePath: string
): Promise<{ ok: true; data: ProcessResponse } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${PYTHON_SERVICE_URL}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: entryId, filePath, fileType: 'pdf' }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const msg = `Python /process HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`
      console.error('[library-pipeline]', msg)
      return { ok: false, error: msg }
    }
    return { ok: true, data: (await res.json()) as ProcessResponse }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[library-pipeline] Python /process fetch failed:', msg)
    return { ok: false, error: `Fetch failed: ${msg.slice(0, 200)}` }
  }
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

/**
 * Full pipeline for an already-saved PDF at `filePath`: extract chunks,
 * embed them, persist to LibraryChunk, set pdfStatus='ready'.
 *
 * Idempotent — if chunks already exist for this entry, they're wiped and
 * rebuilt.
 */
export async function processAndEmbedLibraryPdf(entryId: string, filePath: string): Promise<void> {
  try {
    // Wipe any previous chunks (in case this is a reprocess).
    await prisma.libraryChunk.deleteMany({ where: { libraryEntryId: entryId } })

    await setStatus(entryId, 'extracting')

    const extractResult = await extractChunks(entryId, filePath)
    if (!extractResult.ok) {
      await setStatus(entryId, 'failed', { pdfError: extractResult.error })
      return
    }

    const proc = extractResult.data
    if (!proc.chunks || proc.chunks.length === 0) {
      if (proc.ocrPending) {
        // Scanned PDF — OCR running in the background. Mark as ready so the
        // user can still reference metadata; chunking will land later.
        await setStatus(entryId, 'ready')
      } else {
        await setStatus(entryId, 'failed', { pdfError: 'No text extracted' })
      }
      return
    }

    // Insert chunks first, then embed in batches and update.
    const created = await prisma.$transaction(
      proc.chunks.map((c) =>
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

    await setStatus(entryId, 'ready')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[library-pipeline] processAndEmbed failed for ${entryId}:`, err)
    await setStatus(entryId, 'failed', { pdfError: message })
  }
}

/**
 * Full pipeline for an open-access URL: download → save → extract → embed.
 */
export async function downloadLibraryPdf(entryId: string, pdfUrl: string): Promise<void> {
  const entry = await prisma.libraryEntry.findUnique({
    where: { id: entryId },
    select: { id: true, userId: true, authorSurname: true, title: true },
  })
  if (!entry) return

  try {
    await setStatus(entryId, 'downloading', { pdfError: null })

    const res = await fetch(pdfUrl, {
      signal: AbortSignal.timeout(60000),
      headers: {
        'User-Agent': 'Quilpen/1.0 (Academic Research Tool)',
        Accept: 'application/pdf,*/*',
      },
    })
    if (!res.ok) {
      await setStatus(entryId, 'failed', { pdfError: `HTTP ${res.status}` })
      return
    }

    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 1024) {
      await setStatus(entryId, 'failed', { pdfError: 'File too small — not a valid PDF' })
      return
    }

    const userDir = path.join(LIBRARY_DIR, entry.userId)
    await mkdir(userDir, { recursive: true })

    const safeName = safeSlug(`${entry.authorSurname}_${entry.title}`)
    const filename = `${entry.id}_${safeName}.pdf`
    const fullPath = path.join(userDir, filename)
    await writeFile(fullPath, buf)

    const relPath = path.relative(process.cwd(), fullPath)

    // File is on disk — now extract + embed. The helper itself handles
    // status transitions past this point.
    await prisma.libraryEntry.update({
      where: { id: entryId },
      data: { filePath: relPath, fileType: 'pdf' },
    })

    await processAndEmbedLibraryPdf(entryId, fullPath)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await setStatus(entryId, 'failed', { pdfError: message })
  }
}

/**
 * Kick off background downloads for multiple entries. Returns immediately;
 * callers can poll /api/library/pdf-status.
 */
export function startLibraryPdfBatch(jobs: Array<{ entryId: string; pdfUrl: string }>): void {
  for (const job of jobs) {
    setImmediate(() => {
      downloadLibraryPdf(job.entryId, job.pdfUrl).catch((err) => {
        console.error('[library-pipeline] download failed:', job.entryId, err)
      })
    })
  }
}

/**
 * Kick off background extract+embed for already-saved PDFs. Used by the
 * attach-pdf manual-upload path.
 */
export function startLibraryEmbedBatch(jobs: Array<{ entryId: string; filePath: string }>): void {
  for (const job of jobs) {
    setImmediate(() => {
      processAndEmbedLibraryPdf(job.entryId, job.filePath).catch((err) => {
        console.error('[library-pipeline] extract/embed failed:', job.entryId, err)
      })
    })
  }
}
