/**
 * Library document storage — R2-backed (Cloudflare). This module is the
 * drop-in replacement for the old local-disk implementation; callers
 * keep using the same function names. The Railway-era /data filesystem
 * is gone in the new stack — everything lives in R2 (egress free).
 *
 * filePath is still the logical path string stored in LibraryEntry /
 * LibraryEntryVolume rows (<root>/<userId>/<entryId>.<ext>); the R2 key
 * is that path minus the storage-root prefix (see r2-storage.ts). The
 * Faz 1 migration uploaded existing files at exactly these keys, so
 * the stored filePaths keep resolving.
 *
 * Note: `pdfExists` is now async (HEAD against R2). The two route
 * handlers that previously called it synchronously now `await` it.
 */
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CopyObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import type { Readable } from 'node:stream'
import {
  entryFilePath,
  volumeFilePath,
  keyFromFilePath,
  savePdfBytesR2,
  saveVolumePdfBytesR2,
  getStreamFromFilePath,
} from './r2-storage'

type DocFileType = 'pdf' | 'epub' | 'docx'

// Re-export the path helpers + writers + stream reader so callers can
// keep importing from `@/lib/library-storage` regardless of backend.
export { entryFilePath, volumeFilePath } from './r2-storage'
export const savePdfBytes = savePdfBytesR2
export const saveVolumePdfBytes = saveVolumePdfBytesR2
export const openPdfStream = getStreamFromFilePath

// Local helper so we don't double-construct an S3Client.
let _client: S3Client | null = null
function client(): S3Client {
  if (!_client) {
    const account = process.env.R2_ACCOUNT_ID
    const accessKeyId = process.env.R2_ACCESS_KEY_ID
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
    if (!account || !accessKeyId || !secretAccessKey) {
      throw new Error('R2 env missing (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)')
    }
    _client = new S3Client({
      region: 'auto',
      endpoint: `https://${account}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    })
  }
  return _client
}
function bucket(): string {
  const b = process.env.R2_BUCKET
  if (!b) throw new Error('R2_BUCKET is not set')
  return b
}

/** Async HEAD against R2. Empty / null path is treated as "no file". */
export async function pdfExists(filePath: string | null | undefined): Promise<boolean> {
  if (!filePath) return false
  try {
    await client().send(new HeadObjectCommand({ Bucket: bucket(), Key: keyFromFilePath(filePath) }))
    return true
  } catch {
    return false
  }
}

/** Download a stored file fully into a Buffer (the /pdf endpoint). */
export async function getPdfBytes(filePath: string): Promise<Buffer> {
  const res = await client().send(new GetObjectCommand({
    Bucket: bucket(), Key: keyFromFilePath(filePath),
  }))
  const chunks: Buffer[] = []
  for await (const c of res.Body as Readable) chunks.push(Buffer.from(c))
  return Buffer.concat(chunks)
}

export async function deletePdf(filePath: string | null | undefined): Promise<void> {
  if (!filePath) return
  try {
    await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: keyFromFilePath(filePath) }))
  } catch {
    /* already gone — fine */
  }
}

/**
 * Cleanup hook for LibraryEntry deletion: removes everything under the
 * <userId>/<entryId>/ prefix (volume files). The entry's primary
 * filePath (single-volume legacy) sits one level up and is unlinked
 * separately by deletePdf().
 */
export async function deleteEntryVolumesDir(userId: string, entryId: string): Promise<void> {
  const safeUser = userId.replace(/[^a-zA-Z0-9_-]/g, '_')
  const safeEntry = entryId.replace(/[^a-zA-Z0-9_-]/g, '_')
  const prefix = `${safeUser}/${safeEntry}/`
  let token: string | undefined
  do {
    const list = await client().send(new ListObjectsV2Command({
      Bucket: bucket(), Prefix: prefix, ContinuationToken: token,
    }))
    const keys = list.Contents?.map((o) => ({ Key: o.Key! })) ?? []
    if (keys.length > 0) {
      await client().send(new DeleteObjectsCommand({
        Bucket: bucket(), Delete: { Objects: keys, Quiet: true },
      }))
    }
    token = list.IsTruncated ? list.NextContinuationToken : undefined
  } while (token)
}

/**
 * Promote an entry-level file to a volume-shaped path: R2 has no rename,
 * so we CopyObject to the new key and DeleteObject from the old one.
 */
export async function moveToVolumePath(
  userId: string,
  oldFilePath: string,
  newParentEntryId: string,
  volumeId: string,
  fileType: DocFileType = 'pdf',
): Promise<string> {
  const dest = volumeFilePath(userId, newParentEntryId, volumeId, fileType)
  const srcKey = keyFromFilePath(oldFilePath)
  const dstKey = keyFromFilePath(dest)
  await client().send(new CopyObjectCommand({
    Bucket: bucket(), Key: dstKey,
    CopySource: `${bucket()}/${encodeURIComponent(srcKey).replace(/%2F/g, '/')}`,
  }))
  await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: srcKey }))
  return dest
}
