/**
 * Chicago 17th Edition (Notes–Bibliography) Citation Formatter
 *
 * Reference: https://www.chicagomanualofstyle.org/tools_citationguide/citation-guide-1.html
 *
 * Key rules (Chicago 17 NB):
 *  - Bibliography is ALPHABETICAL by first author's surname.
 *  - Full footnote (first reference to a work):
 *      Firstname Lastname, *Title* (Place: Publisher, Year), Page.
 *  - Short footnote (subsequent references):
 *      Lastname, *Short Title*, Page.
 *  - "ibid." was dropped in the 17th edition — use short form instead.
 *  - Bibliography:
 *      Lastname, Firstname. *Title*. Place: Publisher, Year.
 *  - *Italic* for book/journal titles. Article titles "in quotes".
 *  - Translation: add "trans. Translator Name" (note) / "Translated by
 *    Translator Name." (bibliography).
 *  - Access date included for web sources with no publication date
 *    ("accessed Month DD, YYYY,").
 *  - Dissertation: "(PhD diss., University, Year)".
 */

import type { BibliographyEntry } from '@/types/bibliography'
import { CitationFormatter, type InlineCitationStyle } from './base'
import { renderAuthorList, POLICIES, firstNameLast } from './author-list'

export class ChicagoFormatter extends CitationFormatter {
  get inlineStyle(): InlineCitationStyle {
    return 'footnote'
  }

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
    const short = entry.shortTitle || deriveShortTitle(entry.title)
    const pageStr = buildPageVolume(page, volume)
    const pageClause = pageStr ? `, ${pageStr}` : ''
    if (entry.entryType === 'makale') {
      return `${entry.authorSurname}, "${short}"${pageClause}.`
    }
    return `${entry.authorSurname}, *${short}*${pageClause}.`
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

  // ==================== PRIVATE: FOOTNOTE VARIANTS ====================

  private footnoteBookFirst(
    entry: BibliographyEntry,
    page?: string,
    volume?: string
  ): string {
    const author = authorNormalOrder(entry)
    const extra = buildContributorNote(entry)
    const pub = buildPublisherParens(entry)
    const pageStr = buildPageVolume(page, volume)
    const pageClause = pageStr ? `, ${pageStr}` : ''
    return `${author}, *${entry.title}*${extra} ${pub}${pageClause}.`
  }

  private footnoteArticleFirst(entry: BibliographyEntry, page?: string): string {
    const author = authorNormalOrder(entry)
    const journal = entry.journalName?.trim() || ''
    const vol = entry.journalVolume?.trim() || ''
    const issue = entry.journalIssue?.trim() ? `, no. ${entry.journalIssue.trim()}` : ''
    const year = entry.year ? ` (${entry.year})` : ''
    const pageStr = page ? `: ${page}` : ''
    const journalPart = journal ? ` *${journal}*${vol ? ` ${vol}` : ''}${issue}${year}` : ''
    const doiUrl = entry.doi ? `, https://doi.org/${entry.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '')}` : ''
    return `${author}, "${entry.title},"${journalPart}${pageStr}${doiUrl}.`
  }

  private footnoteDissertationFirst(entry: BibliographyEntry, page?: string): string {
    const author = authorNormalOrder(entry)
    const uni = entry.publisher?.trim() || entry.publishPlace?.trim() || ''
    const year = entry.year?.trim() || ''
    const pageStr = page ? `, ${page}` : ''
    const inner = [uni, year].filter(Boolean).join(', ')
    return `${author}, "${entry.title}" (PhD diss., ${inner})${pageStr}.`
  }

  private footnoteEncyclopediaFirst(entry: BibliographyEntry, page?: string): string {
    const author = authorNormalOrder(entry)
    const encyclopedia = entry.journalName?.trim() || ''
    const vol = entry.journalVolume?.trim() ? ` ${entry.journalVolume.trim()}` : ''
    const year = entry.year ? ` (${entry.year})` : ''
    const pageStr = page ? `: ${page}` : ''
    const encyclopediaPart = encyclopedia ? ` *${encyclopedia}*${vol}${year}` : ''
    return `${author}, "${entry.title},"${encyclopediaPart}${pageStr}.`
  }

  private footnoteWebFirst(entry: BibliographyEntry): string {
    const author = authorNormalOrder(entry)
    const site = entry.publisher?.trim() || entry.journalName?.trim() || ''
    const sitePart = site ? `, *${site}*` : ''
    const published = entry.year ? `, ${entry.year}` : ''
    const accessed = entry.accessDate && !entry.year
      ? `, accessed ${formatAccessDateChicago(entry.accessDate)}`
      : ''
    const url = entry.url ? `, ${entry.url}` : ''
    return `${author}, "${entry.title}"${sitePart}${published}${accessed}${url}.`
  }

  // ==================== PRIVATE: BIBLIOGRAPHY VARIANTS ====================

  private bibBook(entry: BibliographyEntry): string {
    const author = authorInvertedOrder(entry)
    const pub = buildPublisher(entry)
    const year = entry.year?.trim() || 'n.d.'
    const extra = buildContributorBibliography(entry)
    const edition = entry.edition ? ` ${ordinalSuffix(entry.edition)} ed.` : ''
    return `${author}. *${entry.title}*.${extra}${edition} ${pub}, ${year}.`
  }

  private bibArticle(entry: BibliographyEntry): string {
    const author = authorInvertedOrder(entry)
    const journal = entry.journalName?.trim() || ''
    const vol = entry.journalVolume?.trim() || ''
    const issue = entry.journalIssue?.trim() ? `, no. ${entry.journalIssue.trim()}` : ''
    const year = entry.year ? ` (${entry.year})` : ''
    const pages = entry.pageRange ? `: ${entry.pageRange}` : ''
    const doiUrl = entry.doi ? ` https://doi.org/${entry.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '')}.` : ''
    const journalPart = journal ? ` *${journal}*${vol ? ` ${vol}` : ''}${issue}${year}` : ''
    return `${author}. "${entry.title}."${journalPart}${pages}.${doiUrl}`.replace(/\.\.$/, '.')
  }

  private bibDissertation(entry: BibliographyEntry): string {
    const author = authorInvertedOrder(entry)
    const uni = entry.publisher?.trim() || entry.publishPlace?.trim() || ''
    const year = entry.year?.trim() || 'n.d.'
    return `${author}. "${entry.title}." PhD diss., ${uni}, ${year}.`
  }

  private bibEncyclopedia(entry: BibliographyEntry): string {
    const author = authorInvertedOrder(entry)
    // Legacy fallback: old data put encyclopedia title in `publisher` before
    // `journalName` was surfaced in the form.
    const encyclopedia = entry.journalName?.trim() || entry.publisher?.trim() || ''
    const vol = entry.journalVolume?.trim() ? ` ${entry.journalVolume.trim()}` : ''
    const year = entry.year ? ` (${entry.year})` : ''
    const pages = entry.pageRange ? `: ${entry.pageRange}` : ''
    const encyclopediaPart = encyclopedia ? ` *${encyclopedia}*${vol}${year}` : ''
    return `${author}. "${entry.title}."${encyclopediaPart}${pages}.`
  }

  private bibWeb(entry: BibliographyEntry): string {
    const author = authorInvertedOrder(entry)
    const site = entry.publisher?.trim() || entry.journalName?.trim() || ''
    const sitePart = site ? ` *${site}*.` : ''
    const published = entry.year ? ` ${entry.year}.` : ''
    const accessed = entry.accessDate && !entry.year
      ? ` Accessed ${formatAccessDateChicago(entry.accessDate)}.`
      : ''
    const url = entry.url ? ` ${entry.url}.` : ''
    return `${author}. "${entry.title}."${sitePart}${published}${accessed}${url}`.trim()
  }
}

// ==================== MODULE-LEVEL HELPERS ====================

function authorNormalOrder(entry: BibliographyEntry): string {
  // Chicago notes: "First Last, First Last et al." — 4+ authors collapse.
  return renderAuthorList(entry, POLICIES.CHICAGO_N, {
    renderOne: firstNameLast,
    separator: ', ',
    finalSeparator: ', and ',
    etAl: 'et al.',
  })
}

function authorInvertedOrder(entry: BibliographyEntry): string {
  // Chicago bibliography: first "Last, First", subsequent "First Last".
  // 11+ authors → list 7 + "et al."
  let isFirst = true
  return renderAuthorList(entry, POLICIES.CHICAGO_B, {
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

function buildPublisher(entry: BibliographyEntry): string {
  const place = entry.publishPlace?.trim() || ''
  const pub = entry.publisher?.trim() || ''
  if (place && pub) return `${place}: ${pub}`
  if (pub) return pub
  if (place) return place
  return 'n.p.'
}

function buildPublisherParens(entry: BibliographyEntry): string {
  const inner = buildPublisher(entry)
  const year = entry.year?.trim() || 'n.d.'
  return `(${inner}, ${year})`
}

function buildPageVolume(page?: string, volume?: string): string {
  if (volume && page) return `${volume}:${page}`
  if (page) return page
  return ''
}

function buildContributorNote(entry: BibliographyEntry): string {
  if (entry.entryType === 'ceviri' && entry.translator) {
    return `, trans. ${entry.translator}`
  }
  if (entry.entryType === 'nesir' && entry.editor) {
    return `, ed. ${entry.editor}`
  }
  return ''
}

function buildContributorBibliography(entry: BibliographyEntry): string {
  if (entry.entryType === 'ceviri' && entry.translator) {
    return ` Translated by ${entry.translator}.`
  }
  if (entry.entryType === 'nesir' && entry.editor) {
    return ` Edited by ${entry.editor}.`
  }
  return ''
}

function deriveShortTitle(title: string): string {
  return title.replace(/^(el-|er-|al-|the |a |an )/i, '').split(/\s+/).slice(0, 4).join(' ')
}

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

/** "Month DD, YYYY" — Chicago access-date convention. */
function formatAccessDateChicago(raw: string): string {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!iso) return raw
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const month = months[parseInt(iso[2], 10) - 1] ?? iso[2]
  const day = parseInt(iso[3], 10)
  return `${month} ${day}, ${iso[1]}`
}
