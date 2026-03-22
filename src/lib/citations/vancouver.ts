/**
 * Vancouver/ICMJE (NLM Citing Medicine) Citation Formatter
 *
 * Rules:
 * - In-text: superscript numbers by order of first appearance, reuse same number
 * - Authors: Surname Initials (no periods), list up to 6, then "et al."
 * - Journal: Author(s). Title. Journal Abbrev. Year;Vol(Issue):Pages.
 * - Book: Author(s). Title. Edition. Place: Publisher; Year.
 */

import type { BibliographyEntry } from '@/types/bibliography'
import { CitationFormatter } from './formatter'

export class VancouverFormatter extends CitationFormatter {
  formatFootnoteFirst(
    entry: BibliographyEntry,
    page?: string,
    _volume?: string
  ): string {
    const author = this.formatAuthor(entry)

    switch (entry.entryType) {
      case 'makale': {
        const journal = entry.journalName ?? ''
        const year = entry.year ?? ''
        const vol = entry.journalVolume ?? ''
        const issue = entry.journalIssue ? `(${entry.journalIssue})` : ''
        const pages = entry.pageRange ? `:${entry.pageRange}` : ''
        const doi = entry.doi ? `. doi:${entry.doi}` : ''
        return `${author}. ${entry.title}. ${journal}. ${year};${vol}${issue}${pages}${doi}.`
      }
      case 'tez': {
        const place = entry.publishPlace ?? ''
        const uni = entry.publisher ?? ''
        const year = entry.year ?? ''
        return `${author}. ${entry.title} [dissertation]. ${place}: ${uni}; ${year}.`
      }
      case 'web': {
        const year = entry.year ?? ''
        const url = entry.url ? ` Available from: ${entry.url}` : ''
        return `${author}. ${entry.title}. ${year}.${url}`
      }
      default: {
        const edition = entry.edition ? ` ${entry.edition}.` : ''
        const place = entry.publishPlace ?? ''
        const publisher = entry.publisher ?? ''
        const year = entry.year ?? ''
        const pageStr = page ? `. p. ${page}` : ''
        return `${author}. ${entry.title}.${edition} ${place}: ${publisher}; ${year}${pageStr}.`
      }
    }
  }

  formatFootnoteSubsequent(
    entry: BibliographyEntry,
    page?: string,
    _volume?: string
  ): string {
    // Vancouver reuses the same number; the short form is just the number reference
    const author = this.formatAuthor(entry)
    const pageStr = page ? `, p. ${page}` : ''
    return `${author}. ${entry.shortTitle ?? entry.title}${pageStr}.`
  }

  formatBibliography(entry: BibliographyEntry): string {
    // Same as first footnote for Vancouver
    return this.formatFootnoteFirst(entry)
  }

  private formatAuthor(entry: BibliographyEntry): string {
    if (entry.authorName) {
      const initials = entry.authorName
        .split(/\s+/)
        .map((n) => n.charAt(0).toUpperCase())
        .join('')
      return `${entry.authorSurname} ${initials}`
    }
    return entry.authorSurname
  }
}
