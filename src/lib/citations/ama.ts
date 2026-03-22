/**
 * AMA 11th Edition (2020) Citation Formatter
 *
 * Rules:
 * - In-text: superscript numbers, numbered by first appearance, reuse same number
 * - Authors: Surname Initials (no periods), list up to 6, then "et al"
 * - Journal: Author(s). Title. Journal Abbrev. Year;Vol(Issue):Pages. doi:
 * - Book: Author(s). Title. Edition. Publisher; Year.
 */

import type { BibliographyEntry } from '@/types/bibliography'
import { CitationFormatter } from './formatter'

export class AMAFormatter extends CitationFormatter {
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
        const doi = entry.doi ? ` doi:${entry.doi}` : ''
        return `${author}. ${entry.title}. ${journal}. ${year};${vol}${issue}${pages}.${doi}`
      }
      case 'tez': {
        const uni = entry.publisher ?? entry.publishPlace ?? ''
        const year = entry.year ?? ''
        return `${author}. ${entry.title}. Dissertation. ${uni}; ${year}.`
      }
      case 'web': {
        const year = entry.year ?? ''
        const url = entry.url ? ` Accessed ${year}. ${entry.url}` : ''
        return `${author}. ${entry.title}.${url}`
      }
      default: {
        const edition = entry.edition ? ` ${entry.edition}.` : ''
        const publisher = entry.publisher ?? ''
        const year = entry.year ?? ''
        const pageStr = page ? `:${page}` : ''
        return `${author}. ${entry.title}.${edition} ${publisher}; ${year}${pageStr}.`
      }
    }
  }

  formatFootnoteSubsequent(
    entry: BibliographyEntry,
    page?: string,
    _volume?: string
  ): string {
    // AMA reuses the same reference number
    const author = this.formatAuthor(entry)
    const short = entry.shortTitle ?? entry.title
    const pageStr = page ? `:${page}` : ''
    return `${author}. ${short}${pageStr}.`
  }

  formatBibliography(entry: BibliographyEntry): string {
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
