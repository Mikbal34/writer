/**
 * Chicago 17th Edition (Notes-Bibliography) Citation Formatter
 *
 * Rules:
 * - Full footnote on first citation: Firstname Lastname, Title (Place: Publisher, Year), Page.
 * - Short footnote on subsequent citations: Lastname, Short Title, Page.
 * - Bibliography: Lastname, Firstname. Title. Place: Publisher, Year.
 */

import type { BibliographyEntry } from '@/types/bibliography'
import { CitationFormatter } from './formatter'

export class ChicagoFormatter extends CitationFormatter {
  // ==================== FOOTNOTE FIRST ====================

  formatFootnoteFirst(
    entry: BibliographyEntry,
    page?: string,
    volume?: string
  ): string {
    switch (entry.entryType) {
      case 'kitap':
      case 'nesir':
      case 'ceviri':
        return this.footnoteBookFirst(entry, page, volume)
      case 'makale':
        return this.footnoteArticleFirst(entry, page)
      case 'tez':
        return this.footnoteDissertationFirst(entry, page)
      case 'ansiklopedi':
        return this.footnoteEncyclopediaFirst(entry, page)
      case 'web':
        return this.footnoteWebFirst(entry)
      default:
        return this.footnoteBookFirst(entry, page, volume)
    }
  }

  // ==================== FOOTNOTE SUBSEQUENT ====================

  formatFootnoteSubsequent(
    entry: BibliographyEntry,
    page?: string,
    volume?: string
  ): string {
    const short = entry.shortTitle ?? this.deriveShortTitle(entry.title)
    const pageStr = buildPageVolume(page, volume)
    if (entry.entryType === 'makale') {
      return `${entry.authorSurname}, "${short}", ${pageStr}.`
    }
    return `${entry.authorSurname}, ${short}, ${pageStr}.`
  }

  // ==================== BIBLIOGRAPHY ====================

  formatBibliography(entry: BibliographyEntry): string {
    switch (entry.entryType) {
      case 'kitap':
      case 'nesir':
      case 'ceviri':
        return this.bibBook(entry)
      case 'makale':
        return this.bibArticle(entry)
      case 'tez':
        return this.bibDissertation(entry)
      case 'ansiklopedi':
        return this.bibEncyclopedia(entry)
      case 'web':
        return this.bibWeb(entry)
      default:
        return this.bibBook(entry)
    }
  }

  // ==================== PRIVATE: FOOTNOTE FIRST VARIANTS ====================

  private footnoteBookFirst(
    entry: BibliographyEntry,
    page?: string,
    volume?: string
  ): string {
    // Chicago footnote: Firstname Lastname, Title (Place: Publisher, Year), vol:page.
    const author = this.authorNormalOrder(entry)
    const pubBlock = buildPublisherParens(entry)
    const pageStr = buildPageVolume(page, volume)

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

  private footnoteArticleFirst(entry: BibliographyEntry, page?: string): string {
    const author = this.authorNormalOrder(entry)
    const journal = entry.journalName ?? ''
    const vol = entry.journalVolume ?? ''
    const issue = entry.journalIssue ? `, no. ${entry.journalIssue}` : ''
    const year = entry.year ? ` (${entry.year})` : ''
    const pageStr = page ? `: ${page}` : ''
    return `${author}, "${entry.title}", ${journal} ${vol}${issue}${year}${pageStr}.`
  }

  private footnoteDissertationFirst(entry: BibliographyEntry, page?: string): string {
    const author = this.authorNormalOrder(entry)
    const pub = entry.publisher ?? entry.publishPlace ?? ''
    const year = entry.year ?? ''
    const pageStr = page ? `, ${page}` : ''
    return `${author}, "${entry.title}" (PhD diss., ${pub}, ${year})${pageStr}.`
  }

  private footnoteEncyclopediaFirst(entry: BibliographyEntry, page?: string): string {
    const author = this.authorNormalOrder(entry)
    const journal = entry.journalName ?? ''
    const vol = entry.journalVolume ? ` ${entry.journalVolume}` : ''
    const year = entry.year ? ` (${entry.year})` : ''
    const pageStr = page ? `: ${page}` : ''
    return `${author}, "${entry.title}", ${journal}${vol}${year}${pageStr}.`
  }

  private footnoteWebFirst(entry: BibliographyEntry): string {
    const author = this.authorNormalOrder(entry)
    const url = entry.url ?? ''
    const year = entry.year ? `, ${entry.year}` : ''
    return `${author}, "${entry.title}"${year}, ${url}.`
  }

  // ==================== PRIVATE: BIBLIOGRAPHY VARIANTS ====================

  private bibBook(entry: BibliographyEntry): string {
    // Chicago bibliography: Lastname, Firstname. Title. Place: Publisher, Year.
    const author = this.authorInvertedOrder(entry)
    const pub = buildPublisher(entry)
    const year = entry.year ?? 'n.d.'
    let extra = ''
    if (entry.entryType === 'ceviri' && entry.translator) {
      extra = ` Translated by ${entry.translator}.`
    }
    if (entry.entryType === 'nesir' && entry.editor) {
      extra = ` Edited by ${entry.editor}.`
    }
    const edition = entry.edition ? ` ${entry.edition} ed.` : ''
    return `${author}. ${entry.title}.${extra}${edition} ${pub}, ${year}.`
  }

  private bibArticle(entry: BibliographyEntry): string {
    const author = this.authorInvertedOrder(entry)
    const journal = entry.journalName ?? ''
    const vol = entry.journalVolume ?? ''
    const issue = entry.journalIssue ? `, no. ${entry.journalIssue}` : ''
    const year = entry.year ? ` (${entry.year})` : ''
    const pages = entry.pageRange ? `: ${entry.pageRange}` : ''
    return `${author}. "${entry.title}." ${journal} ${vol}${issue}${year}${pages}.`
  }

  private bibDissertation(entry: BibliographyEntry): string {
    const author = this.authorInvertedOrder(entry)
    const pub = entry.publisher ?? entry.publishPlace ?? ''
    const year = entry.year ?? 'n.d.'
    return `${author}. "${entry.title}." PhD diss., ${pub}, ${year}.`
  }

  private bibEncyclopedia(entry: BibliographyEntry): string {
    const author = this.authorInvertedOrder(entry)
    const journal = entry.journalName ?? ''
    const vol = entry.journalVolume ? ` ${entry.journalVolume}` : ''
    const year = entry.year ? ` (${entry.year})` : ''
    const pages = entry.pageRange ? `: ${entry.pageRange}` : ''
    return `${author}. "${entry.title}." ${journal}${vol}${year}${pages}.`
  }

  private bibWeb(entry: BibliographyEntry): string {
    const author = this.authorInvertedOrder(entry)
    const url = entry.url ?? ''
    const year = entry.year ? ` ${entry.year}.` : ''
    return `${author}. "${entry.title}."${year} ${url}.`
  }

  // ==================== PRIVATE: UTILITIES ====================

  /** "Firstname Lastname" — used in footnotes */
  private authorNormalOrder(entry: BibliographyEntry): string {
    if (entry.authorName) {
      return `${entry.authorName} ${entry.authorSurname}`
    }
    return entry.authorSurname
  }

  /** "Lastname, Firstname" — used in bibliography */
  private authorInvertedOrder(entry: BibliographyEntry): string {
    if (entry.authorName) {
      return `${entry.authorSurname}, ${entry.authorName}`
    }
    return entry.authorSurname
  }

  private deriveShortTitle(title: string): string {
    const words = title.replace(/^(el-|er-|al-)/i, '').split(/\s+/).slice(0, 4)
    return words.join(' ')
  }
}

// ==================== MODULE-LEVEL HELPERS ====================

function buildPublisher(entry: BibliographyEntry): string {
  if (entry.publishPlace && entry.publisher) {
    return `${entry.publishPlace}: ${entry.publisher}`
  }
  if (entry.publisher) return entry.publisher
  if (entry.publishPlace) return entry.publishPlace
  return 'n.p.'
}

function buildPublisherParens(entry: BibliographyEntry): string {
  const inner = buildPublisher(entry)
  const year = entry.year ?? 'n.d.'
  return `(${inner}, ${year})`
}

function buildPageVolume(page?: string, volume?: string): string {
  if (volume && page) return `${volume}:${page}`
  if (page) return page
  return ''
}
