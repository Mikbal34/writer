/**
 * One-shot batch uploader for local PDFs the user dropped on the VM.
 * Walks /tmp/quilpen-incoming/, creates a LibraryEntry per file,
 * uploads to R2, and enqueues the ingest job — same pipeline a
 * browser upload would trigger.
 *
 * Usage (inside quilpen-worker-1 container):
 *   npx tsx scripts/upload-local-batch.ts <userId> [<sourceDir>]
 *
 * Default sourceDir = /tmp/quilpen-incoming
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { join, basename } from 'node:path'
import { prisma } from '@/lib/db'
import { savePdfBytesR2 } from '@/lib/r2-storage'
import { enqueueIngest } from '@/lib/queue'

async function main() {
  const userId = process.argv[2]
  const sourceDir = process.argv[3] || '/tmp/quilpen-incoming'
  if (!userId) {
    console.error('usage: upload-local-batch.ts <userId> [<sourceDir>]')
    process.exit(1)
  }

  const files = readdirSync(sourceDir)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .map((f) => join(sourceDir, f))

  if (files.length === 0) {
    console.error(`no PDFs in ${sourceDir}`)
    process.exit(1)
  }
  console.log(`found ${files.length} PDFs in ${sourceDir}`)

  for (const file of files) {
    const fname = basename(file)
    const bytes = readFileSync(file)
    const sizeBytes = statSync(file).size
    const fileHash = createHash('sha256').update(bytes).digest('hex')

    // Dedup: skip if same hash already exists for this user.
    const existing = await prisma.libraryEntry.findFirst({
      where: { userId, fileHash },
      select: { id: true, title: true },
    })
    if (existing) {
      console.log(`  ⊘ ${fname} — already uploaded as ${existing.id} (${existing.title?.slice(0, 60)})`)
      continue
    }

    // Title strip: drop "EN_" / "TR_" / "AR_" / "DE_" / "FR_" prefix
    // and ".pdf" extension. The pipeline's Sonnet enrich will replace
    // this placeholder with the proper title once OCR finishes.
    const placeholderTitle = fname
      .replace(/\.pdf$/i, '')
      .replace(/^(EN|TR|AR|DE|FR)_/, '')
      .replace(/_/g, ' ')

    // Two-step: create entry to get the cuid, then upload PDF to R2
    // at the canonical path that includes it, then patch filePath.
    const placeholderTag = randomBytes(4).toString('hex')
    const entry = await prisma.libraryEntry.create({
      data: {
        userId,
        entryType: 'kitap',
        title: placeholderTitle,
        authorSurname: `(Yükleme ${placeholderTag})`,
        importSource: 'pdf-upload',
        fileType: 'pdf',
        fileHash,
        pdfStatus: 'queued',
        metadata: { uploadSizeBytes: sizeBytes },
      },
    })

    const filePath = await savePdfBytesR2(userId, entry.id, bytes, 'pdf')
    await prisma.libraryEntry.update({
      where: { id: entry.id },
      data: { filePath },
    })
    await enqueueIngest({ kind: 'entry', entryId: entry.id })

    console.log(`  ✓ ${fname} → entry ${entry.id} (${(sizeBytes / 1048576).toFixed(1)} MB) — queued`)
  }

  console.log('\nDone. Workers will pick up the jobs and enrich metadata via Sonnet.')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
