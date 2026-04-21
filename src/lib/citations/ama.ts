/**
 * AMA 11th Edition Citation Formatter
 *
 * Reference: https://www.amamanualofstyle.com/ (AMA Manual of Style, 11th ed., 2020)
 *
 * Key rules (AMA 11):
 *  - References are NUMBERED in CITATION ORDER. Prefix: "1." (period).
 *  - In-text: superscript numbers; reused for the same source.
 *  - Author format: "Smith AB" — surname + initials, NO periods.
 *  - Up to 6 authors, then "et al" (no trailing period).
 *  - Journal titles are *italic* AND abbreviated (unlike Vancouver).
 *  - Book titles are *italic*.
 *  - Article: Smith AB. Article title. *J Abbrev*. Year;Vol(Issue):Pages.
 *  - Book: Smith AB. *Book Title*. Nth ed. Publisher; Year.
 *  - Web: Smith AB. Title. Accessed Month DD, YYYY. URL
 *  - Dissertation: Smith AB. *Title* [dissertation]. Publisher; Year.
 */

import type { BibliographyEntry } from '@/types/bibliography'
import {
  CitationFormatter,
  type BibliographyOrder,
  type BibliographyPrefix,
  type InlineCitationStyle,
} from './base'

export class AMAFormatter extends CitationFormatter {
  override get bibliographyOrder(): BibliographyOrder {
    return 'citation-order'
  }

  override get bibliographyPrefix(): BibliographyPrefix {
    return 'period'
  }

  get inlineStyle(): InlineCitationStyle {
    return 'numeric'
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
      case 'nesir':
        return this.refBook(entry)
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

  private author(entry: BibliographyEntry): string {
    if (entry.authorName) {
      const initials = entry.authorName
        .split(/\s+/)
        .filter(Boolean)
        .map((n) => n.charAt(0).toUpperCase())
        .join('')
      return `${entry.authorSurname} ${initials}`
    }
    return entry.authorSurname
  }

  private edition(entry: BibliographyEntry): string {
    if (!entry.edition) return ''
    return ` ${ordinalSuffix(entry.edition)} ed.`
  }

  // Smith AB. *Book Title*. 2nd ed. Publisher; Year.
  private refBook(entry: BibliographyEntry): string {
    const pub = entry.publisher?.trim() || entry.publishPlace?.trim() || ''
    const year = entry.year?.trim() || ''
    const tail = pub && year ? `${pub}; ${year}` : (pub || year)
    return `${this.author(entry)}. *${entry.title}*.${this.edition(entry)} ${tail}.`.replace(/\s+\./g, '.')
  }

  // Smith AB. *Book Title*. Translator, trans. Publisher; Year.
  private refTranslation(entry: BibliographyEntry): string {
    const transNote = entry.translator ? ` ${entry.translator}, trans.` : ''
    const pub = entry.publisher?.trim() || entry.publishPlace?.trim() || ''
    const year = entry.year?.trim() || ''
    const tail = pub && year ? `${pub}; ${year}` : (pub || year)
    return `${this.author(entry)}. *${entry.title}*.${transNote}${this.edition(entry)} ${tail}.`.replace(/\s+\./g, '.')
  }

  // Smith AB. Article title. *J Abbrev*. Year;Vol(Issue):Pages. doi:10.xxx
  private refArticle(entry: BibliographyEntry): string {
    const journal = entry.journalName?.trim() || ''
    const year = entry.year?.trim() || ''
    const vol = entry.journalVolume?.trim() || ''
    const issue = entry.journalIssue?.trim() ? `(${entry.journalIssue.trim()})` : ''
    const pages = entry.pageRange?.trim() ? `:${entry.pageRange.trim()}` : ''
    const journalPart = journal ? ` *${journal}*.` : ''
    const yearPart = year ? ` ${year}` : ''
    const volPart = vol ? `;${vol}${issue}${pages}` : (pages ? `;${pages}` : '')
    const doi = entry.doi ? ` doi:${entry.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '')}` : ''
    return `${this.author(entry)}. ${entry.title}.${journalPart}${yearPart}${volPart}.${doi}`.replace(/\.\.$/, '.')
  }

  // Smith AB. *Title* [dissertation]. Publisher; Year.
  private refDissertation(entry: BibliographyEntry): string {
    const pub = entry.publisher?.trim() || entry.publishPlace?.trim() || ''
    const year = entry.year?.trim() || ''
    const tail = pub && year ? `${pub}; ${year}` : (pub || year)
    return `${this.author(entry)}. *${entry.title}* [dissertation]. ${tail}.`
  }

  // Smith AB. Entry title. In: *Encyclopedia*. Publisher; Year:X-Y.
  private refEncyclopedia(entry: BibliographyEntry): string {
    const encyclopedia = entry.journalName?.trim() || ''
    const pub = entry.publisher?.trim() || ''
    const year = entry.year?.trim() || ''
    const pages = entry.pageRange?.trim() ? `:${entry.pageRange.trim()}` : ''
    const tail = pub && year ? `${pub}; ${year}` : (pub || year)
    const tailClause = tail ? ` ${tail}${pages}.` : (pages ? `${pages}.` : '')
    const inPart = encyclopedia ? ` In: *${encyclopedia}*.` : ''
    return `${this.author(entry)}. ${entry.title}.${inPart}${tailClause}`.trim()
  }

  // Smith AB. Title. Accessed Month DD, YYYY. URL
  private refWeb(entry: BibliographyEntry): string {
    const site = entry.publisher?.trim() || entry.journalName?.trim() || ''
    const sitePart = site ? ` *${site}*.` : ''
    const published = entry.year ? ` Published ${entry.year}.` : ''
    const accessed = entry.accessDate
      ? ` Accessed ${formatAccessDateAMA(entry.accessDate)}.`
      : ''
    const url = entry.url ? ` ${entry.url}` : ''
    return `${this.author(entry)}. ${entry.title}.${sitePart}${published}${accessed}${url}`.trim()
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

/** "Month DD, YYYY" — AMA access-date convention. */
function formatAccessDateAMA(raw: string): string {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!iso) return raw
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const month = months[parseInt(iso[2], 10) - 1] ?? iso[2]
  const day = parseInt(iso[3], 10)
  return `${month} ${day}, ${iso[1]}`
}
