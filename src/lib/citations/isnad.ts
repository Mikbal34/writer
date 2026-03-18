/**
 * ISNAD 2nd Edition Citation Formatter
 *
 * Key rules (ISNAD 2. Baskı):
 *  - Footnote first uses normal name order: "Adı Soyadı"
 *  - Footnote subsequent: "Soyadı, KısaBaşlık, Sayfa."
 *  - Footnote uses comma separators, publisher info in parentheses
 *  - Bibliography uses inverted order: "Soyadı, Adı"
 *  - Bibliography uses period separators
 *  - Web URLs only appear in bibliography, NOT in footnotes
 */

import type { BibliographyEntry } from '@/types/bibliography'
import { CitationFormatter } from './formatter'

export class ISNADFormatter extends CitationFormatter {
  // ==================== FOOTNOTE FIRST ====================

  formatFootnoteFirst(
    entry: BibliographyEntry,
    page?: string,
    volume?: string
  ): string {
    switch (entry.entryType) {
      case 'kitap':
        return this.footnoteKitapFirst(entry, page, volume)
      case 'nesir':
        return this.footnoteNesirFirst(entry, page, volume)
      case 'ceviri':
        return this.footnoteCeviriFirst(entry, page, volume)
      case 'makale':
        return this.footnoteMakaleFirst(entry, page)
      case 'tez':
        return this.footnoteTezFirst(entry, page)
      case 'ansiklopedi':
        return this.footnoteAnsiklopediFirst(entry, page)
      case 'web':
        return this.footnoteWebFirst(entry)
      default:
        return this.footnoteKitapFirst(entry, page, volume)
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

    switch (entry.entryType) {
      case 'makale':
        return `${entry.authorSurname}, "${short}", ${pageStr}.`
      default:
        return `${entry.authorSurname}, ${short}, ${pageStr}.`
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

  // ==================== PRIVATE: FOOTNOTE FIRST VARIANTS ====================

  // Dipnot: Adı Soyadı, Kitap Adı (Yer: Yayınevi, Yıl), Sayfa.
  private footnoteKitapFirst(
    entry: BibliographyEntry,
    page?: string,
    volume?: string
  ): string {
    const author = authorNormal(entry)
    const pubParens = buildPublisherParens(entry)
    const pageStr = buildPageVolume(page, volume)
    const pageClause = pageStr ? `, ${pageStr}` : ''
    return `${author}, ${entry.title} ${pubParens}${pageClause}.`
  }

  // Dipnot: Adı Soyadı, Kitap Adı, nşr. Editör Adı Soyadı (Yer: Yayınevi, Yıl), Cilt/Sayfa.
  private footnoteNesirFirst(
    entry: BibliographyEntry,
    page?: string,
    volume?: string
  ): string {
    const author = authorNormal(entry)
    const editor = entry.editor ?? entry.translator ?? ''
    const pubParens = buildPublisherParens(entry)
    const pageStr = buildPageVolume(page, volume)
    const pageClause = pageStr ? `, ${pageStr}` : ''
    const editorClause = editor ? `, nşr. ${editor}` : ''
    return `${author}, ${entry.title}${editorClause} ${pubParens}${pageClause}.`
  }

  // Dipnot: Adı Soyadı, Kitap Adı, çev. Çevirmen Adı Soyadı (Yer: Yayınevi, Yıl), Sayfa.
  private footnoteCeviriFirst(
    entry: BibliographyEntry,
    page?: string,
    volume?: string
  ): string {
    const author = authorNormal(entry)
    const translator = entry.translator ?? ''
    const pubParens = buildPublisherParens(entry)
    const pageStr = buildPageVolume(page, volume)
    const pageClause = pageStr ? `, ${pageStr}` : ''
    const transClause = translator ? `, çev. ${translator}` : ''
    return `${author}, ${entry.title}${transClause} ${pubParens}${pageClause}.`
  }

  // Dipnot: Adı Soyadı, "Makale Adı", Dergi Adı Cilt/Sayı (Yıl), Sayfa.
  private footnoteMakaleFirst(
    entry: BibliographyEntry,
    page?: string
  ): string {
    const author = authorNormal(entry)
    const journal = entry.journalName ?? ''
    const vol = entry.journalVolume ?? ''
    const issue = entry.journalIssue ?? ''
    const year = entry.year ?? ''
    const pageStr = page ?? ''

    let journalRef = journal
    if (vol && issue) journalRef += ` ${vol}/${issue}`
    else if (vol) journalRef += ` ${vol}`
    if (year) journalRef += ` (${year})`

    const pageClause = pageStr ? `, ${pageStr}` : ''
    return `${author}, "${entry.title}", ${journalRef}${pageClause}.`
  }

  // Dipnot: Adı Soyadı, "Tez Başlığı" (Doktora Tezi, Üniversite, Yıl), Sayfa.
  private footnoteTezFirst(
    entry: BibliographyEntry,
    page?: string
  ): string {
    const author = authorNormal(entry)
    const uni = entry.publisher ?? entry.publishPlace ?? ''
    const year = entry.year ?? ''
    const pageClause = page ? `, ${page}` : ''
    return `${author}, "${entry.title}" (Doktora Tezi, ${uni}, ${year})${pageClause}.`
  }

  // Dipnot: Adı Soyadı, "Madde Adı", Ansiklopedi Cilt (Yer: Yayınevi, Yıl), Sayfa.
  private footnoteAnsiklopediFirst(
    entry: BibliographyEntry,
    page?: string
  ): string {
    const author = authorNormal(entry)
    const encyclopedia = entry.journalName ?? ''
    const vol = entry.journalVolume ? ` ${entry.journalVolume}` : ''
    const pubParens = buildPublisherParens(entry)
    const pageClause = page ? `, ${page}` : ''
    return `${author}, "${entry.title}", ${encyclopedia}${vol} ${pubParens}${pageClause}.`
  }

  // Dipnot: Adı Soyadı, "Başlık" (Erişim Yıl).  ← URL YOK
  private footnoteWebFirst(entry: BibliographyEntry): string {
    const author = authorNormal(entry)
    const year = entry.year ? ` (Erişim ${entry.year})` : ''
    return `${author}, "${entry.title}"${year}.`
  }

  // ==================== PRIVATE: BIBLIOGRAPHY VARIANTS ====================

  private bibKitap(entry: BibliographyEntry): string {
    const author = authorInverted(entry)
    const pub = buildPublisher(entry)
    const parts: string[] = [`${author}. ${entry.title}.`]
    if (pub) parts.push(`${pub},`)
    if (entry.edition) parts.push(`${entry.edition}. Basım,`)
    if (entry.year) parts.push(`${entry.year}.`)
    return cleanTrailing(parts.join(' '))
  }

  private bibNesir(entry: BibliographyEntry): string {
    const author = authorInverted(entry)
    const pub = buildPublisher(entry)
    const editor = entry.editor ?? entry.translator ?? ''
    const parts: string[] = [`${author}. ${entry.title}.`]
    if (editor) parts.push(`nşr. ${editor}.`)
    if (pub) parts.push(`${pub},`)
    if (entry.year) parts.push(`${entry.year}.`)
    return cleanTrailing(parts.join(' '))
  }

  private bibCeviri(entry: BibliographyEntry): string {
    const author = authorInverted(entry)
    const pub = buildPublisher(entry)
    const translator = entry.translator ?? ''
    const parts: string[] = [`${author}. ${entry.title}.`]
    if (translator) parts.push(`çev. ${translator}.`)
    if (pub) parts.push(`${pub},`)
    if (entry.year) parts.push(`${entry.year}.`)
    return cleanTrailing(parts.join(' '))
  }

  private bibMakale(entry: BibliographyEntry): string {
    const author = authorInverted(entry)
    const journal = entry.journalName ?? ''
    const vol = entry.journalVolume ?? ''
    const issue = entry.journalIssue ?? ''
    const year = entry.year ?? ''
    const pages = entry.pageRange ?? ''

    let journalRef = journal
    if (vol && issue) journalRef += ` ${vol}/${issue}`
    else if (vol) journalRef += ` ${vol}`
    if (year) journalRef += ` (${year})`

    const pagesStr = pages ? `: ${pages}` : ''
    return `${author}. "${entry.title}". ${journalRef}${pagesStr}.`
  }

  private bibTez(entry: BibliographyEntry): string {
    const author = authorInverted(entry)
    const uni = entry.publisher ?? entry.publishPlace ?? ''
    const year = entry.year ?? ''
    return `${author}. "${entry.title}". Yayımlanmamış Doktora Tezi. ${uni}, ${year}.`
  }

  private bibAnsiklopedi(entry: BibliographyEntry): string {
    const author = authorInverted(entry)
    const journal = entry.journalName ?? ''
    const vol = entry.journalVolume ?? ''
    const year = entry.year ?? ''
    const pages = entry.pageRange ?? ''

    let ref = journal
    if (vol) ref += ` ${vol}`
    if (year) ref += ` (${year})`
    const pagesStr = pages ? `, ${pages}` : ''
    return `${author}. "${entry.title}". ${ref}${pagesStr}.`
  }

  private bibWeb(entry: BibliographyEntry): string {
    const author = authorInverted(entry)
    const url = entry.url ?? ''
    const year = entry.year ? ` Erişim: ${entry.year}.` : ''
    // URL sonrası nokta YOK
    return `${author}. "${entry.title}".${year} ${url}`
  }

  // ==================== PRIVATE: UTILITIES ====================

  /**
   * Derives a short title from the full title.
   * Takes the first 3-4 meaningful words, strips leading articles.
   */
  private deriveShortTitle(title: string): string {
    const stripped = title.replace(/^(el-|er-|al-)/i, '')
    const words = stripped.split(/\s+/).slice(0, 4)
    return words.join(' ')
  }
}

// ==================== MODULE-LEVEL HELPERS ====================

/** "Adı Soyadı" — normal order for footnotes */
function authorNormal(entry: BibliographyEntry): string {
  if (entry.authorName) {
    return `${entry.authorName} ${entry.authorSurname}`
  }
  return entry.authorSurname
}

/** "Soyadı, Adı" — inverted order for bibliography */
function authorInverted(entry: BibliographyEntry): string {
  if (entry.authorName) {
    return `${entry.authorSurname}, ${entry.authorName}`
  }
  return entry.authorSurname
}

function buildPublisher(entry: BibliographyEntry): string {
  if (entry.publishPlace && entry.publisher) {
    return `${entry.publishPlace}: ${entry.publisher}`
  }
  if (entry.publisher) return entry.publisher
  if (entry.publishPlace) return entry.publishPlace
  return ''
}

/** "(Yer: Yayınevi, Yıl)" — parenthesized publisher block for footnotes */
function buildPublisherParens(entry: BibliographyEntry): string {
  const pub = buildPublisher(entry)
  const year = entry.year ?? ''
  if (pub && year) return `(${pub}, ${year})`
  if (pub) return `(${pub})`
  if (year) return `(${year})`
  return ''
}

/**
 * Combines volume and page into the ISNAD format "cilt/sayfa" or just "sayfa".
 */
function buildPageVolume(page?: string, volume?: string): string {
  if (volume && page) return `${volume}/${page}`
  if (page) return page
  return ''
}

/**
 * Removes trailing commas or double periods left over from optional fields.
 */
function cleanTrailing(text: string): string {
  return text
    .replace(/,\s*\./g, '.')
    .replace(/\.\s*\./g, '.')
    .replace(/,\s*$/g, '.')
    .trim()
}
