/**
 * ISNAD 2nd Edition Citation Formatter
 *
 * Reference: https://www.isnadsistemi.org/en/guide/isnad2-2/introduction/isnad-citation-style/
 *
 * Key rules (ISNAD 2. Baskı):
 *  - Bibliography is ALPHABETICAL (leading "el-/er-/al-" articles ignored).
 *  - Full footnote: Adı Soyadı, *Kitap Adı* (Yer: Yayınevi, Yıl), Sayfa.
 *  - Short footnote (subsequent): Soyadı, *Kısa Başlık*, Sayfa.
 *  - Bibliography: Soyadı, Adı. *Kitap Adı*. Yer: Yayınevi, Yıl.
 *  - *Italic* for book / journal / encyclopedia titles.
 *  - "nşr." (neşreden / editör) for edited works; "çev." for translations.
 *  - Cilt/sayfa: "cilt/sayfa" (e.g. "2/45").
 *  - Web: URL only in bibliography, NOT in footnotes.
 *  - Access date: "Erişim: DD.MM.YYYY" (only in bibliography).
 *  - Edition: "2. bs."
 */

import type { BibliographyEntry } from '@/types/bibliography'
import { CitationFormatter, type InlineCitationStyle } from './base'
import { renderAuthorList, POLICIES, firstNameLast } from './author-list'

export class ISNADFormatter extends CitationFormatter {
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
        return this.noteKitapFirst(entry, page, volume)
      case 'nesir':
        return this.noteNesirFirst(entry, page, volume)
      case 'ceviri':
        return this.noteCeviriFirst(entry, page, volume)
      case 'makale':
        return this.noteMakaleFirst(entry, page)
      case 'tez':
        return this.noteTezFirst(entry, page)
      case 'ansiklopedi':
        return this.noteAnsiklopediFirst(entry, page)
      case 'web':
        return this.noteWebFirst(entry)
      default:
        return this.noteKitapFirst(entry, page, volume)
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

    switch (entry.entryType) {
      case 'makale':
        return `${entry.authorSurname}, "${short}"${pageClause}.`
      default:
        return `${entry.authorSurname}, *${short}*${pageClause}.`
    }
  }

  // ==================== BIBLIOGRAPHY ====================

  formatBibliography(entry: BibliographyEntry): string {
    switch (entry.entryType) {
      case 'kitap':
        return this.bibKitap(entry)
      case 'nesir':
        return this.bibNesir(entry)
      case 'ceviri':
        return this.bibCeviri(entry)
      case 'makale':
        return this.bibMakale(entry)
      case 'tez':
        return this.bibTez(entry)
      case 'ansiklopedi':
        return this.bibAnsiklopedi(entry)
      case 'web':
        return this.bibWeb(entry)
      default:
        return this.bibKitap(entry)
    }
  }

  // ==================== PRIVATE: FOOTNOTE VARIANTS ====================

  private noteKitapFirst(entry: BibliographyEntry, page?: string, volume?: string): string {
    const author = authorNormal(entry)
    const pub = buildPublisherParens(entry)
    const pageStr = buildPageVolume(page, volume)
    const pageClause = pageStr ? `, ${pageStr}` : ''
    return `${author}, *${entry.title}* ${pub}${pageClause}.`
  }

  private noteNesirFirst(entry: BibliographyEntry, page?: string, volume?: string): string {
    const author = authorNormal(entry)
    const editor = entry.editor || entry.translator || ''
    const editorClause = editor ? `, nşr. ${editor}` : ''
    const pub = buildPublisherParens(entry)
    const pageStr = buildPageVolume(page, volume)
    const pageClause = pageStr ? `, ${pageStr}` : ''
    return `${author}, *${entry.title}*${editorClause} ${pub}${pageClause}.`
  }

  private noteCeviriFirst(entry: BibliographyEntry, page?: string, volume?: string): string {
    const author = authorNormal(entry)
    const translator = entry.translator || ''
    const transClause = translator ? `, çev. ${translator}` : ''
    const pub = buildPublisherParens(entry)
    const pageStr = buildPageVolume(page, volume)
    const pageClause = pageStr ? `, ${pageStr}` : ''
    return `${author}, *${entry.title}*${transClause} ${pub}${pageClause}.`
  }

  private noteMakaleFirst(entry: BibliographyEntry, page?: string): string {
    const author = authorNormal(entry)
    const journal = entry.journalName || ''
    const vol = entry.journalVolume || ''
    const issue = entry.journalIssue || ''
    const year = entry.year || ''
    const pageStr = page || ''

    let journalRef = `*${journal}*`
    if (vol && issue) journalRef += ` ${vol}/${issue}`
    else if (vol) journalRef += ` ${vol}`
    if (year) journalRef += ` (${year})`

    const pageClause = pageStr ? `, ${pageStr}` : ''
    return `${author}, "${entry.title}", ${journalRef}${pageClause}.`
  }

  private noteTezFirst(entry: BibliographyEntry, page?: string): string {
    const author = authorNormal(entry)
    const uni = entry.publisher?.trim() || entry.publishPlace?.trim() || ''
    const year = entry.year?.trim() || ''
    const pageClause = page ? `, ${page}` : ''
    const inner = [uni, year].filter(Boolean).join(', ')
    return `${author}, "${entry.title}" (Doktora Tezi, ${inner})${pageClause}.`
  }

  private noteAnsiklopediFirst(entry: BibliographyEntry, page?: string): string {
    const author = authorNormal(entry)
    const encyclopedia = entry.journalName?.trim() || ''
    const vol = entry.journalVolume?.trim() ? ` ${entry.journalVolume.trim()}` : ''
    const pub = buildPublisherParens(entry)
    const pageClause = page ? `, ${page}` : ''
    const encyclopediaPart = encyclopedia ? ` *${encyclopedia}*${vol}` : ''
    return `${author}, "${entry.title}",${encyclopediaPart} ${pub}${pageClause}.`
  }

  // Dipnot: URL KULLANILMAZ — sadece erişim yılı belirtilir.
  private noteWebFirst(entry: BibliographyEntry): string {
    const author = authorNormal(entry)
    const year = entry.year ? ` (Erişim ${entry.year})` : ''
    return `${author}, "${entry.title}"${year}.`
  }

  // ==================== PRIVATE: BIBLIOGRAPHY VARIANTS ====================

  private bibKitap(entry: BibliographyEntry): string {
    const author = authorInverted(entry)
    const pub = buildPublisher(entry)
    const parts: string[] = [`${author}. *${entry.title}*.`]
    if (entry.edition) parts.push(`${entry.edition}. bs.`)
    if (pub) parts.push(`${pub},`)
    if (entry.year) parts.push(`${entry.year}.`)
    return cleanTrailing(parts.join(' '))
  }

  private bibNesir(entry: BibliographyEntry): string {
    const author = authorInverted(entry)
    const pub = buildPublisher(entry)
    const editor = entry.editor || entry.translator || ''
    const parts: string[] = [`${author}. *${entry.title}*.`]
    if (editor) parts.push(`nşr. ${editor}.`)
    if (pub) parts.push(`${pub},`)
    if (entry.year) parts.push(`${entry.year}.`)
    return cleanTrailing(parts.join(' '))
  }

  private bibCeviri(entry: BibliographyEntry): string {
    const author = authorInverted(entry)
    const pub = buildPublisher(entry)
    const translator = entry.translator || ''
    const parts: string[] = [`${author}. *${entry.title}*.`]
    if (translator) parts.push(`çev. ${translator}.`)
    if (pub) parts.push(`${pub},`)
    if (entry.year) parts.push(`${entry.year}.`)
    return cleanTrailing(parts.join(' '))
  }

  private bibMakale(entry: BibliographyEntry): string {
    const author = authorInverted(entry)
    const journal = entry.journalName || ''
    const vol = entry.journalVolume || ''
    const issue = entry.journalIssue || ''
    const year = entry.year || ''
    const pages = entry.pageRange || ''

    let journalRef = `*${journal}*`
    if (vol && issue) journalRef += ` ${vol}/${issue}`
    else if (vol) journalRef += ` ${vol}`
    if (year) journalRef += ` (${year})`

    const pagesStr = pages ? `: ${pages}` : ''
    return `${author}. "${entry.title}". ${journalRef}${pagesStr}.`
  }

  private bibTez(entry: BibliographyEntry): string {
    const author = authorInverted(entry)
    const uni = entry.publisher?.trim() || entry.publishPlace?.trim() || ''
    const year = entry.year?.trim() || ''
    return `${author}. "${entry.title}". Yayımlanmamış Doktora Tezi. ${uni}, ${year}.`
  }

  private bibAnsiklopedi(entry: BibliographyEntry): string {
    const author = authorInverted(entry)
    // Legacy fallback: encyclopedia title may have been stored in `publisher`.
    const encyclopedia = entry.journalName?.trim() || entry.publisher?.trim() || ''
    const vol = entry.journalVolume || ''
    const year = entry.year || ''
    const pages = entry.pageRange || ''

    // Empty encyclopedia → omit the italic marker entirely (no `** (…)`).
    const ref = encyclopedia
      ? `*${encyclopedia}*${vol ? ` ${vol}` : ''}${year ? ` (${year})` : ''}`
      : (year ? `(${year})` : '')
    const pagesStr = pages ? `, ${pages}` : ''
    const refClause = ref ? ` ${ref}` : ''
    return `${author}. "${entry.title}".${refClause}${pagesStr}.`
  }

  private bibWeb(entry: BibliographyEntry): string {
    const author = authorInverted(entry)
    const url = entry.url || ''
    const accessed = entry.accessDate
      ? ` Erişim: ${formatAccessDateISNAD(entry.accessDate)}.`
      : (entry.year ? ` Erişim: ${entry.year}.` : '')
    // ISNAD: URL is the last element, no trailing period.
    return `${author}. "${entry.title}".${accessed} ${url}`.trim()
  }
}

// ==================== MODULE-LEVEL HELPERS ====================

function authorNormal(entry: BibliographyEntry): string {
  // ISNAD 2: 1-2 yazar listelenir, 3+ olunca "İlk Yazar vd."
  return renderAuthorList(entry, POLICIES.ISNAD, {
    renderOne: firstNameLast,
    separator: ', ',
    finalSeparator: ' ve ',
    etAl: 'vd.',
  })
}

function authorInverted(entry: BibliographyEntry): string {
  // Bibliography: ilk yazar "Soyad, Ad", sonrakiler "Ad Soyad"; 3+ → vd.
  let isFirst = true
  return renderAuthorList(entry, POLICIES.ISNAD, {
    renderOne: (a) => {
      if (isFirst) {
        isFirst = false
        return a.name ? `${a.surname}, ${a.name}` : a.surname
      }
      return firstNameLast(a)
    },
    separator: ', ',
    finalSeparator: ' ve ',
    etAl: 'vd.',
  })
}

function buildPublisher(entry: BibliographyEntry): string {
  const place = entry.publishPlace?.trim() || ''
  const pub = entry.publisher?.trim() || ''
  if (place && pub) return `${place}: ${pub}`
  if (pub) return pub
  if (place) return place
  return ''
}

function buildPublisherParens(entry: BibliographyEntry): string {
  const inner = buildPublisher(entry)
  const year = entry.year?.trim() || ''
  if (inner && year) return `(${inner}, ${year})`
  if (inner) return `(${inner})`
  if (year) return `(${year})`
  return ''
}

function buildPageVolume(page?: string, volume?: string): string {
  if (volume && page) return `${volume}/${page}`
  if (page) return page
  return ''
}

function deriveShortTitle(title: string): string {
  const stripped = title.replace(/^(el-|er-|al-)/i, '')
  return stripped.split(/\s+/).slice(0, 4).join(' ')
}

/** "DD.MM.YYYY" — ISNAD access-date convention (Turkish short date). */
function formatAccessDateISNAD(raw: string): string {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!iso) return raw
  return `${iso[3]}.${iso[2]}.${iso[1]}`
}

function cleanTrailing(text: string): string {
  return text
    .replace(/,\s*\./g, '.')
    .replace(/\.\s*\./g, '.')
    .replace(/,\s*$/g, '.')
    .trim()
}
