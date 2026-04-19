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
import { generateJSONWithUsage, HAIKU } from '@/lib/claude'
import { deductCredits } from '@/lib/credits'
import { EntryType } from '@prisma/client'

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? 'http://localhost:8000'
const EMBED_BATCH_SIZE = 100
const VALID_ENTRY_TYPES = new Set(Object.values(EntryType))

interface PdfMetadataExtraction {
  entryType: string | null
  authorSurname: string | null
  authorName: string | null
  title: string | null
  editor: string | null
  translator: string | null
  publisher: string | null
  publishPlace: string | null
  year: string | null
  volume: string | null
  edition: string | null
  journalName: string | null
  journalVolume: string | null
  journalIssue: string | null
  pageRange: string | null
  doi: string | null
  url: string | null
  abstract: string | null
  keywords: string[] | null
}

/**
 * Ask Haiku to pull bibliography metadata + abstract out of the extracted
 * PDF text, and then update the LibraryEntry *only for fields the entry
 * doesn't already have*. Literature-search entries already carry rich
 * metadata — we don't want to overwrite it with a weaker PDF-derived guess.
 */
export async function enrichLibraryEntryFromPdfText(
  entryId: string,
  extractedText: string
): Promise<void> {
  const text = (extractedText ?? '').trim()
  if (text.length < 200) return

  const entry = await prisma.libraryEntry.findUnique({
    where: { id: entryId },
    select: {
      userId: true,
      entryType: true,
      authorSurname: true,
      authorName: true,
      title: true,
      editor: true,
      translator: true,
      publisher: true,
      publishPlace: true,
      year: true,
      volume: true,
      edition: true,
      journalName: true,
      journalVolume: true,
      journalIssue: true,
      pageRange: true,
      doi: true,
      url: true,
      abstract: true,
      keywords: true,
    },
  })
  if (!entry) return

  try {
    const result = await generateJSONWithUsage<PdfMetadataExtraction>(
      `Analyze the text extracted from the first pages of the following PDF and return bibliography metadata plus an abstract as JSON.

Text:
---
${text.slice(0, 8000)}
---

Return in this JSON format:
{
  "entryType": "kitap" | "makale" | "nesir" | "ceviri" | "tez" | "ansiklopedi" | "web",
  "authorSurname": "Author's surname",
  "authorName": "Author's first name or null",
  "title": "Full title of the work",
  "editor": "Editor or null",
  "translator": "Translator or null",
  "publisher": "Publisher or null",
  "publishPlace": "Place of publication or null",
  "year": "Publication year or null",
  "volume": "Volume or null",
  "edition": "Edition or null",
  "journalName": "Journal name or null",
  "journalVolume": "Journal volume or null",
  "journalIssue": "Journal issue or null",
  "pageRange": "Page range or null",
  "doi": "DOI or null",
  "url": "URL or null",
  "abstract": "Concise abstract / summary of the work (around 150-300 words). If a formal abstract section is present, use it verbatim. Otherwise summarize the first pages.",
  "keywords": ["up to 6 subject keywords derived from the text"] or null
}

Rules:
- Leave fields you cannot extract as null.
- Determine entryType from the document style (academic article → "makale", book → "kitap").
- If no clear author is found, use "Unknown".
- Abstract must be in the document's original language.
- Return ONLY the JSON, no commentary.`,
      'You are a bibliography + abstract extraction assistant. Respond with valid JSON only.',
      { model: HAIKU }
    )

    const extracted = result.data

    // Charge credits (non-fatal if it fails).
    deductCredits(
      entry.userId,
      'source_upload_extract',
      result.inputTokens,
      result.outputTokens,
      'haiku',
      { libraryEntryId: entryId }
    ).catch((e) => console.error('[library-pipeline] extract credit deduction failed:', e))

    // Only fill fields the entry doesn't already have — never overwrite
    // literature-search-derived metadata.
    const data: Record<string, unknown> = {}
    const maybe = <K extends keyof typeof entry>(
      key: K,
      candidate: string | null | undefined
    ) => {
      const existing = entry[key]
      if (existing && String(existing).trim().length > 0) return
      if (!candidate || candidate === 'null' || candidate === 'Unknown') return
      data[key as string] = candidate
    }

    maybe('authorSurname', extracted.authorSurname)
    maybe('authorName', extracted.authorName)
    maybe('title', extracted.title)
    maybe('editor', extracted.editor)
    maybe('translator', extracted.translator)
    maybe('publisher', extracted.publisher)
    maybe('publishPlace', extracted.publishPlace)
    maybe('year', extracted.year)
    maybe('volume', extracted.volume)
    maybe('edition', extracted.edition)
    maybe('journalName', extracted.journalName)
    maybe('journalVolume', extracted.journalVolume)
    maybe('journalIssue', extracted.journalIssue)
    maybe('pageRange', extracted.pageRange)
    maybe('doi', extracted.doi)
    maybe('url', extracted.url)
    maybe('abstract', extracted.abstract)

    // Keywords: only fill if empty.
    if ((!entry.keywords || entry.keywords.length === 0) && Array.isArray(extracted.keywords)) {
      const clean = extracted.keywords.filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
      if (clean.length > 0) data.keywords = clean.slice(0, 6)
    }

    // entryType — only if not manually set to something specific, and the
    // extracted value is a valid enum value.
    if (extracted.entryType && VALID_ENTRY_TYPES.has(extracted.entryType as EntryType)) {
      // Always trust the PDF-derived type more than the default "kitap", but
      // not when the entry already has a non-default type.
      if (entry.entryType === 'kitap' || !entry.entryType) {
        data.entryType = extracted.entryType
      }
    }

    if (Object.keys(data).length > 0) {
      await prisma.libraryEntry.update({
        where: { id: entryId },
        data,
      })
    }
  } catch (err) {
    console.warn('[library-pipeline] metadata extraction failed:', err)
    // Non-fatal — chunking still proceeds.
  }
}

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

  // findPdf tries Unpaywall / Semantic Scholar / OpenAlex / CORE. It uses
  // DOI when present and falls back to title + author otherwise, so we
  // always call it — the DOI-less path can still rescue common cases where
  // the primary openAccessUrl points at a landing page.
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

  // Defence-in-depth: strip NUL bytes (0x00) that Postgres refuses to store
  // in UTF-8 TEXT columns. Python already scrubs these in the chunker, but
  // older/unusual PDFs can still slip one through.
  const safeChunks = chunks
    .map((c) => ({
      ...c,
      content: (c.content ?? '').replace(/\u0000/g, '').trim(),
    }))
    .filter((c) => c.content.length > 0)

  if (safeChunks.length === 0) return

  const created = await prisma.$transaction(
    safeChunks.map((c) =>
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
      await enrichLibraryEntryFromPdfText(entryId, data.extractedText)
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

    await enrichLibraryEntryFromPdfText(entryId, data.extractedText)
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
 * When userId is passed we also emit a BackgroundJob so the navbar bell
 * can surface progress and completion.
 */
export function startLibraryPdfBatch(
  jobs: Array<{ entryId: string; pdfUrl: string }>,
  userId?: string
): void {
  if (jobs.length === 0) return

  if (!userId) {
    for (const job of jobs) {
      setImmediate(() => {
        processLibraryPdfFromUrl(job.entryId, job.pdfUrl).catch((err) => {
          console.error('[library-pipeline] URL job failed:', job.entryId, err)
        })
      })
    }
    return
  }

  setImmediate(() => {
    void (async () => {
      const { startJob, updateJob, completeJob, failJob } = await import('@/lib/jobs')
      let jobId: string | null = null
      try {
        jobId = await startJob({
          userId,
          type: 'pdf_pipeline',
          title: `${jobs.length} PDF işleniyor`,
          resultUrl: '/library',
          message: `0/${jobs.length} tamamlandı`,
        })
      } catch (err) {
        console.error('[library-pipeline] startJob failed:', err)
      }

      let done = 0
      for (const job of jobs) {
        try {
          await processLibraryPdfFromUrl(job.entryId, job.pdfUrl)
        } catch (err) {
          console.error('[library-pipeline] URL job failed:', job.entryId, err)
        }
        done++
        if (jobId) {
          try {
            await updateJob(jobId, {
              progress: Math.round((done / jobs.length) * 100),
              message: `${done}/${jobs.length} tamamlandı`,
            })
          } catch {
            // non-fatal
          }
        }
      }

      if (jobId) {
        try {
          await completeJob(jobId, { message: `${done} PDF tamamlandı` })
        } catch (err) {
          await failJob(jobId, err instanceof Error ? err.message : String(err))
        }
      }
    })()
  })
}
