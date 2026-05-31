import type { Prisma, LibraryEntry } from '@prisma/client'
import { EntryType } from '@prisma/client'

const VALID_ENTRY_TYPES = new Set(Object.values(EntryType))

function toEntryType(value: string | null | undefined): EntryType {
  if (value && VALID_ENTRY_TYPES.has(value as EntryType)) return value as EntryType
  return EntryType.kitap
}

export interface LibraryMetaInput {
  entryType?: string | null
  authorSurname: string
  authorName?: string | null
  title: string
  shortTitle?: string | null
  editor?: string | null
  translator?: string | null
  publisher?: string | null
  publishPlace?: string | null
  year?: string | null
  volume?: string | null
  edition?: string | null
  journalName?: string | null
  journalVolume?: string | null
  journalIssue?: string | null
  pageRange?: string | null
  doi?: string | null
  url?: string | null
  accessDate?: string | null
}

export interface FindOrCreateLibraryEntryResult {
  entry: LibraryEntry
  created: boolean
}

/**
 * Find an existing LibraryEntry for (userId, authorSurname, title) or
 * create a new one with the supplied metadata. Used by the unified
 * source/library upload pipeline so that anything uploaded via the
 * project Sources page automatically lands in the user's global
 * library — same metadata, same chunks, deterministic link.
 *
 * Designed to be called BEFORE the PDF bytes are written to R2:
 *   1. caller extracts metadata (Haiku on first-pages text)
 *   2. caller invokes this helper to get/create the entry
 *   3. caller writes bytes to R2 using `savePdfBytesR2(userId, entry.id, ...)`
 *   4. caller updates the entry with filePath + pdfStatus='queued'
 *   5. caller enqueues an ingest job for the worker
 *
 * Returns `{ created: false }` when an entry already exists — the
 * caller can decide whether to overwrite the PDF, attach a new
 * volume, or skip. Default behavior should be: reuse the existing
 * entry, only attach a new PDF if the existing one has no filePath
 * (or pdfStatus='failed').
 */
export async function findOrCreateLibraryEntryFromMeta(
  tx: Prisma.TransactionClient,
  userId: string,
  meta: LibraryMetaInput,
): Promise<FindOrCreateLibraryEntryResult> {
  if (!meta.authorSurname?.trim() || !meta.title?.trim()) {
    throw new Error(
      'findOrCreateLibraryEntryFromMeta: authorSurname and title are required',
    )
  }

  const existing = await tx.libraryEntry.findUnique({
    where: {
      userId_authorSurname_title: {
        userId,
        authorSurname: meta.authorSurname.trim(),
        title: meta.title.trim(),
      },
    },
  })
  if (existing) return { entry: existing, created: false }

  const created = await tx.libraryEntry.create({
    data: {
      userId,
      entryType: toEntryType(meta.entryType),
      authorSurname: meta.authorSurname.trim(),
      authorName: meta.authorName ?? null,
      title: meta.title.trim(),
      shortTitle: meta.shortTitle ?? null,
      editor: meta.editor ?? null,
      translator: meta.translator ?? null,
      publisher: meta.publisher ?? null,
      publishPlace: meta.publishPlace ?? null,
      year: meta.year ?? null,
      volume: meta.volume ?? null,
      edition: meta.edition ?? null,
      journalName: meta.journalName ?? null,
      journalVolume: meta.journalVolume ?? null,
      journalIssue: meta.journalIssue ?? null,
      pageRange: meta.pageRange ?? null,
      doi: meta.doi ?? null,
      url: meta.url ?? null,
      accessDate: meta.accessDate ?? null,
      // PDF fields filled in by the caller once R2 save succeeds; we
      // leave them null here so an entry that exists but has never had
      // a file attached is visually distinct from a queued one.
      importSource: 'pdf-upload',
      pdfStatus: 'pending',
    },
  })
  return { entry: created, created: true }
}
