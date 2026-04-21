/**
 * IEEE Citation Formatter
 *
 * Reference: https://ieeeauthorcenter.ieee.org/wp-content/uploads/IEEE-Reference-Guide.pdf
 *
 * Key rules (IEEE Editorial Style Manual):
 *  - References are NUMBERED and appear in CITATION ORDER (not alphabetical).
 *    The `[1]` bracket prefix is rendered at export time.
 *  - In-text: [1], [2], [3]; re-use the same number for the same source.
 *  - Author format: "A. B. Smith" (initials with period and space, surname last).
 *  - Article: A. B. Smith, "Article title," *Journal Abbrev.*, vol. X,
 *    no. Y, pp. Z-W, Month Year.
 *  - Book: A. B. Smith, *Book Title*, Nth ed. City: Publisher, Year.
 *  - Web: A. B. Smith, "Title," Site Name, Year. Accessed: Mon. DD, YYYY.
 *    [Online]. Available: URL
 *  - Dissertation: A. B. Smith, "Title," Ph.D. dissertation, Dept., Univ., City, Year.
 *  - Journal names are *italic* + abbreviated (we accept what the user
 *    provides; IEEE abbreviation dictionary is out of scope).
 */

import type { BibliographyEntry } from '@/types/bibliography'
import {
  CitationFormatter,
  type BibliographyOrder,
  type BibliographyPrefix,
  type InlineCitationStyle,
} from './base'

export class IEEEFormatter extends CitationFormatter {
  override get bibliographyOrder(): BibliographyOrder {
    return 'citation-order'
  }

  override get bibliographyPrefix(): BibliographyPrefix {
    return 'bracket'
  }

  get inlineStyle(): InlineCitationStyle {
    return 'numeric'
  }

  formatFootnoteFirst(entry: BibliographyEntry, page?: string, _volume?: string): string {
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
    // IEEE: "A. B. Smith"
    if (entry.authorName) {
      const initials = entry.authorName
        .split(/\s+/)
        .filter(Boolean)
        .map((n) => `${n.charAt(0).toUpperCase()}.`)
        .join(' ')
      return `${initials} ${entry.authorSurname}`
    }
    return entry.authorSurname
  }

  private edition(entry: BibliographyEntry): string {
    if (!entry.edition) return ''
    return `, ${ordinalSuffix(entry.edition)} ed.`
  }

  // A. B. Smith, *Book Title*, Nth ed. City: Publisher, Year.
  private refBook(entry: BibliographyEntry): string {
    const place = entry.publishPlace?.trim() || ''
    const pub = entry.publisher?.trim() || ''
    const year = entry.year?.trim() || ''
    const placePub = place && pub ? `${place}: ${pub}` : (pub || place)
    const tail = [placePub, year].filter(Boolean).join(', ')
    return `${this.author(entry)}, *${entry.title}*${this.edition(entry)}. ${tail}.`.replace(/\s+\./g, '.')
  }

  // A. B. Smith, *Book Title*, T. Translator, Trans. City: Publisher, Year.
  private refTranslation(entry: BibliographyEntry): string {
    const transNote = entry.translator ? `, ${entry.translator}, Trans.` : ''
    const place = entry.publishPlace?.trim() || ''
    const pub = entry.publisher?.trim() || ''
    const year = entry.year?.trim() || ''
    const placePub = place && pub ? `${place}: ${pub}` : (pub || place)
    const tail = [placePub, year].filter(Boolean).join(', ')
    return `${this.author(entry)}, *${entry.title}*${transNote}${this.edition(entry)}. ${tail}.`.replace(/\s+\./g, '.')
  }

  // A. B. Smith, "Article title," *Journal Abbrev.*, vol. X, no. Y, pp. Z-W, Year.
  private refArticle(entry: BibliographyEntry): string {
    const journal = entry.journalName?.trim() || ''
    const vol = entry.journalVolume?.trim() ? `vol. ${entry.journalVolume.trim()}` : ''
    const issue = entry.journalIssue?.trim() ? `no. ${entry.journalIssue.trim()}` : ''
    const pages = entry.pageRange?.trim() ? `pp. ${entry.pageRange.trim()}` : ''
    const year = entry.year?.trim() || ''
    const parts = [vol, issue, pages, year].filter(Boolean).join(', ')
    const journalPart = journal ? ` *${journal}*,` : ''
    const tail = parts ? ` ${parts}` : ''
    const doi = entry.doi ? `, doi: ${entry.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '')}` : ''
    return `${this.author(entry)}, "${entry.title},"${journalPart}${tail}${doi}.`
  }

  // A. B. Smith, "Title," Ph.D. dissertation, Dept., Univ., City, Year.
  private refDissertation(entry: BibliographyEntry): string {
    const uni = entry.publisher?.trim() || ''
    const place = entry.publishPlace?.trim() || ''
    const year = entry.year?.trim() || ''
    const parts = ['Ph.D. dissertation', uni, place, year].filter(Boolean).join(', ')
    return `${this.author(entry)}, "${entry.title}," ${parts}.`
  }

  // A. B. Smith, "Entry title," in *Encyclopedia*, vol. N. City: Publisher, Year, pp. X-Y.
  private refEncyclopedia(entry: BibliographyEntry): string {
    const encyclopedia = entry.journalName?.trim() || ''
    const vol = entry.journalVolume?.trim() ? `, vol. ${entry.journalVolume.trim()}` : ''
    const place = entry.publishPlace?.trim() || ''
    const pub = entry.publisher?.trim() || ''
    const year = entry.year?.trim() || ''
    const pages = entry.pageRange?.trim() ? `, pp. ${entry.pageRange.trim()}` : ''
    const placePub = place && pub ? `${place}: ${pub}` : (pub || place)
    const middle = encyclopedia ? ` in *${encyclopedia}*${vol}.` : ''
    const tail = [placePub, year].filter(Boolean).join(', ')
    const tailClause = tail ? ` ${tail}${pages}.` : pages ? `${pages}.` : ''
    return `${this.author(entry)}, "${entry.title},"${middle}${tailClause}`
  }

  // A. B. Smith, "Title," Site, Year. Accessed: Mon. DD, YYYY. [Online]. Available: URL
  private refWeb(entry: BibliographyEntry): string {
    const site = entry.publisher?.trim() || entry.journalName?.trim() || ''
    const year = entry.year?.trim() || ''
    const intro = [site, year].filter(Boolean).join(', ')
    const introClause = intro ? ` ${intro}.` : ''
    const accessed = entry.accessDate
      ? ` Accessed: ${formatAccessDateIEEE(entry.accessDate)}.`
      : ''
    const available = entry.url ? ` [Online]. Available: ${entry.url}` : ''
    return `${this.author(entry)}, "${entry.title}."${introClause}${accessed}${available}`
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

/** "Mon. DD, YYYY" — IEEE abbreviation style. */
function formatAccessDateIEEE(raw: string): string {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!iso) return raw
  const months = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.']
  const month = months[parseInt(iso[2], 10) - 1] ?? iso[2]
  const day = parseInt(iso[3], 10)
  return `${month} ${day}, ${iso[1]}`
}
