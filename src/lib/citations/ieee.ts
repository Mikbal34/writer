/**
 * IEEE (Editorial Style Manual) Citation Formatter
 *
 * Rules:
 * - In-text: [1], [2], [3] — numbered by first appearance, reuse same number
 * - Authors: Initial(s). Surname — e.g., "A. B. Smith"
 * - Journal: [1] A. B. Smith, "Article title," Journal Abbrev., vol. X, no. Y, pp. Z-W, Year.
 * - Book: [1] A. B. Smith, Book Title, Edition. City: Publisher, Year.
 */

import type { BibliographyEntry } from '@/types/bibliography'
import { CitationFormatter } from './formatter'

export class IEEEFormatter extends CitationFormatter {
  formatFootnoteFirst(
    entry: BibliographyEntry,
    page?: string,
    _volume?: string
  ): string {
    const author = this.formatAuthor(entry)

    switch (entry.entryType) {
      case 'makale': {
        const journal = entry.journalName ?? ''
        const vol = entry.journalVolume ? `, vol. ${entry.journalVolume}` : ''
        const issue = entry.journalIssue ? `, no. ${entry.journalIssue}` : ''
        const pages = entry.pageRange ? `, pp. ${entry.pageRange}` : ''
        const year = entry.year ? `, ${entry.year}` : ''
        return `${author}, "${entry.title}," ${journal}${vol}${issue}${pages}${year}.`
      }
      case 'tez': {
        const uni = entry.publisher ?? entry.publishPlace ?? ''
        const year = entry.year ?? ''
        return `${author}, "${entry.title}," Ph.D. dissertation, ${uni}, ${year}.`
      }
      case 'web': {
        const url = entry.url ?? ''
        const year = entry.year ? ` (${entry.year})` : ''
        return `${author}, "${entry.title},"${year}. [Online]. Available: ${url}`
      }
      default: {
        const edition = entry.edition ? `, ${entry.edition}` : ''
        const place = entry.publishPlace ?? ''
        const publisher = entry.publisher ?? ''
        const year = entry.year ?? ''
        const pageStr = page ? `, p. ${page}` : ''
        return `${author}, ${entry.title}${edition}. ${place}: ${publisher}, ${year}${pageStr}.`
      }
    }
  }

  formatFootnoteSubsequent(
    entry: BibliographyEntry,
    page?: string,
    _volume?: string
  ): string {
    // IEEE reuses the same reference number; short form not typical but provided for compatibility
    const author = this.formatAuthor(entry)
    const short = entry.shortTitle ?? entry.title
    const pageStr = page ? `, p. ${page}` : ''
    return `${author}, ${short}${pageStr}.`
  }

  formatBibliography(entry: BibliographyEntry): string {
    return this.formatFootnoteFirst(entry)
  }

  private formatAuthor(entry: BibliographyEntry): string {
    if (entry.authorName) {
      const initials = entry.authorName
        .split(/\s+/)
        .map((n) => `${n.charAt(0).toUpperCase()}.`)
        .join(' ')
      return `${initials} ${entry.authorSurname}`
    }
    return entry.authorSurname
  }
}
