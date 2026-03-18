import type { EntryType, CitationFormat } from '@prisma/client'

// ==================== CORE ENTRY TYPE ====================

export interface BibliographyEntry {
  id: string
  projectId: string
  sourceId: string | null
  entryType: EntryType
  /** Author's surname / family name */
  authorSurname: string
  /** Author's given name(s) */
  authorName: string | null
  /** Full title of the work (italicised in output) */
  title: string
  /** Short title used in subsequent footnote references */
  shortTitle: string | null
  /** Editor name (for edited volumes) */
  editor: string | null
  /** Translator name — used with "çev." in ISNAD, "trans." in Chicago */
  translator: string | null
  /** Publisher name */
  publisher: string | null
  /** Place of publication */
  publishPlace: string | null
  /** Publication year */
  year: string | null
  /** Volume number or total volume count */
  volume: string | null
  /** Edition number (e.g. "2") */
  edition: string | null
  /** Journal / periodical name */
  journalName: string | null
  /** Journal volume number */
  journalVolume: string | null
  /** Journal issue number */
  journalIssue: string | null
  /** Page range for articles / specific pages for book chapters */
  pageRange: string | null
  /** DOI */
  doi: string | null
  /** URL for web sources */
  url: string | null
  /** Arbitrary additional metadata */
  metadata: Record<string, unknown> | null
  createdAt: Date
}

// ==================== CITATION FORMAT TYPES ====================

/** Re-export the Prisma enum so callers only need to import from this file */
export type { CitationFormat }
export type CitationFormatType = CitationFormat

// ==================== FOOTNOTE FORMATS ====================

export interface FootnoteFormat {
  /** Formatted string for the first (full) footnote citation */
  first: string
  /** Formatted string for all subsequent citations to the same work */
  subsequent: string
}

// ==================== BIBLIOGRAPHY FORMAT ====================

export interface BibliographyFormat {
  /** Formatted string for the bibliography / works-cited entry */
  entry: string
  /** The key used to sort this entry alphabetically */
  sortKey: string
}

// ==================== CITATION REQUEST ====================

/**
 * Everything a formatter needs to build one citation.
 * `page` and `volume` refer to the specific page/volume being cited
 * (distinct from BibliographyEntry.volume which describes the work).
 */
export interface CitationRequest {
  entry: BibliographyEntry
  /** Specific page(s) being cited, e.g. "45" or "45-48" */
  page?: string
  /** Specific volume being cited, e.g. "2" */
  volume?: string
  /** Whether this is the first citation of this work in the document */
  isFirstCitation: boolean
}
