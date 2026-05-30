import type { Prisma } from '@prisma/client'

/**
 * Find or create a Bibliography entry for the given project.
 * Author string is expected as "Surname, Name" or just "Surname".
 * If userId is provided, also checks the user's library for a matching entry
 * and links it via libraryEntryId.
 */
export async function findOrCreateBibliography(
  tx: Prisma.TransactionClient,
  projectId: string,
  author: string,
  work: string,
  sourceId?: string,
  userId?: string
) {
  const authorParts = author.split(',').map((s) => s.trim())
  const surname = authorParts[0] ?? author
  const name = authorParts[1] ?? null

  let biblio = await tx.bibliography.findFirst({
    where: { projectId, title: work, authorSurname: surname },
  })

  if (!biblio) {
    // Check user's library for a matching entry. When found, COPY the
    // full metadata (year/publisher/publishPlace/editor/translator/…)
    // into the new bibliography row — the link alone is not enough,
    // the writing prompts and the Sources UI read these columns
    // directly. Without this copy, library-derived references showed
    // up as "eksik: yıl, yayınevi" even though the library knew.
    let libraryEntryId: string | null = null
    let libMeta: Partial<{
      entryType: 'kitap' | 'makale' | 'nesir' | 'ceviri' | 'tez' | 'ansiklopedi' | 'web'
      authorName: string | null
      shortTitle: string | null
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
      accessDate: string | null
    }> = {}
    if (userId) {
      const libraryEntry = await tx.libraryEntry.findFirst({
        where: {
          userId,
          authorSurname: surname,
          title: work,
        },
      })
      if (libraryEntry) {
        libraryEntryId = libraryEntry.id
        libMeta = {
          entryType: libraryEntry.entryType,
          authorName: libraryEntry.authorName ?? name,
          shortTitle: libraryEntry.shortTitle,
          editor: libraryEntry.editor,
          translator: libraryEntry.translator,
          publisher: libraryEntry.publisher,
          publishPlace: libraryEntry.publishPlace,
          year: libraryEntry.year,
          volume: libraryEntry.volume,
          edition: libraryEntry.edition,
          journalName: libraryEntry.journalName,
          journalVolume: libraryEntry.journalVolume,
          journalIssue: libraryEntry.journalIssue,
          pageRange: libraryEntry.pageRange,
          doi: libraryEntry.doi,
          url: libraryEntry.url,
          accessDate: libraryEntry.accessDate,
        }
      }
    }

    biblio = await tx.bibliography.create({
      data: {
        projectId,
        sourceId: sourceId ?? null,
        libraryEntryId,
        entryType: libMeta.entryType ?? 'kitap',
        authorSurname: surname,
        authorName: libMeta.authorName ?? name,
        title: work,
        ...(libMeta.shortTitle !== undefined && { shortTitle: libMeta.shortTitle }),
        ...(libMeta.editor !== undefined && { editor: libMeta.editor }),
        ...(libMeta.translator !== undefined && { translator: libMeta.translator }),
        ...(libMeta.publisher !== undefined && { publisher: libMeta.publisher }),
        ...(libMeta.publishPlace !== undefined && { publishPlace: libMeta.publishPlace }),
        ...(libMeta.year !== undefined && { year: libMeta.year }),
        ...(libMeta.volume !== undefined && { volume: libMeta.volume }),
        ...(libMeta.edition !== undefined && { edition: libMeta.edition }),
        ...(libMeta.journalName !== undefined && { journalName: libMeta.journalName }),
        ...(libMeta.journalVolume !== undefined && { journalVolume: libMeta.journalVolume }),
        ...(libMeta.journalIssue !== undefined && { journalIssue: libMeta.journalIssue }),
        ...(libMeta.pageRange !== undefined && { pageRange: libMeta.pageRange }),
        ...(libMeta.doi !== undefined && { doi: libMeta.doi }),
        ...(libMeta.url !== undefined && { url: libMeta.url }),
        ...(libMeta.accessDate !== undefined && { accessDate: libMeta.accessDate }),
      },
    })
  } else if (sourceId && !biblio.sourceId) {
    biblio = await tx.bibliography.update({
      where: { id: biblio.id },
      data: { sourceId },
    })
  }

  return biblio
}
