/**
 * MLA 9th Edition Citation Formatter
 *
 * In-text: (Surname Page) — no comma, no "p."
 * Works Cited entries follow MLA 9 core elements.
 */

import type { BibliographyEntry } from '@/types/bibliography'
import { CitationFormatter } from './formatter'

export class MLAFormatter extends CitationFormatter {
  // ==================== IN-TEXT (FOOTNOTE FIRST) ====================
  // MLA in-text: (Surname Page)

  formatFootnoteFirst(
    entry: BibliographyEntry,
    page?: string,
    _volume?: string
  ): string {
    const pageStr = page ? ` ${page}` : ''
    return `(${entry.authorSurname}${pageStr})`
  }

  // ==================== IN-TEXT (FOOTNOTE SUBSEQUENT) ====================
  // Identical to first in MLA.

  formatFootnoteSubsequent(
    entry: BibliographyEntry,
    page?: string,
    _volume?: string
  ): string {
    return this.formatFootnoteFirst(entry, page)
  }

  // ==================== WORKS CITED ====================

  formatBibliography(entry: BibliographyEntry): string {
    switch (entry.entryType) {
      case 'kitap':
        return this.wcBook(entry)
      case 'nesir':
        return this.wcNesir(entry)
      case 'ceviri':
        return this.wcCeviri(entry)
      case 'makale':
        return this.wcArticle(entry)
      case 'tez':
        return this.wcDissertation(entry)
      case 'ansiklopedi':
        return this.wcEncyclopedia(entry)
      case 'web':
        return this.wcWeb(entry)
      default:
        return this.wcBook(entry)
    }
  }

  // ==================== PRIVATE: WORKS CITED VARIANTS ====================

  // Soyadı, Adı. Başlık. Yayınevi, Yıl.
  private wcBook(entry: BibliographyEntry): string {
    const author = authorInverted(entry)
    const pub = entry.publisher ?? ''
    const year = entry.year ?? ''
    const parts: string[] = [`${author}. ${entry.title}.`]
    if (pub) parts.push(`${pub},`)
    if (year) parts.push(`${year}.`)
    return cleanTrailing(parts.join(' '))
  }

  // Soyadı, Adı. Başlık. Edited by Adı Soyadı, Yayınevi, Yıl.
  private wcNesir(entry: BibliographyEntry): string {
    const author = authorInverted(entry)
    const editor = entry.editor ?? entry.translator ?? ''
    const pub = entry.publisher ?? ''
    const year = entry.year ?? ''
    const parts: string[] = [`${author}. ${entry.title}.`]
    if (editor) parts.push(`Edited by ${editor},`)
    if (pub) parts.push(`${pub},`)
    if (year) parts.push(`${year}.`)
    return cleanTrailing(parts.join(' '))
  }

  // Soyadı, Adı. Başlık. Translated by Adı Soyadı, Yayınevi, Yıl.
  private wcCeviri(entry: BibliographyEntry): string {
    const author = authorInverted(entry)
    const translator = entry.translator ?? ''
    const pub = entry.publisher ?? ''
    const year = entry.year ?? ''
    const parts: string[] = [`${author}. ${entry.title}.`]
    if (translator) parts.push(`Translated by ${translator},`)
    if (pub) parts.push(`${pub},`)
    if (year) parts.push(`${year}.`)
    return cleanTrailing(parts.join(' '))
  }

  // Soyadı, Adı. "Başlık." Dergi, vol. #, no. #, Yıl, pp. #-#.
  private wcArticle(entry: BibliographyEntry): string {
    const author = authorInverted(entry)
    const journal = entry.journalName ?? ''
    const vol = entry.journalVolume ? `vol. ${entry.journalVolume}` : ''
    const issue = entry.journalIssue ? `no. ${entry.journalIssue}` : ''
    const year = entry.year ?? ''
    const pages = entry.pageRange ? `pp. ${entry.pageRange}` : ''

    const details = [vol, issue, year, pages].filter(Boolean).join(', ')
    return `${author}. "${entry.title}." ${journal}, ${details}.`
  }

  // Soyadı, Adı. "Başlık." Yıl. Üniversite, Tez türü.
  private wcDissertation(entry: BibliographyEntry): string {
    const author = authorInverted(entry)
    const year = entry.year ?? ''
    const uni = entry.publisher ?? entry.publishPlace ?? ''
    return `${author}. "${entry.title}." ${year}. ${uni}, Doctoral dissertation.`
  }

  // Soyadı, Adı. "Madde." Ansiklopedi Adı, Yayınevi, Yıl.
  private wcEncyclopedia(entry: BibliographyEntry): string {
    const author = authorInverted(entry)
    const encyclopedia = entry.journalName ?? ''
    const pub = entry.publisher ?? ''
    const year = entry.year ?? ''
    const parts: string[] = [`${author}. "${entry.title}." ${encyclopedia},`]
    if (pub) parts.push(`${pub},`)
    if (year) parts.push(`${year}.`)
    return cleanTrailing(parts.join(' '))
  }

  // Soyadı, Adı. "Başlık." Site Adı, Yıl, URL.
  private wcWeb(entry: BibliographyEntry): string {
    const author = authorInverted(entry)
    const siteName = entry.journalName ?? ''
    const year = entry.year ?? ''
    const url = entry.url ?? ''
    const parts: string[] = [`${author}. "${entry.title}."`]
    if (siteName) parts.push(`${siteName},`)
    if (year) parts.push(`${year},`)
    if (url) parts.push(url)
    // No period after URL in MLA
    return cleanTrailing(parts.join(' '))
  }
}

// ==================== MODULE-LEVEL HELPERS ====================

function authorInverted(entry: BibliographyEntry): string {
  if (entry.authorName) {
    return `${entry.authorSurname}, ${entry.authorName}`
  }
  return entry.authorSurname
}

function cleanTrailing(text: string): string {
  return text
    .replace(/,\s*\./g, '.')
    .replace(/\.\s*\./g, '.')
    .replace(/,\s*$/g, '.')
    .trim()
}
