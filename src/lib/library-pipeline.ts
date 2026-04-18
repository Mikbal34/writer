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
import { findPdf } from '@/lib/pdf-finder'

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? 'http://localhost:8000'
const EMBED_BATCH_SIZE = 100

/**
 * Normalize a PMC article page URL to its direct PDF URL.
 * e.g. https://www.ncbi.nlm.nih.gov/pmc/articles/9801271/  →
 *      https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9801271/pdf/
 */
function normalizePmcUrl(url: string): string | null {
  const match = url.match(/ncbi\.nlm\.nih\.gov\/pmc\/articles\/(?:PMC)?(\d+)\/?/i)
  if (!match) return null
  return `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${match[1]}/pdf/`
}

/**
 * Produce a prioritized list of candidate PDF URLs for a library entry.
 * The first URL is the original openAccessUrl; subsequent candidates cover
 * publishers that block bots or URLs that point at landing pages.
 */
async function buildPdfCandidates(
  openAccessUrl: string,
  entry: { doi: string | null; title: string; authorSurname: string; entryType: string }
): Promise<string[]> {
  const candidates: string[] = []
  const seen = new Set<string>()
  const add = (url: string | null | undefined) => {
    if (!url) return
    const normalized = url.trim()
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    candidates.push(normalized)
  }

  add(openAccessUrl)

  const pmcPdf = normalizePmcUrl(openAccessUrl)
  add(pmcPdf)

  // Unpaywall lookup (only when we have a DOI — it's the authoritative key).
  if (entry.doi) {
    try {
      const fromFinder = await findPdf({
        doi: entry.doi,
        title: entry.title,
        authorSurname: entry.authorSurname,
        entryType: entry.entryType,
      })
      if (fromFinder.found && fromFinder.pdfUrl) add(fromFinder.pdfUrl)
    } catch (err) {
      console.warn('[library-pipeline] findPdf fallback failed:', err)
    }
  }

  return candidates
}

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

async function tryProcessUrl(
  entryId: string,
  url: string
): Promise<{ ok: true; data: ProcessResponse } | { ok: false; error: string; status: number }> {
  try {
    const res = await fetch(`${PYTHON_SERVICE_URL}/process-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: entryId, url }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return {
        ok: false,
        status: res.status,
        error: `HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
      }
    }
    return { ok: true, data: (await res.json()) as ProcessResponse }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 0, error: `Fetch failed: ${msg.slice(0, 200)}` }
  }
}

/**
 * Process a literature-search open-access URL, trying multiple candidate
 * URLs (PMC normalization + Unpaywall fallback) in sequence. First
 * successful extraction wins; we record which URL worked in openAccessUrl
 * so reprocessing always uses the known-good one.
 */
export async function processLibraryPdfFromUrl(entryId: string, pdfUrl: string): Promise<void> {
  try {
    await setStatus(entryId, 'extracting', { pdfError: null })

    const entry = await prisma.libraryEntry.findUnique({
      where: { id: entryId },
      select: { doi: true, title: true, authorSurname: true, entryType: true },
    })
    if (!entry) return

    const candidates = await buildPdfCandidates(pdfUrl, entry)
    const attemptLog: string[] = []

    for (const url of candidates) {
      const result = await tryProcessUrl(entryId, url)
      if (!result.ok) {
        attemptLog.push(`${shortUrl(url)} → ${result.error.slice(0, 120)}`)
        continue
      }

      const data = result.data
      if (!data.chunks || data.chunks.length === 0) {
        attemptLog.push(`${shortUrl(url)} → no text extracted`)
        continue
      }

      await prisma.libraryEntry.update({
        where: { id: entryId },
        data: { openAccessUrl: url, fileType: 'pdf' },
      })
      await persistChunks(entryId, data.chunks)
      await setStatus(entryId, 'ready')
      return
    }

    // All candidates failed.
    const summary = attemptLog.join(' | ') || 'no candidate URLs'
    await setStatus(entryId, 'failed', {
      pdfError: `All ${candidates.length} PDF candidate(s) failed. ${summary.slice(0, 400)}`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[library-pipeline] processFromUrl failed for ${entryId}:`, err)
    await setStatus(entryId, 'failed', { pdfError: message })
  }
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.host
  } catch {
    return url.slice(0, 40)
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
