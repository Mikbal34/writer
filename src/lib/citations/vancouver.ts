/**
 * Vancouver / ICMJE (NLM Citing Medicine) Citation Formatter
 *
 * Reference: https://www.ncbi.nlm.nih.gov/books/NBK7256/ (NLM: Citing Medicine)
 *
 * Key rules (Vancouver / ICMJE):
 *  - References are NUMBERED in CITATION ORDER. Prefix: "1." (period).
 *  - In-text: superscript numbers or [1], reused for the same source.
 *  - Author format: "Smith AB" — surname + initials, NO periods or comma.
 *  - Up to 6 authors, then "et al.".
 *  - Journal titles use NLM abbreviations and are NOT italicised.
 *  - Article: Smith AB. Article title. J Abbrev. Year;Vol(Issue):Pages.
 *    Optional doi: at the end.
 *  - Book: Smith AB. Book Title. Nth ed. Place: Publisher; Year.
 *  - Web: Smith AB. Title [Internet]. Place: Publisher; Year
 *    [cited YYYY Mon DD]. Available from: URL
 *  - Dissertation: Smith AB. Title [dissertation]. Place: Univ.; Year.
 */

import type { BibliographyEntry } from '@/types/bibliography'
import {
  CitationFormatter,
  type BibliographyOrder,
  type BibliographyPrefix,
  type InlineCitationStyle,
} from './base'
import { renderAuthorList, POLICIES, vancouverLastInitial } from './author-list'

export class VancouverFormatter extends CitationFormatter {
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
    // Vancouver: "Smith AB, Jones CD, Brown EF, et al." (6 max + et al.)
    return renderAuthorList(entry, POLICIES.VANCOUVER, {
      renderOne: vancouverLastInitial,
      separator: ', ',
      finalSeparator: ', ',
      etAl: 'et al.',
    })
  }

  private edition(entry: BibliographyEntry): string {
    if (!entry.edition) return ''
    return ` ${ordinalSuffix(entry.edition)} ed.`
  }

  // Smith AB. Title of Book. 2nd ed. Place: Publisher; Year.
  private refBook(entry: BibliographyEntry): string {
    const place = entry.publishPlace?.trim() || ''
    const pub = entry.publisher?.trim() || ''
    const year = entry.year?.trim() || ''
    const placePub = place && pub ? `${place}: ${pub}` : (pub || place)
    const tail = placePub && year ? `${placePub}; ${year}` : (placePub || year)
    return `${this.author(entry)}. ${entry.title}.${this.edition(entry)} ${tail}.`.replace(/\s+\./g, '.')
  }

  // Smith AB. Title of Book. Translator, translator. Place: Publisher; Year.
  private refTranslation(entry: BibliographyEntry): string {
    const transNote = entry.translator ? ` ${entry.translator}, translator.` : ''
    const place = entry.publishPlace?.trim() || ''
    const pub = entry.publisher?.trim() || ''
    const year = entry.year?.trim() || ''
    const placePub = place && pub ? `${place}: ${pub}` : (pub || place)
    const tail = placePub && year ? `${placePub}; ${year}` : (placePub || year)
    return `${this.author(entry)}. ${entry.title}.${transNote}${this.edition(entry)} ${tail}.`.replace(/\s+\./g, '.')
  }

  // Smith AB. Article title. Journal Abbrev. Year;Vol(Issue):Pages.
  private refArticle(entry: BibliographyEntry): string {
    const journal = entry.journalName?.trim() || ''
    const year = entry.year?.trim() || ''
    const vol = entry.journalVolume?.trim() || ''
    const issue = entry.journalIssue?.trim() ? `(${entry.journalIssue.trim()})` : ''
    const pages = entry.pageRange?.trim() ? `:${entry.pageRange.trim()}` : ''
    const journalPart = journal ? ` ${journal}.` : ''
    const yearPart = year ? ` ${year}` : ''
    const volPart = vol ? `;${vol}${issue}${pages}` : (pages ? `;${pages}` : '')
    const doi = entry.doi ? ` doi:${entry.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '')}` : ''
    return `${this.author(entry)}. ${entry.title}.${journalPart}${yearPart}${volPart}.${doi}`.replace(/\.\.$/, '.')
  }

  // Smith AB. Title [dissertation]. Place: Univ.; Year.
  private refDissertation(entry: BibliographyEntry): string {
    const place = entry.publishPlace?.trim() || ''
    const uni = entry.publisher?.trim() || ''
    const year = entry.year?.trim() || ''
    const placePub = place && uni ? `${place}: ${uni}` : (uni || place)
    const tail = placePub && year ? `${placePub}; ${year}` : (placePub || year)
    return `${this.author(entry)}. ${entry.title} [dissertation]. ${tail}.`
  }

  // Smith AB. Entry title. In: *Encyclopedia*. Vol N. Place: Publisher; Year. p. X-Y.
  private refEncyclopedia(entry: BibliographyEntry): string {
    const encyclopedia = entry.journalName?.trim() || ''
    const vol = entry.journalVolume?.trim() ? ` Vol. ${entry.journalVolume.trim()}.` : ''
    const place = entry.publishPlace?.trim() || ''
    const pub = entry.publisher?.trim() || ''
    const year = entry.year?.trim() || ''
    const pages = entry.pageRange?.trim() ? ` p. ${entry.pageRange.trim()}.` : ''
    const placePub = place && pub ? `${place}: ${pub}` : (pub || place)
    const placeClause = placePub && year ? ` ${placePub}; ${year}.` : (placePub ? ` ${placePub}.` : (year ? ` ${year}.` : ''))
    const inPart = encyclopedia ? ` In: ${encyclopedia}.${vol}` : ''
    return `${this.author(entry)}. ${entry.title}.${inPart}${placeClause}${pages}`.trim()
  }

  // Smith AB. Title [Internet]. Place: Publisher; Year [cited YYYY Mon DD]. Available from: URL
  private refWeb(entry: BibliographyEntry): string {
    const place = entry.publishPlace?.trim() || ''
    const pub = entry.publisher?.trim() || entry.journalName?.trim() || ''
    const year = entry.year?.trim() || ''
    const placePub = place && pub ? `${place}: ${pub}` : (pub || place)
    const tail = placePub && year ? ` ${placePub}; ${year}` : (placePub ? ` ${placePub}` : (year ? ` ${year}` : ''))
    const cited = entry.accessDate ? ` [cited ${formatAccessDateVancouver(entry.accessDate)}]` : ''
    const available = entry.url ? ` Available from: ${entry.url}` : ''
    return `${this.author(entry)}. ${entry.title} [Internet].${tail}${cited}.${available}`.trim()
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

/** "YYYY Mon DD" — Vancouver/NLM abbreviation style. */
function formatAccessDateVancouver(raw: string): string {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!iso) return raw
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const month = months[parseInt(iso[2], 10) - 1] ?? iso[2]
  const day = parseInt(iso[3], 10)
  return `${iso[1]} ${month} ${day}`
}
