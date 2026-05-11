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

type DocFileType = 'pdf' | 'epub' | 'docx'

function extFor(fileType: DocFileType | string | null | undefined): string {
  if (fileType === 'epub') return '.epub'
  if (fileType === 'docx') return '.docx'
  return '.pdf'
}

function entryPath(userId: string, entryId: string, fileType: DocFileType | null = 'pdf'): string {
  const safeId = entryId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(entryDir(userId), `${safeId}${extFor(fileType)}`)
}

function volumePath(
  userId: string,
  entryId: string,
  volumeId: string,
  fileType: DocFileType | null = 'pdf',
): string {
  const safeEntry = entryId.replace(/[^a-zA-Z0-9_-]/g, '_')
  const safeVol = volumeId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(entryDir(userId), safeEntry, `${safeVol}${extFor(fileType)}`)
}

export async function savePdfBytes(
  userId: string,
  entryId: string,
  bytes: Buffer,
  fileType: DocFileType = 'pdf',
): Promise<string> {
  const dir = entryDir(userId)
  await fs.promises.mkdir(dir, { recursive: true })
  const dest = entryPath(userId, entryId, fileType)
  await fs.promises.writeFile(dest, bytes)
  return dest
}

/**
 * Persist a document for a specific volume of a multi-volume entry.
 * File lives in <STORAGE_ROOT>/<userId>/<entryId>/<volumeId>.<ext> so
 * it's grouped with its sibling volumes and easy to clean up when the
 * parent entry is deleted.
 */
export async function saveVolumePdfBytes(
  userId: string,
  entryId: string,
  volumeId: string,
  bytes: Buffer,
  fileType: DocFileType = 'pdf',
): Promise<string> {
  const safeEntry = entryId.replace(/[^a-zA-Z0-9_-]/g, '_')
  const dir = path.join(entryDir(userId), safeEntry)
  await fs.promises.mkdir(dir, { recursive: true })
  const dest = volumePath(userId, entryId, volumeId, fileType)
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

/**
 * Move an entry-level file to a volume-shaped path under a (possibly
 * different) parent entry. Used by the promote-to-volume flow which
 * grafts a one-off upload into a multi-volume entry without
 * re-uploading the bytes.
 */
export async function moveToVolumePath(
  userId: string,
  oldFilePath: string,
  newParentEntryId: string,
  volumeId: string,
  fileType: DocFileType = 'pdf',
): Promise<string> {
  const safeEntry = newParentEntryId.replace(/[^a-zA-Z0-9_-]/g, '_')
  const dir = path.join(entryDir(userId), safeEntry)
  await fs.promises.mkdir(dir, { recursive: true })
  const dest = volumePath(userId, newParentEntryId, volumeId, fileType)
  try {
    await fs.promises.rename(oldFilePath, dest)
  } catch {
    // Cross-device rename can fail; fall back to copy + delete.
    await fs.promises.copyFile(oldFilePath, dest)
    try {
      await fs.promises.unlink(oldFilePath)
    } catch {
      /* ignore */
    }
  }
  return dest
}

export async function deletePdf(filePath: string | null | undefined): Promise<void> {
  if (!filePath) return
  try {
    await fs.promises.unlink(filePath)
  } catch {
    // already gone — fine
  }
}

/**
 * Cleanup hook for LibraryEntry deletion: removes the per-entry
 * directory under <STORAGE_ROOT>/<userId>/<entryId> which holds all
 * the volume PDFs for a multi-volume entry. The entry's primary
 * filePath (single-volume legacy) is at the parent level and is
 * unlinked separately by deletePdf().
 */
export async function deleteEntryVolumesDir(
  userId: string,
  entryId: string,
): Promise<void> {
  const safeUser = userId.replace(/[^a-zA-Z0-9_-]/g, '_')
  const safeEntry = entryId.replace(/[^a-zA-Z0-9_-]/g, '_')
  const dir = path.join(storageRoot(), safeUser, safeEntry)
  try {
    await fs.promises.rm(dir, { recursive: true, force: true })
  } catch {
    // best-effort cleanup
  }
}
