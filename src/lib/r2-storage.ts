/**
 * Cloudflare R2 (S3 API) storage for library document files. Replaces the
 * Railway local-volume storage (src/lib/library-storage.ts) in the new
 * stack: the web process writes uploads to R2, the worker reads them back
 * by key. R2 egress is free, so serving PDFs to the viewer costs nothing.
 *
 * DB compatibility: filePath is kept as the SAME logical path string the
 * local storage produced (<root>/<userId>/<entryId>.pdf). The R2 object
 * key is that path with the storage-root prefix stripped — which is
 * exactly how the Faz 1 migration uploaded the existing 337 files.
 *
 * Env: R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
 */
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { Readable } from 'node:stream'

type DocFileType = 'pdf' | 'epub' | 'docx'

const STORAGE_ROOT = '/data/library-pdfs'

function ext(fileType: DocFileType | string | null | undefined): string {
  if (fileType === 'epub') return '.epub'
  if (fileType === 'docx') return '.docx'
  return '.pdf'
}

const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_')

/** Logical filePath (stored in DB) for an entry-level file. */
export function entryFilePath(userId: string, entryId: string, fileType: DocFileType | null = 'pdf') {
  return `${STORAGE_ROOT}/${safe(userId)}/${safe(entryId)}${ext(fileType)}`
}

/** Logical filePath (stored in DB) for a volume file. */
export function volumeFilePath(
  userId: string,
  entryId: string,
  volumeId: string,
  fileType: DocFileType | null = 'pdf',
) {
  return `${STORAGE_ROOT}/${safe(userId)}/${safe(entryId)}/${safe(volumeId)}${ext(fileType)}`
}

/** R2 object key for a stored filePath — strip the storage-root prefix. */
export function keyFromFilePath(filePath: string): string {
  let k = filePath
  const roots = [STORAGE_ROOT + '/', STORAGE_ROOT]
  for (const r of roots) if (k.startsWith(r)) { k = k.slice(r.length); break }
  return k.replace(/^\/+/, '')
}

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

const contentTypeFor = (ft: string) =>
  ft === 'epub' ? 'application/epub+zip'
    : ft === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : 'application/pdf'

export async function savePdfBytesR2(
  userId: string,
  entryId: string,
  bytes: Buffer,
  fileType: DocFileType = 'pdf',
): Promise<string> {
  const filePath = entryFilePath(userId, entryId, fileType)
  await client().send(new PutObjectCommand({
    Bucket: bucket(), Key: keyFromFilePath(filePath), Body: bytes,
    ContentType: contentTypeFor(fileType),
  }))
  return filePath
}

export async function saveVolumePdfBytesR2(
  userId: string,
  entryId: string,
  volumeId: string,
  bytes: Buffer,
  fileType: DocFileType = 'pdf',
): Promise<string> {
  const filePath = volumeFilePath(userId, entryId, volumeId, fileType)
  await client().send(new PutObjectCommand({
    Bucket: bucket(), Key: keyFromFilePath(filePath), Body: bytes,
    ContentType: contentTypeFor(fileType),
  }))
  return filePath
}

/** Download a stored file fully into a Buffer (worker reads the PDF here). */
export async function getBytesFromFilePath(filePath: string): Promise<Buffer> {
  const res = await client().send(new GetObjectCommand({
    Bucket: bucket(), Key: keyFromFilePath(filePath),
  }))
  const chunks: Buffer[] = []
  for await (const c of res.Body as Readable) chunks.push(Buffer.from(c))
  return Buffer.concat(chunks)
}

/** Stream a stored file (the /pdf viewer endpoint reads here in Faz 4). */
export async function getStreamFromFilePath(filePath: string): Promise<Readable> {
  const res = await client().send(new GetObjectCommand({
    Bucket: bucket(), Key: keyFromFilePath(filePath),
  }))
  return res.Body as Readable
}

export async function pdfExistsR2(filePath: string | null | undefined): Promise<boolean> {
  if (!filePath) return false
  try {
    await client().send(new HeadObjectCommand({ Bucket: bucket(), Key: keyFromFilePath(filePath) }))
    return true
  } catch {
    return false
  }
}

/**
 * Generate a short-lived signed URL for a stored file. Used by the
 * worker → python-service handoff: instead of POSTing a 27-44MB PDF
 * body across Fly's internal IPv6 mesh (which silently corrupts the
 * upload mid-stream for large multipart bodies), the worker hands a
 * URL to python-service and python downloads it from R2 directly.
 * Sub-200-byte mesh payload; arbitrary file size; one less hop.
 */
export async function presignDownloadUrl(
  filePath: string,
  expiresInSeconds = 900,
): Promise<string> {
  return await getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: bucket(), Key: keyFromFilePath(filePath) }),
    { expiresIn: expiresInSeconds },
  )
}

export async function deletePdfR2(filePath: string | null | undefined): Promise<void> {
  if (!filePath) return
  try {
    await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: keyFromFilePath(filePath) }))
  } catch {
    /* already gone — fine */
  }
}
