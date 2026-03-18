/**
 * APA 7th Edition Citation Formatter
 *
 * In-text: (Author, Year, p. X)  — but this formatter handles footnote-style output
 * for compatibility with the rest of the system.
 * Reference list entries follow APA 7 rules.
 */

import type { BibliographyEntry } from '@/types/bibliography'
import { CitationFormatter } from './formatter'

export class APAFormatter extends CitationFormatter {
  // ==================== FOOTNOTE FIRST ====================
  // APA does not use footnotes for citations; we produce an in-text style string.

  formatFootnoteFirst(
    entry: BibliographyEntry,
    page?: string,
    _volume?: string
  ): string {
    const author = this.authorInText(entry)
    const year = entry.year ?? 'n.d.'
    const pageStr = page ? `, ${pagePrefix(page)} ${page}` : ''
    return `(${author}, ${year}${pageStr})`
  }

  // ==================== FOOTNOTE SUBSEQUENT ====================
  // Identical to first in APA — no short-title convention.

  formatFootnoteSubsequent(
    entry: BibliographyEntry,
    page?: string,
    _volume?: string
  ): string {
    return this.formatFootnoteFirst(entry, page)
  }

  // ==================== BIBLIOGRAPHY (REFERENCES) ====================

  formatBibliography(entry: BibliographyEntry): string {
    switch (entry.entryType) {
      case 'kitap':
      case 'nesir':
      case 'ceviri':
        return this.referenceBook(entry)
      case 'makale':
        return this.referenceArticle(entry)
      case 'tez':
        return this.referenceDissertation(entry)
      case 'ansiklopedi':
        return this.referenceEncyclopedia(entry)
      case 'web':
        return this.referenceWeb(entry)
      default:
        return this.referenceBook(entry)
    }
  }

  // ==================== PRIVATE ====================

  private authorInText(entry: BibliographyEntry): string {
    return entry.authorSurname
  }

  private authorReference(entry: BibliographyEntry): string {
    // APA: Surname, I. (initials for given name)
    if (entry.authorName) {
      const initials = entry.authorName
        .split(/\s+/)
        .map((n) => n[0]?.toUpperCase() + '.')
        .join(' ')
      return `${entry.authorSurname}, ${initials}`
    }
    return entry.authorSurname
  }

  private referenceBook(entry: BibliographyEntry): string {
    const author = this.authorReference(entry)
    const year = entry.year ?? 'n.d.'
    const title = entry.title // italicised in rich text; plain text here
    const edition = entry.edition ? ` (${ordinalSuffix(entry.edition)} ed.)` : ''
    const pub = entry.publisher ?? ''
    let translatorNote = ''
    if (entry.entryType === 'ceviri' && entry.translator) {
      translatorNote = ` (${entry.translator}, Trans.)`
    }
    let editorNote = ''
    if (entry.entryType === 'nesir' && entry.editor) {
      editorNote = ` (${entry.editor}, Ed.)`
    }
    return `${author} (${year}). ${title}${translatorNote}${editorNote}${edition}. ${pub}.`
  }

  private referenceArticle(entry: BibliographyEntry): string {
    const author = this.authorReference(entry)
    const year = entry.year ?? 'n.d.'
    const articleTitle = entry.title
    const journal = entry.journalName ?? ''
    const vol = entry.journalVolume ? `${entry.journalVolume}` : ''
    const issue = entry.journalIssue ? `(${entry.journalIssue})` : ''
    const pages = entry.pageRange ?? ''
    const doi = entry.doi ? ` https://doi.org/${entry.doi}` : ''
    // If DOI present, omit period after pages
    if (doi) {
      return `${author} (${year}). ${articleTitle}. ${journal}, ${vol}${issue}, ${pages}${doi}`
    }
    return `${author} (${year}). ${articleTitle}. ${journal}, ${vol}${issue}, ${pages}.`
  }

  private referenceDissertation(entry: BibliographyEntry): string {
    const author = this.authorReference(entry)
    const year = entry.year ?? 'n.d.'
    const title = entry.title
    const pub = entry.publisher ?? entry.publishPlace ?? ''
    return `${author} (${year}). ${title} [Doctoral dissertation, ${pub}].`
  }

  private referenceEncyclopedia(entry: BibliographyEntry): string {
    const author = this.authorReference(entry)
    const year = entry.year ?? 'n.d.'
    const articleTitle = entry.title
    const encyclopedia = entry.journalName ?? ''
    const vol = entry.journalVolume ? ` (Vol. ${entry.journalVolume})` : ''
    const pages = entry.pageRange ? `, pp. ${entry.pageRange}` : ''
    const pub = entry.publisher ?? ''
    return `${author} (${year}). ${articleTitle}. In ${encyclopedia}${vol}${pages}. ${pub}.`
  }

  private referenceWeb(entry: BibliographyEntry): string {
    const author = this.authorReference(entry)
    const year = entry.year ?? 'n.d.'
    const title = entry.title
    const url = entry.url ?? ''
    return `${author} (${year}). ${title}. ${url}`
  }
}

// ==================== MODULE-LEVEL HELPERS ====================

/** Returns correct ordinal suffix: 1st, 2nd, 3rd, 4th, etc. */
function ordinalSuffix(n: string): string {
  const num = parseInt(n, 10)
  if (isNaN(num)) return n
  const mod100 = num % 100
  if (mod100 >= 11 && mod100 <= 13) return `${num}th`
  switch (num % 10) {
    case 1: return `${num}st`
    case 2: return `${num}nd`
    case 3: return `${num}rd`
    default: return `${num}th`
  }
}

/** Returns "p." for single pages, "pp." for page ranges */
function pagePrefix(page: string): string {
  return /[-–—]/.test(page) ? 'pp.' : 'p.'
}
