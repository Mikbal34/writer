/**
 * Library-level PDF pipeline.
 *
 * After a user adds a literature-search result to their library, this module
 * downloads the open-access PDF, stores it under uploads/library/<userId>/, and
 * updates the LibraryEntry's pdfStatus. Chunking + embedding happen lazily the
 * first time the entry is referenced from a project (see writing pipeline).
 *
 * All jobs are fire-and-forget; callers should not await them unless they want
 * synchronous behaviour (e.g. in tests).
 */

import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '@/lib/db'

const UPLOADS_DIR = path.join(process.cwd(), 'uploads')
const LIBRARY_DIR = path.join(UPLOADS_DIR, 'library')

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
    await setStatus(entryId, 'ready', { filePath: relPath, fileType: 'pdf' })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await setStatus(entryId, 'failed', { pdfError: message })
  }
}

/**
 * Kick off background downloads for multiple entries. Returns immediately;
 * the caller can poll /api/library/entries/:id/status for progress.
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
