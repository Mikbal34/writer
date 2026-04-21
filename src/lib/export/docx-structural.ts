/**
 * DOCX structural builders — produce `Paragraph[]` chunks for the title
 * page, abstract page(s), table of contents, chapter opening, and
 * bibliography header. Each builder looks up the format's rules in
 * `./structural-specs` and renders text accordingly.
 *
 * These builders are intentionally decoupled from the main content
 * rendering loop; the export route calls them in the correct order for
 * ACADEMIC projects to assemble a complete document.
 */

import {
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageBreak,
  TabStopType,
  TabStopPosition,
} from 'docx'
import type { CitationFormat } from '@prisma/client'
import {
  getStructuralSpec,
  formatChapterNumber,
  type StructuralSpec,
  type TitlePageElement,
  type ChapterOpeningSpec,
} from './structural-specs'

// =================================================================
//  ACADEMIC METADATA — shape we receive from the project model
// =================================================================

export interface AcademicMeta {
  title: string
  author: string | null
  institution: string | null
  department: string | null
  advisor: string | null
  abstractTr: string | null
  abstractEn: string | null
  keywordsTr: string[]
  keywordsEn: string[]
  acknowledgments: string | null
  dedication: string | null
  language: string | null
  /** Rendered on ISNAD title page; caller passes current year if absent. */
  date: string
  /** "Yüksek Lisans Tezi" / "Doktora Tezi" — ISNAD only today. */
  degreeType?: string | null
  course?: string | null
  instructor?: string | null
  city?: string | null
}

// =================================================================
//  TITLE PAGE
// =================================================================

export function buildTitlePage(format: CitationFormat, meta: AcademicMeta): Paragraph[] {
  const spec = getStructuralSpec(format)
  if (!spec.titlePage.enabled) return []

  const paragraphs: Paragraph[] = []

  // A rough vertical spacer so the block sits around the upper third for
  // most formats. ISNAD starts higher; we emit a smaller spacer for it.
  const topSpacerLines = format === 'ISNAD' ? 4 : 8
  for (let i = 0; i < topSpacerLines; i++) {
    paragraphs.push(new Paragraph({ children: [new TextRun({ text: '' })] }))
  }

  const gapBetweenGroups = format === 'ISNAD' ? 2 : 4

  spec.titlePage.groups.forEach((group, groupIdx) => {
    for (const element of group) {
      const line = resolveTitleElement(element, meta, spec)
      if (!line) continue
      const isTitle = element === 'title'
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: spec.titlePage.titleUppercase && isTitle ? line.toUpperCase() : line,
              bold: isTitle,
              size: isTitle ? 32 : 24,
              font: 'Times New Roman',
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
        })
      )
    }
    if (groupIdx < spec.titlePage.groups.length - 1) {
      for (let i = 0; i < gapBetweenGroups; i++) {
        paragraphs.push(new Paragraph({ children: [new TextRun({ text: '' })] }))
      }
    }
  })

  paragraphs.push(new Paragraph({ children: [new PageBreak()] }))
  return paragraphs
}

/** Turn a `TitlePageElement` name into the actual string to print. */
function resolveTitleElement(
  element: TitlePageElement,
  meta: AcademicMeta,
  _spec: StructuralSpec
): string | null {
  switch (element) {
    case 'institution_tr_header':
      return meta.institution ? `T.C.\n${meta.institution.toUpperCase()}` : null
    case 'institution':
      return meta.institution
    case 'department':
      return meta.department
    case 'title':
      return meta.title
    case 'subtitle':
      return null // we don't track subtitle separately yet
    case 'author':
      return meta.author ? meta.author : null
    case 'advisor':
      return meta.advisor ? `Danışman: ${meta.advisor}` : null
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

export function buildAbstractPages(format: CitationFormat, meta: AcademicMeta): Paragraph[] {
  const spec = getStructuralSpec(format)
  if (!spec.abstract.enabled) return []

  const paragraphs: Paragraph[] = []

  // Turkish özet first (when dual-language), then English abstract.
  if (spec.abstract.dualLanguage && meta.abstractTr) {
    paragraphs.push(...renderAbstractPage(
      spec.abstract.labelUppercase ? 'ÖZET' : 'Özet',
      meta.abstractTr,
      'Anahtar Kelimeler',
      meta.keywordsTr
    ))
    paragraphs.push(new Paragraph({ children: [new PageBreak()] }))
  }

  const englishBody = meta.abstractEn || (!spec.abstract.dualLanguage ? meta.abstractTr : null)
  if (englishBody) {
    paragraphs.push(...renderAbstractPage(
      spec.abstract.labelUppercase ? spec.abstract.label.toUpperCase() : spec.abstract.label,
      englishBody,
      spec.abstract.keywordsLabel,
      spec.abstract.dualLanguage ? meta.keywordsEn : (meta.keywordsEn.length > 0 ? meta.keywordsEn : meta.keywordsTr)
    ))
    paragraphs.push(new Paragraph({ children: [new PageBreak()] }))
  }

  return paragraphs
}

function renderAbstractPage(label: string, body: string, keywordsLabel: string, keywords: string[]): Paragraph[] {
  const out: Paragraph[] = []
  out.push(
    new Paragraph({
      children: [new TextRun({ text: label, bold: true, size: 28, font: 'Times New Roman' })],
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
    })
  )
  for (const para of body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)) {
    out.push(
      new Paragraph({
        children: [new TextRun({ text: para, size: 24, font: 'Times New Roman' })],
        spacing: { after: 120, line: 360 },
        alignment: AlignmentType.JUSTIFIED,
      })
    )
  }
  if (keywords.length > 0) {
    out.push(
      new Paragraph({
        children: [
          new TextRun({ text: `${keywordsLabel}: `, bold: true, size: 24, font: 'Times New Roman' }),
          new TextRun({ text: keywords.join(', '), size: 24, font: 'Times New Roman' }),
        ],
        spacing: { before: 200 },
      })
    )
  }
  return out
}

// =================================================================
//  TABLE OF CONTENTS (static, rendered from known chapter structure)
// =================================================================

export interface TocEntry {
  label: string   // "1. Introduction" or "1.1 Background"
  page?: number   // optional; omit if we don't track page numbers yet
  depth: 0 | 1 | 2 // chapter / section / subsection
}

export function buildTableOfContents(format: CitationFormat, entries: TocEntry[]): Paragraph[] {
  const spec = getStructuralSpec(format)
  if (!spec.toc.enabled) return []

  const paragraphs: Paragraph[] = []
  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({
          text: spec.toc.labelUppercase ? spec.toc.label.toUpperCase() : spec.toc.label,
          bold: true,
          size: 28,
          font: 'Times New Roman',
        }),
      ],
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
    })
  )

  for (const entry of entries) {
    if (!spec.toc.includeSections && entry.depth === 1) continue
    if (!spec.toc.includeSubsections && entry.depth === 2) continue

    const indent = entry.depth * 360 // 0.25" per level in twips
    const runs: TextRun[] = [
      new TextRun({ text: entry.label, size: 22, font: 'Times New Roman', bold: entry.depth === 0 }),
    ]
    if (entry.page !== undefined) {
      runs.push(new TextRun({ text: `\t${entry.page}`, size: 22, font: 'Times New Roman' }))
    }
    paragraphs.push(
      new Paragraph({
        children: runs,
        spacing: { after: 60 },
        indent: indent > 0 ? { left: indent } : undefined,
        tabStops: spec.toc.dotLeaders
          ? [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX, leader: 'dot' }]
          : undefined,
      })
    )
  }

  paragraphs.push(new Paragraph({ children: [new PageBreak()] }))
  return paragraphs
}

// =================================================================
//  CHAPTER OPENING
// =================================================================

export function buildChapterOpening(
  format: CitationFormat,
  chapterNumber: number,
  chapterTitle: string,
  isFirst: boolean
): Paragraph[] {
  const spec = getStructuralSpec(format)
  const c: ChapterOpeningSpec = spec.chapter
  const paragraphs: Paragraph[] = []

  if (c.newPage && !isFirst) {
    paragraphs.push(new Paragraph({ children: [new PageBreak()] }))
  }

  const numberStr = formatChapterNumber(chapterNumber, c.numberStyle, c.titleUppercase)
  const titleStr = c.titleUppercase ? chapterTitle.toUpperCase() : chapterTitle

  const align =
    c.align === 'center'
      ? AlignmentType.CENTER
      : AlignmentType.LEFT

  if (numberStr) {
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: numberStr, bold: true, size: 28, font: 'Times New Roman' })],
        heading: HeadingLevel.HEADING_1,
        alignment: align,
        spacing: { after: 120 * Math.max(1, c.gapAfterNumber) },
      })
    )
  }

  paragraphs.push(
    new Paragraph({
      children: [new TextRun({ text: titleStr, bold: true, size: 32, font: 'Times New Roman' })],
      heading: numberStr ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_1,
      alignment: align,
      spacing: { after: 120 * Math.max(1, c.gapAfterTitle) },
    })
  )

  return paragraphs
}

// =================================================================
//  BIBLIOGRAPHY HEADER
// =================================================================

export function buildBibliographyHeader(format: CitationFormat): Paragraph {
  const spec = getStructuralSpec(format)
  const label = spec.bibliography.labelUppercase
    ? spec.bibliography.label.toUpperCase()
    : spec.bibliography.label
  return new Paragraph({
    children: [new TextRun({ text: label, bold: true, size: 32, font: 'Times New Roman' })],
    heading: HeadingLevel.HEADING_1,
    alignment: spec.bibliography.align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { after: 300 },
  })
}

// =================================================================
//  FRONT-MATTER EXTRAS: dedication, acknowledgments
// =================================================================

export function buildDedicationPage(text: string | null): Paragraph[] {
  if (!text?.trim()) return []
  return [
    // Push the text toward the middle of the page.
    ...Array.from({ length: 10 }, () => new Paragraph({ children: [new TextRun({ text: '' })] })),
    new Paragraph({
      children: [new TextRun({ text, italics: true, size: 24, font: 'Times New Roman' })],
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ]
}

export function buildAcknowledgmentsPage(format: CitationFormat, text: string | null): Paragraph[] {
  if (!text?.trim()) return []
  const spec = getStructuralSpec(format)
  const label = format === 'ISNAD' ? 'ÖNSÖZ' : 'Acknowledgments'
  const upper = format === 'ISNAD' || spec.toc.labelUppercase

  const out: Paragraph[] = []
  out.push(
    new Paragraph({
      children: [new TextRun({ text: upper ? label.toUpperCase() : label, bold: true, size: 28, font: 'Times New Roman' })],
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
    })
  )
  for (const para of text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)) {
    out.push(
      new Paragraph({
        children: [new TextRun({ text: para, size: 24, font: 'Times New Roman' })],
        spacing: { after: 120, line: 360 },
        alignment: AlignmentType.JUSTIFIED,
      })
    )
  }
  out.push(new Paragraph({ children: [new PageBreak()] }))
  return out
}

// =================================================================
//  MLA FIRST-PAGE INFO BLOCK (no separate title page)
// =================================================================

export function buildMlaInfoBlock(meta: AcademicMeta): Paragraph[] {
  const out: Paragraph[] = []
  const lines = [
    meta.author,
    meta.instructor,
    meta.course,
    meta.date,
  ].filter(Boolean) as string[]
  for (const line of lines) {
    out.push(
      new Paragraph({
        children: [new TextRun({ text: line, size: 24, font: 'Times New Roman' })],
        spacing: { after: 0, line: 480 },
      })
    )
  }
  out.push(
    new Paragraph({
      children: [new TextRun({ text: meta.title, size: 24, font: 'Times New Roman' })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 240, after: 240 },
    })
  )
  return out
}
