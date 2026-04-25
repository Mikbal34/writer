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
  const topReserve = format === 'ISNAD' ? pageHeight * 0.12 : pageHeight * 0.2
  doc.y = topReserve

  const gapBetweenGroups = format === 'ISNAD' ? 12 : 20

  spec.titlePage.groups.forEach((group, groupIdx) => {
    for (const element of group) {
      const line = resolveTitleElement(element, meta, spec)
      if (!line) continue
      const isTitle = element === 'title'
      const text = spec.titlePage.titleUppercase && isTitle ? line.toUpperCase() : line

      doc
        .font(isTitle ? fonts.bold : fonts.regular)
        .fontSize(isTitle ? 18 : 12)

      // `institution_tr_header` may contain a newline.
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

  if (spec.abstract.dualLanguage && meta.abstractTr) {
    renderOneAbstract(
      doc,
      spec.abstract.labelUppercase ? 'ÖZET' : 'Özet',
      meta.abstractTr,
      'Anahtar Kelimeler',
      meta.keywordsTr,
      fonts,
      bodyFontSize
    )
    doc.addPage()
  }

  const englishBody = meta.abstractEn || (!spec.abstract.dualLanguage ? meta.abstractTr : null)
  if (englishBody) {
    renderOneAbstract(
      doc,
      spec.abstract.labelUppercase ? spec.abstract.label.toUpperCase() : spec.abstract.label,
      englishBody,
      spec.abstract.keywordsLabel,
      spec.abstract.dualLanguage ? meta.keywordsEn : (meta.keywordsEn.length > 0 ? meta.keywordsEn : meta.keywordsTr),
      fonts,
      bodyFontSize
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
  bodyFontSize: number
): void {
  doc.font(fonts.bold).fontSize(16)
  doc.text(label, { align: 'center' })
  doc.moveDown(1)

  doc.font(fonts.regular).fontSize(bodyFontSize)
  for (const para of body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)) {
    doc.text(para, { align: 'justify', lineGap: 2 })
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

  doc.font(fonts.bold).fontSize(16)
  doc.text(spec.toc.labelUppercase ? spec.toc.label.toUpperCase() : spec.toc.label, { align: 'center' })
  doc.moveDown(1)

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right

  for (const entry of entries) {
    if (!spec.toc.includeSections && entry.depth === 1) continue
    if (!spec.toc.includeSubsections && entry.depth === 2) continue

    doc.font(entry.depth === 0 ? fonts.bold : fonts.regular).fontSize(11)
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

  if (numberStr) {
    doc.font(fonts.bold).fontSize(chapterTitleSize - 2)
    doc.text(numberStr, { align })
    for (let i = 0; i < Math.max(1, c.gapAfterNumber); i++) doc.moveDown(0.4)
  }

  doc.font(fonts.bold).fontSize(chapterTitleSize)
  doc.text(titleStr, { align })
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
