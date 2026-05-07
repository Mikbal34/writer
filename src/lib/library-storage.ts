/**
 * Persistent PDF storage for LibraryEntry uploads.
 *
 * Files live at <STORAGE_ROOT>/<userId>/<entryId>.pdf. STORAGE_ROOT
 * defaults to /data/library-pdfs (Railway volume mount); local dev
 * falls back to <os.tmpdir()>/library-pdfs so tests don't need a
 * special filesystem layout.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

function storageRoot(): string {
  const fromEnv = process.env.LIBRARY_PDF_STORAGE_ROOT
  if (fromEnv) return fromEnv
  if (process.env.NODE_ENV === 'production') return '/data/library-pdfs'
  return path.join(os.tmpdir(), 'library-pdfs')
}

function entryDir(userId: string): string {
  // userId is a cuid, but be paranoid — strip anything not alphanumeric to
  // avoid path traversal if a future identity provider returns weird values.
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(storageRoot(), safe)
}

function entryPath(userId: string, entryId: string): string {
  const safeId = entryId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(entryDir(userId), `${safeId}.pdf`)
}

export async function savePdfBytes(
  userId: string,
  entryId: string,
  bytes: Buffer,
): Promise<string> {
  const dir = entryDir(userId)
  await fs.promises.mkdir(dir, { recursive: true })
  const dest = entryPath(userId, entryId)
  await fs.promises.writeFile(dest, bytes)
  return dest
}

export function pdfExists(filePath: string | null | undefined): boolean {
  if (!filePath) return false
  try {
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

export function openPdfStream(filePath: string): fs.ReadStream {
  return fs.createReadStream(filePath)
}

export async function deletePdf(filePath: string | null | undefined): Promise<void> {
  if (!filePath) return
  try {
    await fs.promises.unlink(filePath)
  } catch {
    // already gone — fine
  }
}
