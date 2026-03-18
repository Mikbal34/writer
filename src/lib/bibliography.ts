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
    // Check user's library for a matching entry
    let libraryEntryId: string | null = null
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
      }
    }

    biblio = await tx.bibliography.create({
      data: {
        projectId,
        sourceId: sourceId ?? null,
        libraryEntryId,
        entryType: 'kitap',
        authorSurname: surname,
        authorName: name,
        title: work,
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
