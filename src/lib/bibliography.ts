import type { Prisma } from '@prisma/client'

type LibMeta = Partial<{
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
}>

// Normalize a title or surname for fuzzy comparison: lowercase, strip
// combining marks (so "İzutsu" ≈ "Izutsu"), strip punctuation, collapse
// whitespace. Used as a fallback when the LLM didn't pass an explicit
// libraryEntryId and strict equality missed (e.g. "Transcendent God:
// Rational World" vs "Transcendent God, Rational World").
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function pickLibMeta(libraryEntry: {
  entryType: LibMeta['entryType']
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
}, fallbackName: string | null): LibMeta {
  return {
    entryType: libraryEntry.entryType,
    authorName: libraryEntry.authorName ?? fallbackName,
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

/**
 * Find or create a Bibliography entry for the given project.
 * Author string is expected as "Surname, Name" or just "Surname".
 *
 * Library linking strategy (in priority order):
 *   1. `explicitLibraryEntryId` — caller (LLM via get_library_entries id)
 *      knows the exact LibraryEntry. Most trustworthy.
 *   2. Exact match on (userId, authorSurname, title).
 *   3. Normalized fuzzy match (case/punctuation insensitive).
 *
 * When a library entry is found, ALL its metadata is copied into the
 * bibliography row — the link alone is not enough; writing prompts and
 * the Sources UI read these columns directly.
 *
 * If an existing bibliography is found but has no libraryEntryId, and
 * a match is now available, it gets upgraded in-place (non-destructive:
 * only null fields are filled in).
 */
export async function findOrCreateBibliography(
  tx: Prisma.TransactionClient,
  projectId: string,
  author: string,
  work: string,
  sourceId?: string,
  userId?: string,
  explicitLibraryEntryId?: string,
) {
  const authorParts = author.split(',').map((s) => s.trim())
  const surname = authorParts[0] ?? author
  const name = authorParts[1] ?? null

  // Look up by the (project, libraryEntry) unique pair first when the
  // caller already knows the library entry — handles the common case
  // where the LLM-attached bibliography stored a slightly different
  // title ("Transcendent God: Rational World") than the one auto-
  // enrichment is now passing ("Transcendent God, Rational World").
  // Falling straight to title+surname findFirst there would miss the
  // existing row and the subsequent create would trip the
  // (projectId, libraryEntryId) unique constraint.
  let biblio = null as Awaited<ReturnType<typeof tx.bibliography.findFirst>>
  if (explicitLibraryEntryId) {
    biblio = await tx.bibliography.findFirst({
      where: { projectId, libraryEntryId: explicitLibraryEntryId },
    })
  }
  if (!biblio) {
    biblio = await tx.bibliography.findFirst({
      where: { projectId, title: work, authorSurname: surname },
    })
  }

  async function resolveLibraryMatch(): Promise<{ id: string; meta: LibMeta } | null> {
    if (!userId) return null

    // Tier 1 — explicit id from the caller (LLM-driven).
    if (explicitLibraryEntryId) {
      const entry = await tx.libraryEntry.findFirst({
        where: { id: explicitLibraryEntryId, userId },
      })
      if (entry) return { id: entry.id, meta: pickLibMeta(entry, name) }
    }

    // Tier 2 — strict equality.
    const exact = await tx.libraryEntry.findFirst({
      where: { userId, authorSurname: surname, title: work },
    })
    if (exact) return { id: exact.id, meta: pickLibMeta(exact, name) }

    // Tier 3 — normalized fuzzy match. Pull a narrowed candidate set
    // (surname prefix, case-insensitive) and compare normalized titles
    // in-memory; the candidate count is small enough per user that this
    // stays cheap without a trigram index.
    const normSurname = normalizeForMatch(surname)
    const normTitle = normalizeForMatch(work)
    if (!normSurname || !normTitle) return null

    const prefix = surname.slice(0, Math.min(4, surname.length))
    const candidates = await tx.libraryEntry.findMany({
      where: {
        userId,
        authorSurname: { contains: prefix, mode: 'insensitive' },
      },
      take: 200,
    })
    const hit = candidates.find((c) => {
      if (normalizeForMatch(c.authorSurname) !== normSurname) return false
      const ct = normalizeForMatch(c.title)
      if (ct === normTitle) return true
      // Prefix containment — the shorter title is a leading prefix of the
      // longer one (token-boundary aware). Catches the common case where
      // the LLM drops the subtitle: bib "Transcendent God, Rational World"
      // vs library "Transcendent God, Rational World: A Māturīdī Theology".
      // Both sides must have ≥3 tokens to keep accidental short-title
      // collisions out (e.g. "Tafsir" matching "Tafsir al-Razi").
      const minTokens = (s: string) => s.split(' ').length >= 3
      if (!minTokens(ct) || !minTokens(normTitle)) return false
      return ct.startsWith(normTitle + ' ') || normTitle.startsWith(ct + ' ')
    })
    if (hit) return { id: hit.id, meta: pickLibMeta(hit, name) }
    return null
  }

  if (!biblio) {
    let libraryEntryId: string | null = null
    let libMeta: LibMeta = {}
    const match = await resolveLibraryMatch()
    if (match) {
      libraryEntryId = match.id
      libMeta = match.meta
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
  } else {
    // Existing biblio — opportunistically (a) attach sourceId if missing,
    // (b) link a LibraryEntry if this row was created before library
    // linking worked or the user has since added the source to their
    // library. Metadata fill is non-destructive: only null columns are
    // populated, so manually-entered values are never overwritten.
    const updateData: Prisma.BibliographyUpdateInput = {}
    if (sourceId && !biblio.sourceId) {
      updateData.source = { connect: { id: sourceId } }
    }

    if (!biblio.libraryEntryId) {
      const match = await resolveLibraryMatch()
      if (match) {
        updateData.libraryEntry = { connect: { id: match.id } }
        const m = match.meta
        const fillIfNull = <K extends keyof LibMeta>(field: K, current: unknown) => {
          if (current == null && m[field] !== undefined && m[field] !== null) {
            ;(updateData as Record<string, unknown>)[field as string] = m[field]
          }
        }
        fillIfNull('authorName', biblio.authorName)
        fillIfNull('shortTitle', biblio.shortTitle)
        fillIfNull('editor', biblio.editor)
        fillIfNull('translator', biblio.translator)
        fillIfNull('publisher', biblio.publisher)
        fillIfNull('publishPlace', biblio.publishPlace)
        fillIfNull('year', biblio.year)
        fillIfNull('volume', biblio.volume)
        fillIfNull('edition', biblio.edition)
        fillIfNull('journalName', biblio.journalName)
        fillIfNull('journalVolume', biblio.journalVolume)
        fillIfNull('journalIssue', biblio.journalIssue)
        fillIfNull('pageRange', biblio.pageRange)
        fillIfNull('doi', biblio.doi)
        fillIfNull('url', biblio.url)
        fillIfNull('accessDate', biblio.accessDate)
      }
    }

    if (Object.keys(updateData).length > 0) {
      biblio = await tx.bibliography.update({
        where: { id: biblio.id },
        data: updateData,
      })
    }
  }

  return biblio
}
