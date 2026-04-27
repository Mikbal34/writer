/**
 * PDF structural builders — same surface as `./docx-structural` but for
 * pdfkit. Each function takes the pdfkit document, the format, and the
 * academic metadata, and emits the corresponding block directly.
 *
 * Caller is responsible for adding a page break before/after when the
 * spec demands one (we do call `doc.addPage()` at the end of title page
 * / abstract pages / TOC since those are always standalone pages).
 */

import type PDFDocument from 'pdfkit'
import type { CitationFormat } from '@prisma/client'
import {
  getStructuralSpec,
  formatChapterNumber,
  toRoman,
  type TitlePageElement,
  type StructuralSpec,
} from './structural-specs'
import { getFormatDefaults } from '@/lib/citations/format-defaults'

/**
 * Section-title size from the format spec — reused as the heading size
 * for the abstract / key points / manuscript info / TOC pages so the
 * visual hierarchy stays consistent across structural pages.
 */
function headingPt(format: CitationFormat): number {
  return getFormatDefaults(format).sectionTitleSize
}
import type { AcademicMeta, TocEntry } from './docx-structural'

type Doc = InstanceType<typeof PDFDocument>

interface FontBundle {
  regular: string
  bold: string
  italic: string
  boldItalic: string
}

// =================================================================
//  TITLE PAGE
// =================================================================

export function renderTitlePage(
  doc: Doc,
  format: CitationFormat,
  meta: AcademicMeta,
  fonts: FontBundle,
): void {
  const spec = getStructuralSpec(format)
  if (!spec.titlePage.enabled) return

  const pageHeight = doc.page.height
  const topReserve =
    format === 'ISNAD' ? pageHeight * 0.10
    : format === 'IEEE' || format === 'VANCOUVER' || format === 'AMA' ? pageHeight * 0.08
    : pageHeight * 0.18
  doc.y = topReserve

  const gapBetweenGroups = format === 'ISNAD' ? 12 : 16

  // Multi-author rendering for journal formats (IEEE / Vancouver / AMA).
  // When the meta carries an authors[] array, the author/affiliation
  // group is replaced with a per-author block: name, affiliation,
  // optional email — one author per stack, blank line between.
  const hasMultiAuthor = !!meta.authors
    && meta.authors.length > 1
    && (format === 'IEEE' || format === 'VANCOUVER' || format === 'AMA')
  const bodyFontSize = getFormatDefaults(format).bodyFontSize
  let multiAuthorEmitted = false

  spec.titlePage.groups.forEach((group, groupIdx) => {
    const isAuthorGroup = group.includes('author') || group.includes('affiliation')
    if (hasMultiAuthor && isAuthorGroup) {
      if (multiAuthorEmitted) return
      multiAuthorEmitted = true
    }
    if (hasMultiAuthor && isAuthorGroup && meta.authors) {
      meta.authors.forEach((a, authorIdx) => {
        if (!a.name) return
        const degrees = format === 'AMA' && a.degrees.length > 0
          ? ` ${a.degrees.join(', ')}`
          : ''
        doc
          .font(format === 'IEEE' ? fonts.bold : fonts.regular)
          .fontSize(bodyFontSize)
        doc.text(`${a.name}${degrees}`, {
          align: 'center',
          width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        })
        const affilParts = [a.department, a.institution, a.city, a.country]
          .filter(Boolean)
        if (affilParts.length > 0) {
          doc
            .font(format === 'IEEE' ? fonts.italic : fonts.regular)
            .fontSize(bodyFontSize)
          doc.text(affilParts.join(', '), {
            align: 'center',
            width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
          })
        }
        if (a.email) {
          doc.font(fonts.regular).fontSize(bodyFontSize)
          doc.text(a.email, {
            align: 'center',
            width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
          })
        }
        if (authorIdx < meta.authors!.length - 1) {
          doc.moveDown(0.6)
        } else {
          doc.moveDown(0.4)
        }
      })
      if (groupIdx < spec.titlePage.groups.length - 1) {
        doc.y += gapBetweenGroups
      }
      return
    }
    for (const element of group) {
      const line = resolveTitleElement(element, meta, spec)
      if (!line) continue
      const isTitle = element === 'title'
      const text = spec.titlePage.titleUppercase && isTitle ? line.toUpperCase() : line

      doc
        .font(isTitle ? fonts.bold : fonts.regular)
        .fontSize(
          isTitle
            ? getFormatDefaults(format).coverTitleSize
            : getFormatDefaults(format).bodyFontSize
        )

      doc.text(text, {
        align: 'center',
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      })
      doc.moveDown(0.4)
    }
    if (groupIdx < spec.titlePage.groups.length - 1) {
      doc.y += gapBetweenGroups
    }
  })

  doc.addPage()
}

function resolveTitleElement(
  element: TitlePageElement,
  meta: AcademicMeta,
  _spec: StructuralSpec
): string | null {
  switch (element) {
    case 'institution_tr_header':
      if (!meta.institution) return null
      if (meta.isStateUniversity === false) {
        return meta.institution.toUpperCase()
      }
      return `T.C.\n${meta.institution.toUpperCase()}`
    case 'institution':
      return meta.institution
    case 'department':
      return meta.department
    case 'title':
      return meta.title
    case 'subtitle':
      return meta.subtitle ?? null
    case 'author':
      return meta.author
    case 'advisor':
      return meta.advisor
        ? `${meta.advisorLabel ?? 'Danışman:'} ${meta.advisor}`
        : null
    case 'degree_type':
      return meta.degreeType ?? null
    case 'course':
      return meta.course ?? null
    case 'instructor':
      return meta.instructor ?? null
    case 'date':
      return meta.date
    case 'city_and_date':
      return [meta.city, meta.date].filter(Boolean).join(', ') || null
    case 'affiliation':
      return [meta.department, meta.institution].filter(Boolean).join(', ') || null
  }
}

// =================================================================
//  ABSTRACT
// =================================================================

export function renderAbstractPages(
  doc: Doc,
  format: CitationFormat,
  meta: AcademicMeta,
  fonts: FontBundle,
  bodyFontSize: number
): void {
  const spec = getStructuralSpec(format)
  if (!spec.abstract.enabled) return

  const heading = headingPt(format)
  // Abstract body alignment follows the format's textAlign so the
  // abstract reads the same as the manuscript body. Vancouver / APA /
  // Chicago / AMA = 'left'; IEEE / Harvard / ISNAD = 'justify'.
  const bodyAlign: 'left' | 'justify' =
    getFormatDefaults(format).textAlign === 'justify' ? 'justify' : 'left'
  if (spec.abstract.dualLanguage && meta.abstractTr) {
    renderOneAbstract(
      doc,
      spec.abstract.labelUppercase ? 'ÖZET' : 'Özet',
      meta.abstractTr,
      'Anahtar Kelimeler',
      meta.keywordsTr,
      fonts,
      bodyFontSize,
      heading,
      bodyAlign
    )
    doc.addPage()
  }

  const englishBody = meta.abstractEn || (!spec.abstract.dualLanguage ? meta.abstractTr : null)
  if (englishBody) {
    // For dual-language formats (ISNAD) the second page is the English
    // abstract — its label is always "Abstract" / "ABSTRACT", regardless
    // of the format's primary `abstract.label` (which is the TR label).
    const englishLabel = spec.abstract.dualLanguage
      ? (spec.abstract.labelUppercase ? 'ABSTRACT' : 'Abstract')
      : (spec.abstract.labelUppercase ? spec.abstract.label.toUpperCase() : spec.abstract.label)
    renderOneAbstract(
      doc,
      englishLabel,
      englishBody,
      spec.abstract.dualLanguage ? 'Keywords' : spec.abstract.keywordsLabel,
      spec.abstract.dualLanguage ? meta.keywordsEn : (meta.keywordsEn.length > 0 ? meta.keywordsEn : meta.keywordsTr),
      fonts,
      bodyFontSize,
      heading,
      bodyAlign
    )
    doc.addPage()
  }
}

function renderOneAbstract(
  doc: Doc,
  label: string,
  body: string,
  keywordsLabel: string,
  keywords: string[],
  fonts: FontBundle,
  bodyFontSize: number,
  headingFontSize: number,
  bodyAlign: 'left' | 'justify',
): void {
  doc.font(fonts.bold).fontSize(headingFontSize)
  doc.text(label, { align: 'center' })
  doc.moveDown(1)

  doc.fontSize(bodyFontSize)
  for (const para of body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)) {
    const m = para.match(/^([A-Z][A-Za-z][A-Za-z, ]{1,38}\.)\s+(.*)$/)
    if (m) {
      doc.font(fonts.bold).text(`${m[1]} `, { continued: true })
      doc.font(fonts.regular).text(m[2], { align: bodyAlign, lineGap: 2 })
    } else {
      doc.font(fonts.regular).text(para, { align: bodyAlign, lineGap: 2 })
    }
    doc.moveDown(0.4)
  }

  if (keywords.length > 0) {
    doc.moveDown(0.6)
    doc.font(fonts.bold).fontSize(bodyFontSize)
    doc.text(`${keywordsLabel}: `, { continued: true })
    doc.font(fonts.regular)
    doc.text(keywords.join(', '))
  }
}

// =================================================================
//  LIST OF TABLES / FIGURES (PDF)
// =================================================================

import type { CaptionRecord } from './captions'
import { listPageTitle } from './captions'

export function renderListPage(
  doc: Doc,
  format: CitationFormat,
  kind: 'table' | 'figure' | 'equation',
  records: CaptionRecord[],
  fonts: FontBundle,
  bodyFontSize: number,
  language: string | null,
): void {
  if (records.length === 0) return

  const fmtDefaults = getFormatDefaults(format)
  doc.font(fonts.bold).fontSize(fmtDefaults.chapterTitleSize)
  doc.text(listPageTitle(kind, language), { align: 'center' })
  doc.moveDown(1)

  doc.fontSize(bodyFontSize)
  for (const rec of records) {
    const isTable = rec.kind === 'table'
    const isEq = rec.kind === 'equation'
    const trWord = isTable ? 'Tablo' : isEq ? 'Eşitlik' : 'Şekil'
    const enWord = isTable ? 'Table' : isEq ? 'Equation' : 'Figure'
    const word = language?.toLowerCase().startsWith('tr') ? trWord : enWord
    doc.font(fonts.bold).text(`${word} ${rec.number}: `, { continued: true })
    doc.font(fonts.regular).text(rec.caption, { lineGap: 2 })
    doc.moveDown(0.3)
  }
  doc.addPage()
}

/**
 * Inline caption renderer used right after a table / figure block.
 * Bold label, italic caption text, centered.
 */
export function renderCaption(
  doc: Doc,
  kind: 'table' | 'figure' | 'equation',
  number: number,
  caption: string,
  fonts: FontBundle,
  bodyFontSize: number,
  language: string | null,
): void {
  const isTable = kind === 'table'
  const isEq = kind === 'equation'
  const trWord = isTable ? 'Tablo' : isEq ? 'Eşitlik' : 'Şekil'
  const enWord = isTable ? 'Table' : isEq ? 'Equation' : 'Figure'
  const word = language?.toLowerCase().startsWith('tr') ? trWord : enWord
  doc.moveDown(0.3)
  doc.fontSize(bodyFontSize)
  doc.font(fonts.bold).text(`${word} ${number}`, { continued: !!caption, align: 'center' })
  if (caption) {
    doc.font(fonts.italic).text(`. ${caption}`, { align: 'center' })
  }
  doc.moveDown(0.5)
}

// =================================================================
//  AMA KEY POINTS + SUBMISSION INFO PAGES (PDF)
// =================================================================

/**
 * Renders the AMA "Key Points" call-out (Question / Findings / Meaning)
 * on its own page. No-op when no key points are populated.
 */
export function renderKeyPointsPage(
  doc: Doc,
  format: CitationFormat,
  meta: AcademicMeta,
  fonts: FontBundle,
  bodyFontSize: number
): void {
  const kp = meta.submission?.keyPoints
  if (!kp || (!kp.question && !kp.findings && !kp.meaning)) return
  doc.font(fonts.bold).fontSize(headingPt(format))
  doc.text('Key Points', { align: 'center' })
  doc.moveDown(1)
  doc.fontSize(bodyFontSize)
  const row = (label: string, text: string | null) => {
    if (!text) return
    doc.font(fonts.bold).text(`${label} `, { continued: true })
    doc.font(fonts.regular).text(text, { lineGap: 2 })
    doc.moveDown(0.4)
  }
  row('Question.', kp.question)
  row('Findings.', kp.findings)
  row('Meaning.', kp.meaning)
  doc.addPage()
}

/**
 * Renders the manuscript-information page (Vancouver / AMA): short
 * title, word counts, table/figure counts, conflict-of-interest, funding
 * and trial-registration values. No-op when no submission fields exist.
 */
export function renderSubmissionInfoPage(
  doc: Doc,
  format: CitationFormat,
  meta: AcademicMeta,
  fonts: FontBundle,
  bodyFontSize: number
): void {
  const sub = meta.submission
  if (!sub) return
  const fields: Array<[string, string | null]> = [
    ['Short title', sub.shortTitle ?? null],
    ['Abstract word count', sub.wordCountAbstract != null ? String(sub.wordCountAbstract) : null],
    ['Manuscript word count', sub.wordCountText != null ? String(sub.wordCountText) : null],
    ['Tables', sub.tableCount != null ? String(sub.tableCount) : null],
    ['Figures', sub.figureCount != null ? String(sub.figureCount) : null],
    ['Conflict of interest', sub.conflictOfInterest ?? null],
    ['Funding', sub.funding ?? null],
    ['Trial registration', sub.trialRegistration ?? null],
  ]
  const present = fields.filter(([, v]) => v && String(v).trim().length > 0)
  if (present.length === 0) return

  doc.font(fonts.bold).fontSize(headingPt(format))
  doc.text('Manuscript Information', { align: 'center' })
  doc.moveDown(1)
  doc.fontSize(bodyFontSize)
  for (const [label, value] of present) {
    doc.font(fonts.bold).text(`${label}: `, { continued: true })
    doc.font(fonts.regular).text(String(value), { lineGap: 2 })
    doc.moveDown(0.4)
  }
  doc.addPage()
}

// =================================================================
//  TABLE OF CONTENTS
// =================================================================

export function renderTableOfContents(
  doc: Doc,
  format: CitationFormat,
  entries: TocEntry[],
  fonts: FontBundle
): void {
  const spec = getStructuralSpec(format)
  if (!spec.toc.enabled) return

  doc.font(fonts.bold).fontSize(getFormatDefaults(format).chapterTitleSize)
  doc.text(spec.toc.labelUppercase ? spec.toc.label.toUpperCase() : spec.toc.label, { align: 'center' })
  doc.moveDown(1)

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right

  for (const entry of entries) {
    if (!spec.toc.includeSections && entry.depth === 1) continue
    if (!spec.toc.includeSubsections && entry.depth === 2) continue

    doc.font(entry.depth === 0 ? fonts.bold : fonts.regular).fontSize(getFormatDefaults(format).bodyFontSize)
    const indent = entry.depth * 18

    const xStart = doc.page.margins.left + indent
    const pageStr = entry.page !== undefined ? String(entry.page) : ''

    // Measure text to draw dot leaders
    const labelWidth = doc.widthOfString(entry.label)
    const pageStrWidth = pageStr ? doc.widthOfString(pageStr) : 0
    const available = pageWidth - indent - labelWidth - pageStrWidth - 10

    if (spec.toc.dotLeaders && pageStr && available > 10) {
      const dotWidth = doc.widthOfString('. ')
      const dotCount = Math.max(3, Math.floor(available / dotWidth))
      const leader = ' ' + '.'.repeat(dotCount)
      doc.text(entry.label + leader, xStart, doc.y, { width: pageWidth - indent - pageStrWidth - 4, continued: true })
      doc.text(pageStr, { align: 'right' })
    } else {
      doc.text(entry.label + (pageStr ? `  ${pageStr}` : ''), xStart, doc.y, {
        width: pageWidth - indent,
      })
    }
    doc.moveDown(0.1)
  }

  doc.addPage()
}

// =================================================================
//  CHAPTER OPENING
// =================================================================

export function renderChapterOpening(
  doc: Doc,
  format: CitationFormat,
  chapterNumber: number,
  chapterTitle: string,
  isFirst: boolean,
  fonts: FontBundle,
  chapterTitleSize: number
): void {
  const spec = getStructuralSpec(format)
  const c = spec.chapter
  if (c.newPage && !isFirst) doc.addPage()

  const numberStr = formatChapterNumber(chapterNumber, c.numberStyle, c.titleUppercase)
  const titleStr = c.titleUppercase ? chapterTitle.toUpperCase() : chapterTitle
  const align = c.align === 'center' ? 'center' : 'left'

  // Numeric / Roman intro styles render inline on a single line
  // ("1. Title" / "I. INTRODUCTION") rather than on two separate lines.
  const isInline = c.numberStyle === 'numeric' || c.numberStyle === 'roman-intro'

  if (numberStr && !isInline) {
    doc.font(fonts.bold).fontSize(chapterTitleSize - 2)
    doc.text(numberStr, { align })
    for (let i = 0; i < Math.max(1, c.gapAfterNumber); i++) doc.moveDown(0.4)
  }

  doc.font(fonts.bold).fontSize(chapterTitleSize)
  doc.text(numberStr && isInline ? `${numberStr}. ${titleStr}` : titleStr, { align })
  for (let i = 0; i < Math.max(1, c.gapAfterTitle); i++) doc.moveDown(0.4)
}

// =================================================================
//  BIBLIOGRAPHY HEADER
// =================================================================

export function getBibliographyHeaderText(format: CitationFormat): string {
  const spec = getStructuralSpec(format)
  return spec.bibliography.labelUppercase
    ? spec.bibliography.label.toUpperCase()
    : spec.bibliography.label
}

export function getBibliographyHeaderAlign(format: CitationFormat): 'left' | 'center' {
  return getStructuralSpec(format).bibliography.align
}

// =================================================================
//  PAGE-NUMBER FORMATTING
// =================================================================

/**
 * Format a page number per the format's spec for either front matter or
 * body. `frontMatterMode` is true while rendering title/abstract/TOC.
 */
export function formatPageNumber(
  format: CitationFormat,
  pageIndexInSection: number,
  frontMatterMode: boolean
): string {
  const spec = getStructuralSpec(format)
  const style = frontMatterMode ? spec.pagination.frontMatter : spec.pagination.body
  switch (style) {
    case 'arabic':
      return String(pageIndexInSection)
    case 'lower-roman':
      return toRoman(pageIndexInSection, false)
    case 'upper-roman':
      return toRoman(pageIndexInSection, true)
    case 'none':
      return ''
  }
}

// =================================================================
//  RUNNING HEAD
// =================================================================

export function renderRunningHead(
  doc: Doc,
  format: CitationFormat,
  pageNumber: number,
  surname: string | null,
  fonts: FontBundle
): void {
  const spec = getStructuralSpec(format)
  if (!spec.runningHead.enabled) return

  const text =
    spec.runningHead.content === 'surname-page' && surname
      ? `${surname} ${pageNumber}`
      : spec.runningHead.content === 'page-only'
      ? String(pageNumber)
      : ''
  if (!text) return

  const prevY = doc.y
  doc.font(fonts.regular).fontSize(11)
  doc.text(text, doc.page.margins.left, 36, {
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
    align: spec.runningHead.position === 'top-right' ? 'right' : 'center',
  })
  doc.y = prevY
}
