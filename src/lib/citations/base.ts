/**
 * Abstract base class + shared types for every citation formatter.
 * Lives in its own file so subclasses (./apa, ./mla, …) can import
 * from here without creating a circular dependency with the factory
 * in ./formatter.ts.
 */

import type { BibliographyEntry, FootnoteFormat, BibliographyFormat } from '@/types/bibliography'

/**
 * How entries are ordered in the bibliography / references list.
 *  - 'alphabetical': APA, MLA, Chicago, Harvard, Turabian, ISNAD
 *  - 'citation-order': IEEE, Vancouver, AMA — ordered by first appearance
 */
export type BibliographyOrder = 'alphabetical' | 'citation-order'

/**
 * How numbered bibliographies prefix their entries.
 *  - 'bracket' → "[1] Smith, A. …"     (IEEE)
 *  - 'period'  → "1. Smith A. …"        (Vancouver, AMA)
 *  - null      → no numeric prefix      (author-date / footnote formats)
 */
export type BibliographyPrefix = 'bracket' | 'period' | null

/**
 * The in-text citation style the format uses inside prose.
 *  - 'author-date': APA, Harvard              → (Surname, Year, p. 45)
 *  - 'author-page': MLA                       → (Surname 45)
 *  - 'numeric':     IEEE, Vancouver, AMA      → [1] or (1)
 *  - 'footnote':    Chicago, Turabian, ISNAD  → superscript + footnote body
 */
export type InlineCitationStyle = 'author-date' | 'author-page' | 'numeric' | 'footnote'

export abstract class CitationFormatter {
  /** Ordering strategy for the rendered bibliography list. */
  get bibliographyOrder(): BibliographyOrder {
    return 'alphabetical'
  }

  /** Numeric prefix style for the rendered bibliography list. */
  get bibliographyPrefix(): BibliographyPrefix {
    return null
  }

  /** Which inline citation style this format uses inside prose. */
  abstract get inlineStyle(): InlineCitationStyle

  /** First (full) footnote citation. */
  abstract formatFootnoteFirst(
    entry: BibliographyEntry,
    page?: string,
    volume?: string
  ): string

  /** Subsequent (shortened) footnote citation. */
  abstract formatFootnoteSubsequent(
    entry: BibliographyEntry,
    page?: string,
    volume?: string
  ): string

  /**
   * Bibliography / works-cited entry. Output uses `*text*` markdown for
   * italics (book/journal titles) — exporters render these as italic runs.
   */
  abstract formatBibliography(entry: BibliographyEntry): string

  /**
   * Inline (in-text) citation — parenthetical or numeric marker that
   * appears inside the prose. Footnote formats return ''.
   */
  formatInline(
    entry: BibliographyEntry,
    page?: string,
    _volume?: string,
    refNumber?: number
  ): string {
    switch (this.inlineStyle) {
      case 'author-date': {
        const year = entry.year ?? 'n.d.'
        const pageStr = page
          ? `, ${/[-–—]/.test(page) ? 'pp.' : 'p.'} ${page}`
          : ''
        return `(${entry.authorSurname}, ${year}${pageStr})`
      }
      case 'author-page':
        return page ? `(${entry.authorSurname} ${page})` : `(${entry.authorSurname})`
      case 'numeric': {
        const n = refNumber ?? 1
        const pageStr = page ? `, p. ${page}` : ''
        return `[${n}${pageStr}]`
      }
      case 'footnote':
        return ''
    }
  }

  formatFootnote(
    entry: BibliographyEntry,
    _isFirst: boolean,
    page?: string,
    volume?: string
  ): FootnoteFormat {
    return {
      first: this.formatFootnoteFirst(entry, page, volume),
      subsequent: this.formatFootnoteSubsequent(entry, page, volume),
    }
  }

  formatBibliographyEntry(entry: BibliographyEntry): BibliographyFormat {
    const raw = normalizePunctuation(this.formatBibliography(entry))
    const sortKey = this.computeSortKey(entry)
    return { entry: raw, sortKey }
  }

  /**
   * Alphabetical sort key for the entry. Strips leading Arabic/Turkish
   * articles (el-, er-, al-) so "el-Mutenebbî" sorts under M.
   */
  protected computeSortKey(entry: BibliographyEntry): string {
    const base = `${entry.authorSurname} ${entry.authorName ?? ''} ${entry.title}`
    return base
      .replace(/^(el-|er-|al-|El-|Er-|Al-)/i, '')
      .toLowerCase()
      .trim()
  }

  /**
   * Alphabetical sort for author-date / footnote formats. Citation-order
   * formats (IEEE, Vancouver, AMA) bypass this and preserve input order.
   */
  static sortBibliography(entries: BibliographyFormat[]): BibliographyFormat[] {
    return [...entries].sort((a, b) => a.sortKey.localeCompare(b.sortKey, 'tr'))
  }

  /**
   * Orders formatted bibliography entries per the formatter's convention.
   */
  static orderBibliography(
    entries: BibliographyFormat[],
    formatter: CitationFormatter
  ): BibliographyFormat[] {
    return formatter.bibliographyOrder === 'citation-order'
      ? [...entries]
      : CitationFormatter.sortBibliography(entries)
  }

  /**
   *  - 'bracket' → "[1] "
   *  - 'period'  → "1. "
   *  - null      → ""
   */
  static renderPrefix(index: number, prefix: BibliographyPrefix): string {
    if (prefix === 'bracket') return `[${index + 1}] `
    if (prefix === 'period') return `${index + 1}. `
    return ''
  }
}

/**
 * Collapses double periods (`A..` → `A.`), comma-period (`A,.` → `A.`),
 * and double spaces in formatter output. Runs once at the public
 * `formatBibliographyEntry` boundary so individual format methods don't
 * need to reason about their own punctuation invariants.
 */
function normalizePunctuation(s: string): string {
  return s
    .replace(/\.\s*\./g, '.')
    .replace(/,\s*\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim()
}

