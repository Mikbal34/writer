/**
 * Harvard Citation Formatter (Cite Them Right, 13th ed., 2025)
 *
 * Reference: https://www.citethemrightonline.com/
 *
 * Key rules (Harvard – Cite Them Right):
 *  - References list is ALPHABETICAL by first author's surname.
 *  - In-text: (Surname, Year) or (Surname, Year, p. 45).
 *  - Author format: Surname, I. (single initial per given name, no space
 *    between multiple initials — e.g. "Smith, J.B.").
 *  - Year in round parentheses (no comma).
 *  - *Italic* for book and journal titles; 'single quotes' around article
 *    titles.
 *  - Editions use "edn." (not "ed.").
 *  - Place of publication: "Place: Publisher." (with colon).
 *  - Web: "Available at: URL (Accessed: DD Month YYYY)."
 */

import type { BibliographyEntry } from '@/types/bibliography'
import { CitationFormatter, type InlineCitationStyle } from './base'

export class HarvardFormatter extends CitationFormatter {
  get inlineStyle(): InlineCitationStyle {
    return 'author-date'
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
        return this.refBook(entry)
      case 'nesir':
        return this.refEditedBook(entry)
      case 'ceviri':
        return this.refTranslation(entry)
      case 'makale':
        return this.refArticle(entry)
      case 'tez':
        return this.refDissertation(entry)
      case 'ansiklopedi':
        return this.refEncyclopedia(entry)
      case 'web':
        return this.refWeb(entry)
      default:
        return this.refBook(entry)
    }
  }

  // ==================== PRIVATE ====================

  private authorRef(entry: BibliographyEntry): string {
    // Harvard CTR: "Smith, J.B." — initials with period, no intermediate space
    if (entry.authorName) {
      const initials = entry.authorName
        .split(/\s+/)
        .filter(Boolean)
        .map((n) => `${n.charAt(0).toUpperCase()}.`)
        .join('')
      return `${entry.authorSurname}, ${initials}`
    }
    return entry.authorSurname
  }

  private year(entry: BibliographyEntry): string {
    return entry.year?.trim() || 'no date'
  }

  private edition(entry: BibliographyEntry): string {
    if (!entry.edition) return ''
    return ` ${ordinalSuffix(entry.edition)} edn.`
  }

  private placePublisher(entry: BibliographyEntry): string {
    const place = entry.publishPlace?.trim() || ''
    const pub = entry.publisher?.trim() || ''
    if (place && pub) return `${place}: ${pub}`
    if (pub) return pub
    if (place) return place
    return ''
  }

  // Surname, I. (Year) *Title*. 2nd edn. Place: Publisher.
  private refBook(entry: BibliographyEntry): string {
    const pp = this.placePublisher(entry)
    const ppClause = pp ? ` ${pp}.` : ''
    return `${this.authorRef(entry)} (${this.year(entry)}) *${entry.title}*.${this.edition(entry)}${ppClause}`
  }

  // Surname, I. (ed.) (Year) *Title*. Place: Publisher.
  private refEditedBook(entry: BibliographyEntry): string {
    const pp = this.placePublisher(entry)
    const ppClause = pp ? ` ${pp}.` : ''
    const editorNote = entry.editor ? ` Edited by ${entry.editor}.` : ''
    return `${this.authorRef(entry)} (${this.year(entry)}) *${entry.title}*.${editorNote}${this.edition(entry)}${ppClause}`
  }

  // Surname, I. (Year) *Title*. Translated by T. Translator. Place: Publisher.
  private refTranslation(entry: BibliographyEntry): string {
    const pp = this.placePublisher(entry)
    const ppClause = pp ? ` ${pp}.` : ''
    const transNote = entry.translator ? ` Translated by ${entry.translator}.` : ''
    return `${this.authorRef(entry)} (${this.year(entry)}) *${entry.title}*.${transNote}${this.edition(entry)}${ppClause}`
  }

  // Surname, I. (Year) 'Title', *Journal*, Vol(Issue), pp. X-Y.
  private refArticle(entry: BibliographyEntry): string {
    const journal = entry.journalName?.trim() || ''
    const vol = entry.journalVolume?.trim() || ''
    const issue = entry.journalIssue?.trim() ? `(${entry.journalIssue.trim()})` : ''
    const pages = entry.pageRange?.trim() ? `, pp. ${entry.pageRange.trim()}` : ''
    const doi = entry.doi ? ` doi:${entry.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '')}.` : ''
    const parts = [vol ? `${vol}${issue}` : ''].filter(Boolean).join(', ')
    const journalPart = journal ? `, *${journal}*` : ''
    const tail = parts ? `, ${parts}` : ''
    return `${this.authorRef(entry)} (${this.year(entry)}) '${entry.title}'${journalPart}${tail}${pages}.${doi}`.replace(/\.\s*\.$/, '.')
  }

  // Surname, I. (Year) *Title*. PhD thesis. University.
  private refDissertation(entry: BibliographyEntry): string {
    const uni = entry.publisher?.trim() || entry.publishPlace?.trim() || ''
    const uniClause = uni ? ` ${uni}.` : ''
    return `${this.authorRef(entry)} (${this.year(entry)}) *${entry.title}*. PhD thesis.${uniClause}`
  }

  // Surname, I. (Year) 'Entry', *Encyclopedia*. Edited by X. Place: Publisher, pp. X-Y.
  private refEncyclopedia(entry: BibliographyEntry): string {
    // Legacy fallback: encyclopedia title may have been stored in `publisher`.
    const encyclopedia = entry.journalName?.trim() || entry.publisher?.trim() || ''
    const editorNote = entry.editor ? ` Edited by ${entry.editor}.` : ''
    // Don't double-print publisher when it was consumed as the encyclopedia title.
    const realPub = entry.journalName?.trim() ? entry.publisher?.trim() : ''
    const place = entry.publishPlace?.trim() || ''
    const pp = place && realPub ? `${place}: ${realPub}` : (realPub || place)
    const ppClause = pp ? ` ${pp}` : ''
    const pages = entry.pageRange?.trim() ? `, pp. ${entry.pageRange.trim()}` : ''
    const encyclopediaPart = encyclopedia ? `, *${encyclopedia}*.` : ''
    return `${this.authorRef(entry)} (${this.year(entry)}) '${entry.title}'${encyclopediaPart}${editorNote}${ppClause}${pages}.`
  }

  // Surname, I. (Year) *Title*. Available at: URL (Accessed: DD Month YYYY).
  private refWeb(entry: BibliographyEntry): string {
    const url = entry.url ? ` Available at: ${entry.url}` : ''
    const accessed = entry.accessDate
      ? ` (Accessed: ${formatAccessDateHarvard(entry.accessDate)}).`
      : (url ? '.' : '')
    return `${this.authorRef(entry)} (${this.year(entry)}) *${entry.title}*.${url}${accessed}`.replace(/\.\s*$/, '.')
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

/** "DD Month YYYY" — Harvard access-date convention. */
function formatAccessDateHarvard(raw: string): string {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!iso) return raw
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const month = months[parseInt(iso[2], 10) - 1] ?? iso[2]
  const day = parseInt(iso[3], 10)
  return `${day} ${month} ${iso[1]}`
}
