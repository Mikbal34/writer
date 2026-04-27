/**
 * MLA 9th Edition Citation Formatter
 *
 * Reference: https://style.mla.org/ (MLA Handbook, 9th ed., 2021)
 *
 * Key rules (MLA 9):
 *  - Works Cited list is ALPHABETICAL by first author's surname.
 *  - In-text: (Surname Page) — no comma, no "p.".
 *  - Core elements: Author. "Title of Source." *Title of Container*,
 *    Other contributors, Version, Number, Publisher, Publication date,
 *    Location. Each element followed by a period (end) or comma (within
 *    a container).
 *  - *Italic*: titles of containers (books, journals, websites).
 *  - "Quotes": titles of shorter works (articles, chapters, webpages).
 *  - Author inverted: "Surname, First Middle."
 *  - For unsigned web content, title moves to author slot.
 *  - Access date: optional for most web; recommended for undated content.
 *    We include it when the user provides `accessDate`.
 *  - Edition: "2nd ed.,"
 */

import type { BibliographyEntry } from '@/types/bibliography'
import { CitationFormatter, type InlineCitationStyle } from './base'
import { renderAuthorList, POLICIES, firstNameLast } from './author-list'

export class MLAFormatter extends CitationFormatter {
  get inlineStyle(): InlineCitationStyle {
    return 'author-page'
  }

  formatFootnoteFirst(entry: BibliographyEntry, page?: string): string {
    return this.formatInline(entry, page)
  }

  formatFootnoteSubsequent(entry: BibliographyEntry, page?: string): string {
    return this.formatInline(entry, page)
  }

  formatBibliography(entry: BibliographyEntry): string {
    switch (entry.entryType) {
      case 'kitap':
        return this.wcBook(entry)
      case 'nesir':
        return this.wcEditedBook(entry)
      case 'ceviri':
        return this.wcTranslation(entry)
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

  // ==================== PRIVATE ====================

  private authorInverted(entry: BibliographyEntry): string {
    // MLA 9: 1-2 authors listed; 3+ becomes "First Last, et al."
    // First author is "Last, First" (sortable); subsequent are "First Last".
    let isFirst = true
    return renderAuthorList(entry, POLICIES.MLA, {
      renderOne: (a) => {
        if (isFirst) {
          isFirst = false
          return a.name ? `${a.surname}, ${a.name}` : a.surname
        }
        return firstNameLast(a)
      },
      separator: ', ',
      finalSeparator: ', and ',
      etAl: 'et al.',
    })
  }

  private edition(entry: BibliographyEntry): string {
    if (!entry.edition) return ''
    return `${ordinalSuffix(entry.edition)} ed., `
  }

  // Surname, First. *Title*. 2nd ed., Publisher, Year.
  private wcBook(entry: BibliographyEntry): string {
    const pub = entry.publisher?.trim() || ''
    const year = entry.year?.trim() || ''
    const parts: string[] = []
    if (this.edition(entry)) parts.push(this.edition(entry).trim().replace(/,$/, ''))
    if (pub) parts.push(pub)
    if (year) parts.push(year)
    const tail = parts.length > 0 ? `${parts.join(', ')}.` : ''
    return cleanTrailing(`${this.authorInverted(entry)}. *${entry.title}*. ${tail}`)
  }

  // Surname, First. *Title*. Edited by Editor Name, Publisher, Year.
  private wcEditedBook(entry: BibliographyEntry): string {
    const editor = entry.editor?.trim() || ''
    const pub = entry.publisher?.trim() || ''
    const year = entry.year?.trim() || ''
    const parts: string[] = []
    if (editor) parts.push(`edited by ${editor}`)
    if (this.edition(entry)) parts.push(this.edition(entry).trim().replace(/,$/, ''))
    if (pub) parts.push(pub)
    if (year) parts.push(year)
    const tail = parts.length > 0 ? `${parts.join(', ')}.` : ''
    return cleanTrailing(`${this.authorInverted(entry)}. *${entry.title}*. ${tail}`)
  }

  // Surname, First. *Title*. Translated by Translator, Publisher, Year.
  private wcTranslation(entry: BibliographyEntry): string {
    const translator = entry.translator?.trim() || ''
    const pub = entry.publisher?.trim() || ''
    const year = entry.year?.trim() || ''
    const parts: string[] = []
    if (translator) parts.push(`translated by ${translator}`)
    if (pub) parts.push(pub)
    if (year) parts.push(year)
    const tail = parts.length > 0 ? `${parts.join(', ')}.` : ''
    return cleanTrailing(`${this.authorInverted(entry)}. *${entry.title}*. ${tail}`)
  }

  // Surname, First. "Article Title." *Journal*, vol. N, no. N, Year, pp. X-Y.
  private wcArticle(entry: BibliographyEntry): string {
    const journal = entry.journalName?.trim() || ''
    const vol = entry.journalVolume?.trim() ? `vol. ${entry.journalVolume.trim()}` : ''
    const issue = entry.journalIssue?.trim() ? `no. ${entry.journalIssue.trim()}` : ''
    const year = entry.year?.trim() || ''
    const pages = entry.pageRange?.trim() ? `pp. ${entry.pageRange.trim()}` : ''
    const details = [vol, issue, year, pages].filter(Boolean).join(', ')
    const journalPart = journal ? ` *${journal}*` : ''
    const detailsPart = details ? `,${journalPart ? '' : ''} ${details}.` : (journalPart ? '.' : '')
    return cleanTrailing(`${this.authorInverted(entry)}. "${entry.title}."${journalPart}${detailsPart}`)
  }

  // Surname, First. "Title." Year. University, PhD dissertation.
  private wcDissertation(entry: BibliographyEntry): string {
    const year = entry.year?.trim() || ''
    const uni = entry.publisher?.trim() || entry.publishPlace?.trim() || ''
    const parts: string[] = []
    if (year) parts.push(year)
    if (uni) parts.push(uni)
    parts.push('PhD dissertation')
    return `${this.authorInverted(entry)}. "${entry.title}." ${parts.join('. ')}.`
  }

  // Surname, First. "Entry Title." *Encyclopedia*, edited by X, vol. N, Publisher, Year, pp. X-Y.
  private wcEncyclopedia(entry: BibliographyEntry): string {
    const encyclopedia = entry.journalName?.trim() || entry.publisher?.trim() || ''
    const editor = entry.editor?.trim() || ''
    const vol = entry.journalVolume?.trim() ? `vol. ${entry.journalVolume.trim()}` : ''
    // If encyclopedia came from journalName, publisher holds the real publisher.
    // Otherwise publisher was already consumed by `encyclopedia`.
    const pub = entry.journalName?.trim() ? (entry.publisher?.trim() || '') : ''
    const year = entry.year?.trim() || ''
    const pages = entry.pageRange?.trim() ? `pp. ${entry.pageRange.trim()}` : ''
    const parts: string[] = []
    if (editor) parts.push(`edited by ${editor}`)
    if (vol) parts.push(vol)
    if (pub) parts.push(pub)
    if (year) parts.push(year)
    if (pages) parts.push(pages)
    const head = `${this.authorInverted(entry)}. "${entry.title}."`
    const tail = encyclopedia && parts.length > 0
      ? ` *${encyclopedia}*, ${parts.join(', ')}.`
      : encyclopedia
      ? ` *${encyclopedia}*.`
      : parts.length > 0
      ? ` ${parts.join(', ')}.`
      : ''
    return cleanTrailing(`${head}${tail}`)
  }

  // Surname, First. "Page Title." *Site Name*, Day Mon Year, URL. Accessed Day Mon Year.
  // Note: the period inside `"Title."` is the major-element separator in MLA
  // 9 — don't add another comma before *Site Name*.
  private wcWeb(entry: BibliographyEntry): string {
    const site = entry.publisher?.trim() || entry.journalName?.trim() || ''
    const date = entry.year?.trim() || ''
    const url = entry.url?.replace(/^https?:\/\//, '') || '' // MLA 9 prefers trimmed URL
    const parts: string[] = []
    if (site) parts.push(`*${site}*`)
    if (date) parts.push(date)
    if (url) parts.push(url)
    const tail = parts.length > 0 ? ` ${parts.join(', ')}.` : ''
    const accessed = entry.accessDate ? ` Accessed ${formatAccessDateMLA(entry.accessDate)}.` : ''
    return cleanTrailing(`${this.authorInverted(entry)}. "${entry.title}."${tail}${accessed}`)
  }
}

// ==================== MODULE-LEVEL HELPERS ====================

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

/** Formats ISO `YYYY-MM-DD` as "DD Mon YYYY" (MLA convention). */
function formatAccessDateMLA(raw: string): string {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!iso) return raw
  const months = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.']
  const month = months[parseInt(iso[2], 10) - 1] ?? iso[2]
  const day = parseInt(iso[3], 10)
  return `${day} ${month} ${iso[1]}`
}

function cleanTrailing(text: string): string {
  return text
    .replace(/,\s*\./g, '.')
    .replace(/\.\s*\./g, '.')
    .replace(/,\s*$/g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
