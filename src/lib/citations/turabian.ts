/**
 * Turabian 9th Edition (2018) Citation Formatter
 *
 * Notes-Bibliography system (simplified Chicago).
 * - Footnote first: Firstname Lastname, Title (Place: Publisher, Year), Page.
 * - Footnote subsequent: Lastname, Short Title, Page.
 * - Bibliography: Lastname, Firstname. Title. Place: Publisher, Year.
 */

import type { BibliographyEntry } from '@/types/bibliography'
import { CitationFormatter } from './formatter'

export class TurabianFormatter extends CitationFormatter {
  formatFootnoteFirst(
    entry: BibliographyEntry,
    page?: string,
    volume?: string
  ): string {
    const author = this.authorNormalOrder(entry)

    switch (entry.entryType) {
      case 'makale': {
        const journal = entry.journalName ?? ''
        const vol = entry.journalVolume ?? ''
        const issue = entry.journalIssue ? `, no. ${entry.journalIssue}` : ''
        const year = entry.year ? ` (${entry.year})` : ''
        const pageStr = page ? `: ${page}` : ''
        return `${author}, "${entry.title}," ${journal} ${vol}${issue}${year}${pageStr}.`
      }
      case 'tez': {
        const uni = entry.publisher ?? entry.publishPlace ?? ''
        const year = entry.year ?? ''
        const pageStr = page ? `, ${page}` : ''
        return `${author}, "${entry.title}" (PhD diss., ${uni}, ${year})${pageStr}.`
      }
      case 'web': {
        const url = entry.url ?? ''
        const year = entry.year ? `, ${entry.year}` : ''
        return `${author}, "${entry.title}"${year}, ${url}.`
      }
      default: {
        const pubBlock = this.buildPublisherParens(entry)
        const pageStr = this.buildPageVolume(page, volume)
        let extra = ''
        if (entry.entryType === 'ceviri' && entry.translator) {
          extra = `, trans. ${entry.translator}`
        }
        if (entry.entryType === 'nesir' && entry.editor) {
          extra = `, ed. ${entry.editor}`
        }
        const pageClause = pageStr ? `, ${pageStr}` : ''
        return `${author}, ${entry.title}${extra} ${pubBlock}${pageClause}.`
      }
    }
  }

  formatFootnoteSubsequent(
    entry: BibliographyEntry,
    page?: string,
    volume?: string
  ): string {
    const short = entry.shortTitle ?? this.deriveShortTitle(entry.title)
    const pageStr = this.buildPageVolume(page, volume)
    if (entry.entryType === 'makale') {
      return `${entry.authorSurname}, "${short}", ${pageStr}.`
    }
    return `${entry.authorSurname}, ${short}, ${pageStr}.`
  }

  formatBibliography(entry: BibliographyEntry): string {
    const author = this.authorInvertedOrder(entry)
    const year = entry.year ?? 'n.d.'

    switch (entry.entryType) {
      case 'makale': {
        const journal = entry.journalName ?? ''
        const vol = entry.journalVolume ?? ''
        const issue = entry.journalIssue ? `, no. ${entry.journalIssue}` : ''
        const yearStr = ` (${year})`
        const pages = entry.pageRange ? `: ${entry.pageRange}` : ''
        return `${author}. "${entry.title}." ${journal} ${vol}${issue}${yearStr}${pages}.`
      }
      case 'tez': {
        const uni = entry.publisher ?? entry.publishPlace ?? ''
        return `${author}. "${entry.title}." PhD diss., ${uni}, ${year}.`
      }
      case 'web': {
        const url = entry.url ?? ''
        return `${author}. "${entry.title}." ${year}. ${url}.`
      }
      default: {
        const pub = this.buildPublisher(entry)
        let extra = ''
        if (entry.entryType === 'ceviri' && entry.translator) {
          extra = ` Translated by ${entry.translator}.`
        }
        if (entry.entryType === 'nesir' && entry.editor) {
          extra = ` Edited by ${entry.editor}.`
        }
        return `${author}. ${entry.title}.${extra} ${pub}, ${year}.`
      }
    }
  }

  private authorNormalOrder(entry: BibliographyEntry): string {
    if (entry.authorName) {
      return `${entry.authorName} ${entry.authorSurname}`
    }
    return entry.authorSurname
  }

  private authorInvertedOrder(entry: BibliographyEntry): string {
    if (entry.authorName) {
      return `${entry.authorSurname}, ${entry.authorName}`
    }
    return entry.authorSurname
  }

  private deriveShortTitle(title: string): string {
    return title.replace(/^(el-|er-|al-)/i, '').split(/\s+/).slice(0, 4).join(' ')
  }

  private buildPublisher(entry: BibliographyEntry): string {
    if (entry.publishPlace && entry.publisher) {
      return `${entry.publishPlace}: ${entry.publisher}`
    }
    return entry.publisher ?? entry.publishPlace ?? 'n.p.'
  }

  private buildPublisherParens(entry: BibliographyEntry): string {
    const inner = this.buildPublisher(entry)
    const year = entry.year ?? 'n.d.'
    return `(${inner}, ${year})`
  }

  private buildPageVolume(page?: string, volume?: string): string {
    if (volume && page) return `${volume}:${page}`
    if (page) return page
    return ''
  }
}
