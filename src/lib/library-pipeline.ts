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

import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '@/lib/db'
import { findPdf } from '@/lib/pdf-finder'
import { generateJSONWithUsage, HAIKU } from '@/lib/claude'
import { deductCredits } from '@/lib/credits'
import { extractPdfPages } from '@/lib/pdf-extract'
import { chunkByPage } from '@/lib/chunker'
import {
  buildEmbeddingText,
  contextualizeChunksBatched,
} from '@/lib/contextual-chunks'
import { generateBookSummary } from '@/lib/book-summary'
import { EntryType, Prisma } from '@prisma/client'

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? 'http://localhost:8000'
const EMBED_BATCH_SIZE = 100
const VALID_ENTRY_TYPES = new Set(Object.values(EntryType))

// undici's default headersTimeout is 5 min; intermittent TCP issues
// to the Python service then waste 5 min per failed cilt during bulk
// retries. AbortSignal.timeout fails the fetch faster without needing
// a custom dispatcher (which breaks Next.js's bundled undici).
//
// /process-bytes is 10 min — Arabic OCR'd PDFs from the classical
// works corpus genuinely take 3-8 min to chunk, so the earlier 3-min
// cap was producing false timeouts on healthy cilts. /embed is short
// because batches are fast even on slow networks.
const PROCESS_FETCH_TIMEOUT_MS = 10 * 60 * 1000
// BGE-M3 dense encoding of a 100-chunk batch on CPU can take 1–3
// minutes for long academic chunks. 2 minutes was too tight (smoke-test
// confirmed) — bump to 5 to absorb the worst case without firing false
// failures that retry the whole batch.
const EMBED_FETCH_TIMEOUT_MS = 5 * 60 * 1000
// Number of front pages to stitch into extractedText for the
// bibliography-enrichment Haiku call. Matches python-service/routers/
// process.py's _BIB_PAGES so prompts behave identically across paths.
const BIB_PAGES = 10

/**
 * Run native-text PDF extraction in-process via pdfjs and emit a
 * ProcessResponse-shaped object so the existing pipeline code (chunk
 * persistence, embedding, metadata enrichment) doesn't need to know
 * whether the work happened locally or in the Python service.
 *
 * Returns null when the PDF is image-only (scanned) — caller falls
 * back to /process-bytes which runs PyMuPDF + Tesseract OCR. Local
 * pdfjs has no OCR path, so this is the only divergence from the
 * Python pipeline.
 *
 * Why: PyMuPDF mis-decodes Turkish/Arabic font encodings on some
 * academic PDFs, producing chunk text that drifts from what the
 * viewer renders. pdfjs reads the same /ToUnicode CMaps the browser
 * uses, so chunks match the visible text 1:1 and the AI-quote
 * highlighter actually finds its target.
 */
async function extractPdfLocalAsProcessResponse(
  bytes: Buffer,
  sourceId: string,
): Promise<ProcessResponse | null> {
  const result = await extractPdfPages(bytes)
  if (result.needsOcr) {
    console.info(
      `[library-pipeline] ${sourceId}: pdfjs flagged needsOcr, deferring to Python OCR fallback`,
    )
    return null
  }
  if (result.pages.length === 0) return null

  const chunkRows = chunkByPage(result.pages)
  const chunks = chunkRows.map((c) => ({
    pageNumber: c.pageNumber,
    pageLabel: c.pageLabel,
    sectionTitle: c.sectionTitle,
    chunkIndex: c.chunkIndex,
    content: c.content,
  }))

  // Front-matter text for the Haiku metadata enricher — same shape
  // process.py builds via `f"[Page N]\n{content}"`.
  const extractedText = result.pages
    .slice(0, BIB_PAGES)
    .map((p) => `[Page ${p.pageNumber}]\n${p.content}`)
    .join('\n\n---\n\n')

  return {
    sourceId,
    totalPages: result.totalPages,
    extractedText,
    chunks,
    ocrPending: false,
    metadata: null,
  }
}

export interface PdfMetadataExtraction {
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
  // Multi-volume detection: when a PDF is one volume of a larger
  // work (Tafsir, hadis külliyatı, encyclopedia) Haiku sets these
  // and the library page surfaces a "ciltlere ayır" suggestion.
  volumeNumber: number | null
  parentWork: string | null
  volumeLabel: string | null
}

/**
 * Standalone Haiku metadata pass — no DB, no side effects. Used by
 * the bulk-upload preview ("Grupla → otomatik künye") to prefill a
 * group form without committing anything. Caller decides what to do
 * with the result.
 */
export async function extractMetadataFromText(
  text: string,
): Promise<{
  data: PdfMetadataExtraction
  inputTokens: number
  outputTokens: number
}> {
  const result = await generateJSONWithUsage<PdfMetadataExtraction>(
    `Analyze the text extracted from the first pages of the following document and return bibliography metadata plus an abstract as JSON.

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
  "abstract": null,
  "keywords": null,
  "volumeNumber": integer (1, 2, 3, ...) IF this document is one volume of a multi-volume work; otherwise null,
  "parentWork": "Title of the parent multi-volume work — ONLY when volumeNumber is set",
  "volumeLabel": "Subtitle of this specific volume — ONLY when volumeNumber is set"
}

Rules:
- Leave fields you cannot extract as null. Use null for abstract/keywords (preview mode skips them).
- Determine entryType from the document style.
- If no clear author is found, use "Unknown".
- Return ONLY the JSON, no commentary.`,
    'You are a bibliography extraction assistant. Respond with valid JSON only.',
    { model: HAIKU }
  )
  return {
    data: result.data,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  }
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
      importSource: true,
    },
  })
  if (!entry) return

  // For drag-drop uploads the title/authorSurname are placeholders
  // derived from the filename — always overwrite with whatever the
  // PDF text actually says. For lit-search / Zotero / BibTeX entries
  // the existing metadata is canonical, so we still preserve it.
  const isUpload = entry.importSource === 'pdf-upload'

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
  "keywords": ["up to 6 subject keywords derived from the text"] or null,
  "volumeNumber": integer (1, 2, 3, ...) IF this PDF is one volume of a multi-volume work — look for explicit markers like "Cilt 2", "Volume II", "الجزء الثاني", "Tome 2", "Bd. 3" on the cover or title page; otherwise null,
  "parentWork": "Title of the parent multi-volume work (e.g. 'et-Tahrir ve't-Tenvir', 'Encyclopaedia of Islam') ONLY when volumeNumber is also set; otherwise null",
  "volumeLabel": "Subtitle of this specific volume (e.g. 'Sûre el-Bakara', 'A-D entries') ONLY when volumeNumber is also set; otherwise null"
}

Rules:
- Leave fields you cannot extract as null.
- Determine entryType from the document style (academic article → "makale", book → "kitap").
- If no clear author is found, use "Unknown".
- Be CONSERVATIVE about volumeNumber/parentWork — only set them when the text shows an explicit multi-volume marker. A simple "Volume 2 Issue 3" of a journal is NOT a parent-work volume; that's journalVolume.
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
    // literature-search-derived metadata. Exception: drag-drop uploads
    // start with placeholder author/title from the filename, so for
    // those we always overwrite.
    const data: Record<string, unknown> = {}
    const maybe = <K extends keyof typeof entry>(
      key: K,
      candidate: string | null | undefined
    ) => {
      if (!isUpload) {
        const existing = entry[key]
        if (existing && String(existing).trim().length > 0) return
      }
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

    // Keywords: fill if empty (or always for drag-drop uploads).
    if (
      (isUpload || !entry.keywords || entry.keywords.length === 0) &&
      Array.isArray(extracted.keywords)
    ) {
      const clean = extracted.keywords.filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
      if (clean.length > 0) data.keywords = clean.slice(0, 6)
    }

    // entryType — trust the PDF-derived type when the entry is a default
    // "kitap" (always true for drag-drop uploads).
    if (extracted.entryType && VALID_ENTRY_TYPES.has(extracted.entryType as EntryType)) {
      if (entry.entryType === 'kitap' || !entry.entryType) {
        data.entryType = extracted.entryType
      }
    }

    // Multi-volume hint — when Haiku detects "Cilt 2 / Volume II / الجزء"
    // markers we write the signal to metadata so the library page can
    // show a banner: "Bu cilt görünüyor — mevcut esere ekle / yeni
    // multi-volume entry oluştur". We don't auto-restructure anything;
    // the user resolves the suggestion.
    if (
      extracted.volumeNumber &&
      typeof extracted.volumeNumber === 'number' &&
      extracted.volumeNumber > 0 &&
      extracted.parentWork &&
      String(extracted.parentWork).trim().length > 0
    ) {
      data.metadata = {
        volumeHint: {
          volumeNumber: Math.floor(extracted.volumeNumber),
          parentWork: String(extracted.parentWork).trim(),
          volumeLabel: extracted.volumeLabel
            ? String(extracted.volumeLabel).trim()
            : null,
        },
      } as Prisma.InputJsonValue
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
  chunks: Array<{
    pageNumber: number
    /** Printed page label from the PDF (e.g. "49" when pageNumber is
     *  64). NULL when the PDF lacks /PageLabels or fell back to pypdf;
     *  citation renderers should prefer it over pageNumber when set. */
    pageLabel?: string | null
    /** Section heading the chunk sits under (e.g. "BÖLÜM 3:
     *  KAVRAMSAL ÇERÇEVE"). Propagated by the Node extractor when
     *  available; Python-pipeline chunks won't carry it. */
    sectionTitle?: string | null
    chunkIndex: number
    content: string
  }>
  ocrPending: boolean
  // Native bibliographic fields when the source format exposes them
  // (EPUB Dublin Core, DOCX core_properties). Empty/null for PDFs.
  metadata?: NativeDocMetadata | null
}

interface NativeDocMetadata {
  title?: string
  author?: string
  year?: string
  abstract?: string
  publisher?: string
  language?: string
  keywords?: string[]
}

/**
 * Apply native metadata pulled from EPUB/DOCX file headers. For
 * pdf-upload entries we override the placeholder author/title that
 * the upload route stamps in (otherwise the "filename as title" stays
 * forever); for other entries we only fill blank fields so manual
 * bibliography edits aren't clobbered.
 *
 * Mirrors the `isUpload` carve-out in enrichLibraryEntryFromPdfText
 * so both code paths behave consistently.
 */
async function applyNativeMetadata(
  entryId: string,
  metadata: NativeDocMetadata,
): Promise<void> {
  const entry = await prisma.libraryEntry.findUnique({
    where: { id: entryId },
    select: {
      authorSurname: true,
      authorName: true,
      title: true,
      year: true,
      abstract: true,
      publisher: true,
      keywords: true,
      importSource: true,
    },
  })
  if (!entry) return
  const isUpload = entry.importSource === 'pdf-upload'

  const data: Record<string, unknown> = {}

  // Split "Firstname Middle Lastname" into (authorName, authorSurname).
  // EPUB DC creator values are usually plain strings; if the publisher
  // happens to write "Last, First" we flip the halves around.
  if (metadata.author) {
    let surname = ''
    let givenNames: string | null = null
    if (metadata.author.includes(',')) {
      const [last, ...rest] = metadata.author.split(',')
      surname = last.trim()
      givenNames = rest.join(',').trim() || null
    } else {
      const parts = metadata.author.trim().split(/\s+/)
      if (parts.length === 1) {
        surname = parts[0]
      } else {
        surname = parts[parts.length - 1]
        givenNames = parts.slice(0, -1).join(' ')
      }
    }
    const shouldFillSurname =
      isUpload || !entry.authorSurname.trim() ||
      entry.authorSurname.startsWith('(Yükleme')
    if (surname && shouldFillSurname) {
      data.authorSurname = surname
    }
    const shouldFillGiven =
      isUpload || !entry.authorName || entry.authorName.trim().length === 0
    if (givenNames && shouldFillGiven) {
      data.authorName = givenNames
    }
  }

  const maybeFill = <K extends keyof typeof entry>(
    key: K,
    candidate: string | null | undefined,
  ) => {
    if (!candidate) return
    if (!isUpload) {
      const existing = entry[key]
      if (existing && String(existing).trim().length > 0) return
    }
    data[key as string] = candidate
  }

  maybeFill('title', metadata.title)
  maybeFill('year', metadata.year)
  maybeFill('abstract', metadata.abstract)
  maybeFill('publisher', metadata.publisher)

  if (
    Array.isArray(metadata.keywords) &&
    metadata.keywords.length > 0 &&
    (isUpload || !entry.keywords || entry.keywords.length === 0)
  ) {
    data.keywords = metadata.keywords.slice(0, 12)
  }

  if (Object.keys(data).length > 0) {
    await prisma.libraryEntry.update({
      where: { id: entryId },
      data,
    })
  }
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

/**
 * Volume-aware status update — used by the multi-volume pipeline so a
 * stuck volume doesn't drag the whole entry's status down with it.
 */
async function setVolumeStatus(
  volumeId: string,
  pdfStatus: string,
  patch: { pdfError?: string | null; totalPages?: number | null } = {}
): Promise<void> {
  await prisma.libraryEntryVolume.update({
    where: { id: volumeId },
    data: { pdfStatus, ...patch },
  })
}

async function embedBatch(texts: string[]): Promise<number[][] | null> {
  try {
    const res = await fetch(`${PYTHON_SERVICE_URL}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts }),
      signal: AbortSignal.timeout(EMBED_FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(
        `[library-pipeline] Python /embed HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
      )
      return null
    }
    const data = (await res.json()) as { embeddings: number[][] }
    return data.embeddings
  } catch (err) {
    console.error('[library-pipeline] Python /embed failed:', err)
    return null
  }
}

async function persistChunks(
  entryId: string,
  chunks: ProcessResponse['chunks'],
  volumeId: string | null = null,
): Promise<void> {
  // Scope the delete-and-replace to the volume the new chunks belong
  // to, so adding/replacing one volume's PDF doesn't wipe the others.
  if (volumeId) {
    await prisma.libraryChunk.deleteMany({ where: { volumeId } })
  } else {
    await prisma.libraryChunk.deleteMany({
      where: { libraryEntryId: entryId, volumeId: null },
    })
  }
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
    // Quality filter — drop chunks that survived the extractor's
    // junk-page pass but are still noise. Even after that pass, a
    // small number of chunks slip through that are either too short
    // to embed meaningfully or look like reference apparatus (long
    // lists of "Surname, F. (1999). Title…" entries the back-matter
    // heading detector missed). These pollute retrieval, so strip
    // at the persistence boundary as the last line of defence.
    .filter((c) => {
      // Too short to embed meaningfully — vector will be high-
      // variance noise and even verbatim queries won't usefully
      // match.
      if (c.content.length < 150) return false
      // Looks like a reference/bibliography fragment that slipped
      // through. Heuristic: dense in citation markers (year-in-parens,
      // "et al.", "pp.", "vol.") and the chunk itself is short.
      const refMarkers =
        (c.content.match(/\(\d{4}[a-z]?\)/g)?.length ?? 0) +
        (c.content.match(/\bet al\.|\bpp?\.\s*\d|\bvol\.\s*\d/g)?.length ?? 0)
      if (refMarkers >= 4 && c.content.length < 800) return false
      // Mostly numeric / page-ref noise — more digits than letters
      // is almost always TOC/index leftover.
      const digits = (c.content.match(/\d/g) ?? []).length
      // Include the Arabic block U+0600-U+06FF so Arabic-language
      // chunks aren't all classified as "100% digits" by virtue of
      // their letters not being in the Latin/Turkish class. Before
      // this fix every Arabic prose chunk failed the digit-ratio
      // check and got silently dropped at the persistence boundary.
      const letters = (c.content.match(/[A-Za-zÇŞĞÜÖİçşğüöı؀-ۿ]/g) ?? []).length
      if (letters > 0 && digits / (digits + letters) > 0.5) return false
      return true
    })

  if (safeChunks.length === 0) return

  // Books with hundreds of chunks blow past Prisma's default 5s
  // interactive-transaction window. Use createManyAndReturn (Prisma 7+)
  // for a single bulk INSERT that also gives us the generated ids
  // back so the embedding update loop can target them.
  const created = await prisma.libraryChunk.createManyAndReturn({
    data: safeChunks.map((c) => ({
      libraryEntryId: entryId,
      volumeId,
      pageNumber: c.pageNumber,
      pdfPageLabel: c.pageLabel ?? null,
      sectionTitle: c.sectionTitle ?? null,
      chunkIndex: c.chunkIndex,
      content: c.content,
    })),
    select: {
      id: true,
      content: true,
      pageNumber: true,
      pdfPageLabel: true,
      sectionTitle: true,
    },
  })

  if (volumeId) {
    await setVolumeStatus(volumeId, 'embedding')
  } else {
    await setStatus(entryId, 'embedding')
  }

  // Contextual retrieval (Anthropic 2024): generate a 1-2 sentence
  // context per chunk via Haiku, prepend it to the chunk text, and
  // embed the combined string. Paper claims ~35% precision lift,
  // but that's vs. a *naked* vector baseline — we already run
  // hybrid retrieval (vector + Postgres FTS) and a Haiku reranker
  // downstream, which together close most of that gap without any
  // per-chunk LLM cost. Contextual prefix on top adds ~$0.50–$2
  // per ingested book in Haiku spend (worse with rate-limit
  // retries), so it's gated behind an env flag. Default OFF —
  // enable by setting CONTEXTUAL_PREFIX_ENABLED=1 if a specific
  // corpus actually justifies the bill.
  let contextMap = new Map<string, string | null>()
  if (process.env.CONTEXTUAL_PREFIX_ENABLED === '1') {
    try {
      const entryForCtx = await prisma.libraryEntry.findUnique({
        where: { id: entryId },
        select: {
          title: true,
          authorSurname: true,
          authorName: true,
          year: true,
        },
      })
      if (entryForCtx) {
        // Batched + serial: 10 chunks per Haiku call, one batch in
        // flight at a time. Bursting (parallelBatches>1) is what
        // crushed the first backfill's success rate — sustained
        // throughput beats peak throughput here.
        contextMap = await contextualizeChunksBatched(entryForCtx, created)
      }
    } catch (err) {
      console.warn(
        '[library-pipeline] contextualize failed (continuing without prefix):',
        err,
      )
    }
  } else {
    console.log(
      '[library-pipeline] contextual prefix disabled (CONTEXTUAL_PREFIX_ENABLED!=1) — embedding bare content',
    )
  }

  // Persist the generated prefixes alongside the chunks so the
  // backfill / migration tool can re-run embeddings later without
  // re-paying Haiku for the context.
  for (const [chunkId, ctx] of contextMap) {
    if (!ctx) continue
    await prisma.libraryChunk.update({
      where: { id: chunkId },
      data: { contextualPrefix: ctx },
    })
  }

  // Embedding is intentionally NOT done here anymore. persistChunks
  // inserts the chunks (embedding = NULL) + their contextual prefixes
  // and leaves status at "embedding". The caller then runs the separate,
  // resumable embedPendingChunks() — so a crash mid-embed resumes from
  // the remaining NULL chunks instead of re-extracting the whole PDF.

  // Volume reprocesses don't refresh the entry summary — let the
  // primary entry-level pipeline own that field so multi-volume
  // works don't have their summary regenerated for every cilt.
  if (volumeId) return

  // Book summary cache: pull the freshly-inserted chunks back and
  // ask Haiku for a 250-400 word summary. Stored on
  // LibraryEntry.summary so the chat router can answer generic
  // "bu kitap ne anlatıyor" questions directly without round-
  // tripping through RAG (which usually misroutes those to the
  // colophon page).
  try {
    const entryForSummary = await prisma.libraryEntry.findUnique({
      where: { id: entryId },
      select: { title: true, authorSurname: true, authorName: true },
    })
    if (entryForSummary) {
      const chunkRows = await prisma.libraryChunk.findMany({
        where: { libraryEntryId: entryId },
        orderBy: { chunkIndex: 'asc' },
        select: { content: true, pageNumber: true },
      })
      const summary = await generateBookSummary({
        title: entryForSummary.title,
        authorSurname: entryForSummary.authorSurname,
        authorName: entryForSummary.authorName,
        sampleChunks: chunkRows,
      })
      if (summary) {
        await prisma.libraryEntry.update({
          where: { id: entryId },
          data: { summary },
        })
      }
    }
  } catch (err) {
    console.warn(
      '[library-pipeline] book summary generation failed (continuing):',
      err,
    )
  }
}

/**
 * Resumable embedding step. Embeds every chunk of an entry/volume whose
 * embedding is still NULL, in batches, reusing the contextualPrefix that
 * persistChunks already stored. Safe to re-run: a crash mid-embed leaves
 * the embedded chunks intact and re-running picks up only the remaining
 * NULL ones — no re-extraction. Throws only if there were pending chunks
 * and EVERY batch failed (so the caller can flip status to "failed").
 *
 * Returns { pending, embedded } so the orchestrator can decide status.
 */
export async function embedPendingChunks(
  entryId: string,
  volumeId: string | null = null,
): Promise<{ pending: number; embedded: number }> {
  // embedding is an Unsupported() column, so it isn't a filterable field
  // on the typed client — query the NULL set with raw SQL instead.
  const rows = volumeId
    ? await prisma.$queryRaw<{ id: string; content: string; contextualPrefix: string | null }[]>`
        SELECT id, content, "contextualPrefix" FROM "LibraryChunk"
        WHERE "volumeId" = ${volumeId} AND embedding IS NULL
        ORDER BY "chunkIndex" ASC`
    : await prisma.$queryRaw<{ id: string; content: string; contextualPrefix: string | null }[]>`
        SELECT id, content, "contextualPrefix" FROM "LibraryChunk"
        WHERE "libraryEntryId" = ${entryId} AND "volumeId" IS NULL AND embedding IS NULL
        ORDER BY "chunkIndex" ASC`
  const pending = rows.length
  if (pending === 0) return { pending: 0, embedded: 0 }

  let embedded = 0
  for (let i = 0; i < rows.length; i += EMBED_BATCH_SIZE) {
    const batch = rows.slice(i, i + EMBED_BATCH_SIZE)
    const texts = batch.map((c) => buildEmbeddingText(c.content, c.contextualPrefix))
    const vectors = await embedBatch(texts)
    if (!vectors || vectors.length !== batch.length) continue
    for (let j = 0; j < batch.length; j++) {
      await prisma.$executeRawUnsafe(
        `UPDATE "LibraryChunk" SET embedding = $1::vector WHERE id = $2`,
        JSON.stringify(vectors[j]),
        batch[j].id,
      )
    }
    embedded += batch.length
  }

  if (embedded === 0) {
    throw new Error('Embedding başarısız: /embed her batch için hata döndü')
  }
  return { pending, embedded }
}

/**
 * Local-first variant of tryProcessUrl: downloads the PDF in Node
 * and runs it through the pdfjs extractor before falling back to
 * the Python /process-url path. Same intent as the byte-upload
 * paths — chunks should come from pdfjs whenever possible so they
 * match what the viewer renders. Python OCR remains the safety net
 * for scanned PDFs.
 */
async function tryProcessUrlLocalFirst(
  entryId: string,
  url: string,
): Promise<{ ok: true; data: ProcessResponse } | { ok: false; error: string; status: number }> {
  try {
    const dl = await fetch(url, {
      signal: AbortSignal.timeout(PROCESS_FETCH_TIMEOUT_MS),
      redirect: 'follow',
    })
    if (!dl.ok) {
      return {
        ok: false,
        error: `download HTTP ${dl.status}`,
        status: dl.status,
      }
    }
    const ct = dl.headers.get('content-type') ?? ''
    if (ct && !ct.includes('pdf') && !ct.includes('octet-stream')) {
      return {
        ok: false,
        error: `non-PDF content-type ${ct.slice(0, 80)}`,
        status: 415,
      }
    }
    const ab = await dl.arrayBuffer()
    const bytes = Buffer.from(ab)
    try {
      const data = await extractPdfLocalAsProcessResponse(bytes, entryId)
      if (data) return { ok: true, data }
    } catch (err) {
      console.warn(
        `[library-pipeline] ${entryId}: pdfjs URL extract threw, falling back to Python:`,
        err,
      )
    }
    // pdfjs returned null (needsOcr) or threw — fall back to Python.
    return tryProcessUrl(entryId, url)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message, status: 0 }
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
      signal: AbortSignal.timeout(PROCESS_FETCH_TIMEOUT_MS),
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
      const result = await tryProcessUrlLocalFirst(entryId, url)
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
      await embedPendingChunks(entryId)
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

    // Try local pdfjs extraction first — keeps chunk text aligned
    // with what the viewer renders so AI-quote highlighting works
    // for Turkish/Arabic PDFs that PyMuPDF mis-decodes.
    let data: ProcessResponse | null = null
    try {
      data = await extractPdfLocalAsProcessResponse(bytes, entryId)
    } catch (err) {
      console.warn(
        `[library-pipeline] ${entryId}: pdfjs extract threw, deferring to Python:`,
        err,
      )
    }

    if (!data) {
      // Fallback to Python service (scanned/image-only PDFs need its
      // Tesseract OCR pipeline; pdfjs has no OCR mode).
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
        signal: AbortSignal.timeout(PROCESS_FETCH_TIMEOUT_MS),
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        const msg = `Python /process-bytes HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`
        console.error('[library-pipeline]', msg)
        await setStatus(entryId, 'failed', { pdfError: msg })
        return
      }

      data = (await res.json()) as ProcessResponse
    }

    if (!data.chunks || data.chunks.length === 0) {
      await setStatus(entryId, 'failed', { pdfError: 'No text extracted' })
      return
    }

    // Native metadata (EPUB DC / DOCX core_properties) — apply first so
    // the placeholder author/title set by the upload route is replaced
    // before any UI poll snapshots it. PDF responses leave metadata
    // empty and fall through to the Haiku enrichment below.
    if (data.metadata && Object.keys(data.metadata).length > 0) {
      try {
        await applyNativeMetadata(entryId, data.metadata)
      } catch (err) {
        console.error(`[library-pipeline] applyNativeMetadata failed for ${entryId}:`, err)
      }
    }

    await enrichLibraryEntryFromPdfText(entryId, data.extractedText)
    await persistChunks(entryId, data.chunks)
    await embedPendingChunks(entryId)
    await setStatus(entryId, 'ready')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[library-pipeline] processFromBytes failed for ${entryId}:`, err)
    await setStatus(entryId, 'failed', { pdfError: message })
  }
}

/**
 * Volume-aware version of processLibraryPdfFromBytes for multi-volume
 * works. The PDF belongs to a specific LibraryEntryVolume row; chunks
 * are tagged with volumeId so a (entry, volume) pair can be retrieved
 * independently. Status updates flow to the volume row, not the entry.
 *
 * Skips Haiku metadata enrichment — the entry's bibliographic fields
 * are shared across volumes; only the parent entry's first volume (or
 * a manual edit) should populate them.
 */
export async function processLibraryVolumePdfFromBytes(
  entryId: string,
  volumeId: string,
  filename: string,
  bytes: Buffer
): Promise<void> {
  try {
    await setVolumeStatus(volumeId, 'extracting', { pdfError: null })

    // Same local-first strategy as the entry-level path: pdfjs node
    // extraction for native-text PDFs, Python /process-bytes only
    // when the document is image-only and needs OCR.
    let data: ProcessResponse | null = null
    try {
      data = await extractPdfLocalAsProcessResponse(bytes, volumeId)
    } catch (err) {
      console.warn(
        `[library-pipeline] volume ${volumeId}: pdfjs extract threw, deferring to Python:`,
        err,
      )
    }

    if (!data) {
      const form = new FormData()
      form.append('sourceId', volumeId)
      form.append(
        'file',
        new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }),
        filename
      )

      const res = await fetch(`${PYTHON_SERVICE_URL}/process-bytes`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(PROCESS_FETCH_TIMEOUT_MS),
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        const msg = `Python /process-bytes HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`
        console.error('[library-pipeline]', msg)
        await setVolumeStatus(volumeId, 'failed', { pdfError: msg })
        return
      }

      data = (await res.json()) as ProcessResponse
    }

    if (!data.chunks || data.chunks.length === 0) {
      await setVolumeStatus(volumeId, 'failed', { pdfError: 'No text extracted' })
      return
    }

    // Don't clobber fileType — the volume upload route already
    // recorded the real value ('pdf' | 'epub' | 'docx'). Just persist
    // the page count we now know.
    await prisma.libraryEntryVolume.update({
      where: { id: volumeId },
      data: { totalPages: data.totalPages },
    })

    await persistChunks(entryId, data.chunks, volumeId)
    await embedPendingChunks(entryId, volumeId)
    await setVolumeStatus(volumeId, 'ready')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[library-pipeline] volume processFromBytes failed for ${volumeId}:`, err)
    await setVolumeStatus(volumeId, 'failed', { pdfError: message })
  }
}

/**
 * Ingest text extracted OUTSIDE this process — i.e. the Surya OCR
 * service's output for scanned hard-script PDFs (Arabic, Persian, …).
 * The original PDF is still saved by the caller for the viewer; only the
 * chunk *text* comes from OCR, so the viewer renders the scan while
 * retrieval runs on clean text.
 *
 * `pages` are 1-based PDF-page → text. A spread's right+left halves are
 * already merged by the OCR service, so pageNumber matches the page the
 * viewer renders (citation alignment stays correct).
 */
function ocrPagesToChunks(pages: { pageNumber: number; text: string }[]) {
  return chunkByPage(
    pages.map((p) => ({ pageNumber: p.pageNumber, content: p.text })),
  ).map((c) => ({
    pageNumber: c.pageNumber,
    pageLabel: c.pageLabel,
    sectionTitle: c.sectionTitle,
    chunkIndex: c.chunkIndex,
    content: c.content,
  }))
}

export async function ingestExtractedTextForEntry(
  entryId: string,
  pages: { pageNumber: number; text: string }[],
  opts: { enrich?: boolean } = {},
): Promise<void> {
  try {
    await setStatus(entryId, 'extracting', { pdfError: null })
    const chunks = ocrPagesToChunks(pages)
    if (chunks.length === 0) {
      await setStatus(entryId, 'failed', { pdfError: 'No text extracted (OCR)' })
      return
    }
    if (opts.enrich) {
      const frontMatter = pages
        .slice(0, BIB_PAGES)
        .map((p) => `[Page ${p.pageNumber}]\n${p.text}`)
        .join('\n\n---\n\n')
      try {
        await enrichLibraryEntryFromPdfText(entryId, frontMatter)
      } catch (err) {
        console.warn(`[library-pipeline] OCR enrich failed for ${entryId}:`, err)
      }
    }
    await persistChunks(entryId, chunks)
    await embedPendingChunks(entryId)
    await setStatus(entryId, 'ready')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[library-pipeline] ingestExtractedTextForEntry failed for ${entryId}:`, err)
    await setStatus(entryId, 'failed', { pdfError: message })
  }
}

export async function ingestExtractedTextForVolume(
  entryId: string,
  volumeId: string,
  pages: { pageNumber: number; text: string }[],
): Promise<void> {
  try {
    await setVolumeStatus(volumeId, 'extracting', { pdfError: null })
    const chunks = ocrPagesToChunks(pages)
    if (chunks.length === 0) {
      await setVolumeStatus(volumeId, 'failed', { pdfError: 'No text extracted (OCR)' })
      return
    }
    await prisma.libraryEntryVolume.update({
      where: { id: volumeId },
      data: { totalPages: pages.length },
    })
    await persistChunks(entryId, chunks, volumeId)
    await embedPendingChunks(entryId, volumeId)
    await setVolumeStatus(volumeId, 'ready')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[library-pipeline] ingestExtractedTextForVolume failed for ${volumeId}:`, err)
    await setVolumeStatus(volumeId, 'failed', { pdfError: message })
  }
}

/**
 * Re-runs the volume pipeline against the file already persisted at
 * `volume.filePath`. Used by /api/library/[id]/volumes/[volumeId]/reprocess
 * to recover ciltler that failed once (Python downtime, embed errors)
 * without forcing the user to delete + re-upload.
 */
export async function reprocessLibraryVolume(
  entryId: string,
  volumeId: string,
): Promise<void> {
  const volume = await prisma.libraryEntryVolume.findUnique({
    where: { id: volumeId },
    select: { libraryEntryId: true, filePath: true, volumeNumber: true },
  })
  if (!volume) throw new Error('Cilt bulunamadı')
  if (volume.libraryEntryId !== entryId) throw new Error('Cilt bu esere ait değil')
  if (!volume.filePath) {
    throw new Error('Cilt için kayıtlı dosya yok — silip yeniden yüklemen gerek')
  }
  const bytes = await fs.promises.readFile(volume.filePath)
  await processLibraryVolumePdfFromBytes(
    entryId,
    volumeId,
    path.basename(volume.filePath),
    bytes,
  )
}

/**
 * Generate + persist the pgvector embedding for a single LibraryNote.
 *
 * Notes are short relative to PDF chunks (a few sentences to a few
 * paragraphs), so we embed the full `contentText` in one shot rather
 * than splitting it. Used by Notes POST/PATCH via setImmediate so the
 * write returns instantly and the embed catches up in the background;
 * the chat retrieval UNION simply skips notes whose embedding is still
 * NULL.
 */
export async function embedLibraryNote(noteId: string): Promise<void> {
  const note = await prisma.libraryNote.findUnique({
    where: { id: noteId },
    select: { id: true, contentText: true },
  })
  if (!note) return
  const text = (note.contentText ?? '').trim()
  if (!text) return

  const vectors = await embedBatch([text])
  if (!vectors || vectors.length === 0) {
    console.warn('[library-pipeline] embedLibraryNote failed for', noteId)
    return
  }
  await prisma.$executeRawUnsafe(
    `UPDATE "LibraryNote" SET embedding = $1::vector WHERE id = $2`,
    JSON.stringify(vectors[0]),
    note.id,
  )
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
