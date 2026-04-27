import type { EntryType, CitationFormat } from '@prisma/client'

// ==================== CORE ENTRY TYPE ====================

export interface BibliographyEntry {
  id: string
  projectId: string
  sourceId: string | null
  entryType: EntryType
  /** First author's surname / family name */
  authorSurname: string
  /** First author's given name(s) */
  authorName: string | null
  /**
   * Co-authors of the work, in order. The first author lives on
   * `authorSurname` + `authorName`; this array holds the 2nd…Nth so
   * each format can apply its own "et al." truncation rule:
   *   APA 7        → list up to 20 authors, then "...", then last
   *   MLA 9        → 1-2 authors, 3+ becomes first + "et al."
   *   Chicago notes→ 1-3 listed, 4+ becomes first + "et al."
   *   Chicago bib  → 1-10 listed, 11+ truncated to 7 + "et al."
   *   Harvard      → 1-2 listed, 3+ becomes first + "et al."
   *   IEEE         → up to 6 authors, then "et al."
   *   Vancouver    → up to 6 authors, then "et al."
   *   AMA          → up to 6 authors, then "et al"
   *   ISNAD        → ilk yazar + "vd." (3+)
   */
  coAuthors?: Array<{ surname: string; name: string | null }> | null
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
  /** Access date for web sources (ISO "YYYY-MM-DD" or free text) */
  accessDate: string | null
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
