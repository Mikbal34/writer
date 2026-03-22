/**
 * Harvard (Cite Them Right 13th ed, 2025) Citation Formatter
 *
 * Rules:
 * - In-text: (Surname Year) or (Surname Year, p. X)
 * - Two authors: (Surname and Surname Year)
 * - 3+ authors: (Surname et al. Year)
 * - Bibliography: Surname, Initial. (Year) Title. Edition. Publisher.
 */

import type { BibliographyEntry } from '@/types/bibliography'
import { CitationFormatter } from './formatter'

export class HarvardFormatter extends CitationFormatter {
  formatFootnoteFirst(
    entry: BibliographyEntry,
    _page?: string,
    _volume?: string
  ): string {
    const author = entry.authorName
      ? `${entry.authorSurname}, ${this.initials(entry.authorName)}`
      : entry.authorSurname
    const year = entry.year ?? 'n.d.'

    switch (entry.entryType) {
      case 'makale': {
        const journal = entry.journalName ?? ''
        const vol = entry.journalVolume ?? ''
        const issue = entry.journalIssue ? `(${entry.journalIssue})` : ''
        const pages = entry.pageRange ? `, pp. ${entry.pageRange}` : ''
        return `${author} (${year}) '${entry.title}', ${journal}, ${vol}${issue}${pages}.`
      }
      case 'tez': {
        const uni = entry.publisher ?? entry.publishPlace ?? ''
        return `${author} (${year}) ${entry.title}. PhD thesis. ${uni}.`
      }
      case 'web': {
        const url = entry.url ? ` Available at: ${entry.url}` : ''
        return `${author} (${year}) ${entry.title}.${url}.`
      }
      default: {
        const edition = entry.edition ? ` ${entry.edition} edn.` : ''
        const publisher = entry.publisher ?? ''
        return `${author} (${year}) ${entry.title}.${edition} ${publisher}.`
      }
    }
  }

  formatFootnoteSubsequent(
    entry: BibliographyEntry,
    page?: string,
    _volume?: string
  ): string {
    const year = entry.year ?? 'n.d.'
    const pageStr = page ? `, p. ${page}` : ''
    return `(${entry.authorSurname} ${year}${pageStr})`
  }

  formatBibliography(entry: BibliographyEntry): string {
    const author = entry.authorName
      ? `${entry.authorSurname}, ${this.initials(entry.authorName)}.`
      : `${entry.authorSurname}.`
    const year = entry.year ?? 'n.d.'

    switch (entry.entryType) {
      case 'makale': {
        const journal = entry.journalName ?? ''
        const vol = entry.journalVolume ?? ''
        const issue = entry.journalIssue ? `(${entry.journalIssue})` : ''
        const pages = entry.pageRange ? `, pp. ${entry.pageRange}` : ''
        return `${author} (${year}) '${entry.title}', ${journal}, ${vol}${issue}${pages}.`
      }
      case 'tez': {
        const uni = entry.publisher ?? entry.publishPlace ?? ''
        return `${author} (${year}) ${entry.title}. PhD thesis. ${uni}.`
      }
      case 'web': {
        const url = entry.url ? ` Available at: ${entry.url}` : ''
        return `${author} (${year}) ${entry.title}.${url}.`
      }
      default: {
        const edition = entry.edition ? ` ${entry.edition} edn.` : ''
        const publisher = entry.publisher ?? ''
        return `${author} (${year}) ${entry.title}.${edition} ${publisher}.`
      }
    }
  }

  private initials(name: string): string {
    return name
      .split(/\s+/)
      .map((n) => n.charAt(0).toUpperCase() + '.')
      .join('')
  }
}
