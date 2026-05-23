/**
 * Ingest job runner — the unit of work the BullMQ worker executes.
 *
 * Resumable + idempotent by construction:
 *   - chunks present, some embedding NULL  → resume: embed remaining only
 *   - chunks present, all embedded         → already done: just flip to ready
 *   - no chunks                            → fresh: download PDF from R2, run pipeline
 *
 * The pipeline functions (processLibraryPdfFromBytes etc.) swallow their
 * own errors and set status='failed' rather than throwing. The worker
 * needs the opposite — a thrown error so BullMQ retries with backoff — so
 * after running we re-read the status and throw if it landed on 'failed'.
 */
import { prisma } from '@/lib/db'
import { getBytesFromFilePath } from '@/lib/r2-storage'
import {
  processLibraryPdfFromBytes,
  processLibraryPdfFromUrl,
  processLibraryVolumePdfFromBytes,
  embedPendingChunks,
  enrichLibraryEntryFromPdfText,
  extractPdfLocalAsProcessResponse,
} from '@/lib/library-pipeline'
import type { IngestJob } from '@/lib/queue'

type Counts = { total: number; nullc: number }

async function chunkCounts(column: 'libraryEntryId' | 'volumeId', id: string): Promise<Counts> {
  const rows = column === 'volumeId'
    ? await prisma.$queryRaw<{ total: bigint; nullc: bigint }[]>`
        SELECT COUNT(*) total, COUNT(*) FILTER (WHERE embedding IS NULL) nullc
        FROM "LibraryChunk" WHERE "volumeId" = ${id}`
    : await prisma.$queryRaw<{ total: bigint; nullc: bigint }[]>`
        SELECT COUNT(*) total, COUNT(*) FILTER (WHERE embedding IS NULL) nullc
        FROM "LibraryChunk" WHERE "libraryEntryId" = ${id} AND "volumeId" IS NULL`
  return { total: Number(rows[0].total), nullc: Number(rows[0].nullc) }
}

export async function runIngestJob(job: IngestJob): Promise<Record<string, unknown>> {
  // ── metadata-only re-run ────────────────────────────────────────
  // Re-extracts the front pages from the stored R2 file via local
  // pdfjs (fast, no Python round-trip) and re-runs the enrich pipeline.
  // Chunks/embeddings are untouched.
  if (job.kind === 'enrich') {
    const ent = await prisma.libraryEntry.findUnique({
      where: { id: job.entryId },
      select: { id: true, filePath: true, title: true },
    })
    if (!ent) throw new Error(`entry ${job.entryId} not found`)
    if (!ent.filePath) throw new Error(`entry ${ent.id} has no filePath`)
    const bytes = await getBytesFromFilePath(ent.filePath)
    const data = await extractPdfLocalAsProcessResponse(bytes, ent.id)
    if (!data || !data.extractedText || data.extractedText.length < 200) {
      // Scanned PDF without a text layer — pdfjs can't help; the full
      // pipeline (Tesseract/Surya) would, but that's a `kind:'entry'`
      // re-run, not a metadata-only refresh.
      throw new Error('no extractable text for enrich (likely scanned — re-run ingest instead)')
    }
    await enrichLibraryEntryFromPdfText(ent.id, data.extractedText)
    return { kind: 'enrich', entryId: ent.id }
  }

  if (job.kind === 'entry') {
    const entry = await prisma.libraryEntry.findUnique({
      where: { id: job.entryId },
      select: { id: true, filePath: true, openAccessUrl: true, title: true, pdfStatus: true },
    })
    if (!entry) throw new Error(`entry ${job.entryId} not found`)

    const { total, nullc } = await chunkCounts('libraryEntryId', entry.id)
    if (total > 0) {
      if (nullc > 0) await embedPendingChunks(entry.id) // resume embed
      await prisma.libraryEntry.update({
        where: { id: entry.id }, data: { pdfStatus: 'ready', pdfError: null },
      })
      return { kind: 'entry', resumed: true, total, embedded: nullc }
    }

    // Fresh ingest. Stored R2 file wins; URL-only entries (open-access /
    // Zotero) re-download through the URL path. Both run in the worker,
    // not the web process.
    if (entry.filePath) {
      const bytes = await getBytesFromFilePath(entry.filePath)
      await processLibraryPdfFromBytes(entry.id, entry.title ?? 'upload.pdf', bytes)
    } else if (entry.openAccessUrl) {
      await processLibraryPdfFromUrl(entry.id, entry.openAccessUrl)
    } else {
      throw new Error(`entry ${entry.id} has no filePath or openAccessUrl (nothing to ingest)`)
    }

    const after = await prisma.libraryEntry.findUnique({
      where: { id: entry.id }, select: { pdfStatus: true, pdfError: true },
    })
    if (after?.pdfStatus === 'failed') throw new Error(after.pdfError || 'ingest failed')
    return { kind: 'entry', fresh: true, status: after?.pdfStatus }
  }

  // volume
  const vol = await prisma.libraryEntryVolume.findUnique({
    where: { id: job.volumeId },
    select: { id: true, filePath: true, libraryEntryId: true, pdfStatus: true },
  })
  if (!vol) throw new Error(`volume ${job.volumeId} not found`)

  const { total, nullc } = await chunkCounts('volumeId', vol.id)
  if (total > 0) {
    if (nullc > 0) await embedPendingChunks(vol.libraryEntryId, vol.id)
    await prisma.libraryEntryVolume.update({
      where: { id: vol.id }, data: { pdfStatus: 'ready', pdfError: null },
    })
    return { kind: 'volume', resumed: true, total, embedded: nullc }
  }

  if (!vol.filePath) throw new Error(`volume ${vol.id} has no filePath (nothing to ingest)`)
  const bytes = await getBytesFromFilePath(vol.filePath)
  await processLibraryVolumePdfFromBytes(
    vol.libraryEntryId, vol.id, job.filename ?? 'upload.pdf', bytes,
  )

  const after = await prisma.libraryEntryVolume.findUnique({
    where: { id: vol.id }, select: { pdfStatus: true, pdfError: true },
  })
  if (after?.pdfStatus === 'failed') throw new Error(after.pdfError || 'ingest failed')
  return { kind: 'volume', fresh: true, status: after?.pdfStatus }
}
