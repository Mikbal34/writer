/**
 * APA 7th Edition Citation Formatter
 *
 * Reference: https://apastyle.apa.org/style-grammar-guidelines/references
 *
 * Key rules (APA 7):
 *  - Reference list is ALPHABETICAL by surname.
 *  - In-text: (Surname, Year) or (Surname, Year, p. 45) / (pp. 45-48).
 *  - Book/journal titles are *italic*; article titles are plain, no quotes.
 *  - Book and article titles use SENTENCE CASE; journal/periodical titles
 *    use TITLE CASE. (We preserve the user-entered casing and do not
 *    auto-transform; style guides differ on casing auto-conversion.)
 *  - Journal volume is italic. Issue goes in (parens) and is NOT italic.
 *  - Author format: Surname, I. I.  (initials with period + space).
 *  - DOI is rendered as a URL: https://doi.org/<doi>.
 *  - Web: retrieval date only when the content is likely to change.
 *  - Edition uses ordinal suffix: "(2nd ed.)".
 */

import type { BibliographyEntry } from '@/types/bibliography'
import { CitationFormatter, type InlineCitationStyle } from './base'
import { renderAuthorList, POLICIES, apaLastInitialFirst } from './author-list'

export class APAFormatter extends CitationFormatter {
  get inlineStyle(): InlineCitationStyle {
    return 'author-date'
  }

  // ==================== INLINE (used by formatter.ts default) ====================
  // APA does not traditionally use footnotes for source citations; we reuse the
  // abstract's `formatInline` for (Surname, Year, p. N). `formatFootnoteFirst`
  // and `formatFootnoteSubsequent` return the same in-text string for API
  // compatibility.

  formatFootnoteFirst(
    entry: BibliographyEntry,
    page?: string,
    _volume?: string
  ): string {
    return this.formatInline(entry, page)
  }

  formatFootnoteSubsequent(
    entry: BibliographyEntry,
    page?: string,
    _volume?: string
  ): string {
    return this.formatInline(entry, page)
  }

  // ==================== BIBLIOGRAPHY (REFERENCES) ====================

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
    // Surname, I. I., Surname, I. I., & Surname, I. I.  (APA 7 §9.8)
    // 21+ authors: list 19, "...", final author.
    return renderAuthorList(entry, POLICIES.APA, {
      renderOne: apaLastInitialFirst,
      separator: ', ',
      finalSeparator: ', & ',
      etAl: 'et al.',
    })
  }

  private year(entry: BibliographyEntry): string {
    return entry.year?.trim() || 'n.d.'
  }

  private edition(entry: BibliographyEntry): string {
    if (!entry.edition) return ''
    return ` (${ordinalSuffix(entry.edition)} ed.)`
  }

  private doiOrUrl(entry: BibliographyEntry): string {
    if (entry.doi) return ` https://doi.org/${entry.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '')}`
    if (entry.url) return ` ${entry.url}`
    return ''
  }

  // Surname, I. I. (Year). *Title of book* (2nd ed.). Publisher.
  private refBook(entry: BibliographyEntry): string {
    const pub = entry.publisher?.trim() || ''
    const pubClause = pub ? ` ${pub}.` : ''
    return `${this.authorRef(entry)} (${this.year(entry)}). *${entry.title}*${this.edition(entry)}.${pubClause}`
  }

  // Surname, I. I. (Ed.). (Year). *Title* (2nd ed.). Publisher.
  private refEditedBook(entry: BibliographyEntry): string {
    const pub = entry.publisher?.trim() || ''
    const pubClause = pub ? ` ${pub}.` : ''
    const editorNote = entry.editor ? ` (${entry.editor}, Ed.)` : ''
    return `${this.authorRef(entry)} (${this.year(entry)}). *${entry.title}*${editorNote}${this.edition(entry)}.${pubClause}`
  }

  // Surname, I. I. (Year). *Title* (T. Translator, Trans.). Publisher.
  private refTranslation(entry: BibliographyEntry): string {
    const pub = entry.publisher?.trim() || ''
    const pubClause = pub ? ` ${pub}.` : ''
    const transNote = entry.translator ? ` (${entry.translator}, Trans.)` : ''
    return `${this.authorRef(entry)} (${this.year(entry)}). *${entry.title}*${transNote}${this.edition(entry)}.${pubClause}`
  }

  // Surname, I. I. (Year). Title of article. *Journal*, *Vol*(Issue), pages. https://doi.org/xx
  private refArticle(entry: BibliographyEntry): string {
    const journal = entry.journalName?.trim() || ''
    const vol = entry.journalVolume?.trim() || ''
    const issue = entry.journalIssue?.trim() ? `(${entry.journalIssue.trim()})` : ''
    const pages = entry.pageRange?.trim() || ''

    let periodical = ''
    if (journal) {
      periodical = `*${journal}*`
      if (vol) periodical += `, *${vol}*${issue}`
      if (pages) periodical += `, ${pages}`
    }
    const periodicalClause = periodical ? ` ${periodical}.` : ''
    const link = this.doiOrUrl(entry)
    const suffix = link ? `${link}` : ''
    return `${this.authorRef(entry)} (${this.year(entry)}). ${entry.title}.${periodicalClause}${suffix}`
  }

  // Surname, I. I. (Year). *Title of dissertation* [Doctoral dissertation, University]. Database.
  private refDissertation(entry: BibliographyEntry): string {
    const uni = entry.publisher?.trim() || entry.publishPlace?.trim() || ''
    const bracket = uni ? ` [Doctoral dissertation, ${uni}]` : ' [Doctoral dissertation]'
    return `${this.authorRef(entry)} (${this.year(entry)}). *${entry.title}*${bracket}.`
  }

  // Surname, I. I. (Year). Title of entry. In E. Editor (Ed.), *Encyclopedia* (Vol. N, pp. 312-318). Publisher.
  private refEncyclopedia(entry: BibliographyEntry): string {
    // Encyclopedia title lives in `journalName`; legacy data may have put it in
    // `publisher` before the dedicated field existed — fall back so old entries
    // still render reasonably.
    const encyclopedia = entry.journalName?.trim() || entry.publisher?.trim() || ''
    const vol = entry.journalVolume?.trim() ? `Vol. ${entry.journalVolume.trim()}` : ''
    const pages = entry.pageRange?.trim() ? `pp. ${entry.pageRange.trim()}` : ''
    const volPages = [vol, pages].filter(Boolean).join(', ')
    const editorNote = entry.editor ? `${entry.editor} (Ed.), ` : ''
    const parenthetical = volPages ? ` (${volPages})` : ''
    // If encyclopedia came from the publisher field (legacy), don't repeat it.
    const pub = entry.journalName?.trim() ? (entry.publisher?.trim() || '') : ''
    const pubClause = pub ? ` ${pub}.` : ''
    const encyclopediaPart = encyclopedia
      ? ` In ${editorNote}*${encyclopedia}*${parenthetical}.`
      : ''
    return `${this.authorRef(entry)} (${this.year(entry)}). ${entry.title}.${encyclopediaPart}${pubClause}`
  }

  // Surname, I. I. (Year, Month Day). *Title of page*. Site Name. URL
  // APA 7: retrieval date only when content may change. We include it if user
  // provided accessDate.
  private refWeb(entry: BibliographyEntry): string {
    const site = entry.publisher?.trim() || entry.journalName?.trim() || ''
    const sitePart = site ? ` ${site}.` : ''
    const urlPart = entry.url ? ` ${entry.url}` : ''
    const retrieved = entry.accessDate
      ? ` Retrieved ${formatAccessDateAPA(entry.accessDate)}, from ${entry.url ?? ''}`.trimEnd()
      : ''
    // If retrieval date is present, drop the plain URL (retrieval line carries it).
    const tail = retrieved || urlPart
    return `${this.authorRef(entry)} (${this.year(entry)}). *${entry.title}*.${sitePart}${tail}`
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

/** Formats ISO `YYYY-MM-DD` (or free text) as "Month DD, YYYY" for APA. */
function formatAccessDateAPA(raw: string): string {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!iso) return raw
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const month = months[parseInt(iso[2], 10) - 1] ?? iso[2]
  const day = parseInt(iso[3], 10)
  return `${month} ${day}, ${iso[1]}`
}
