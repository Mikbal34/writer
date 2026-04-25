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

/**
 * Vancouver / AMA submission-info page block. Rendered after the abstract
 * page when present. None of the fields are required individually — the
 * builder skips a row whose value is null.
 */
export interface SubmissionMeta {
  shortTitle?: string | null
  wordCountAbstract?: number | null
  wordCountText?: number | null
  tableCount?: number | null
  figureCount?: number | null
  conflictOfInterest?: string | null
  funding?: string | null
  trialRegistration?: string | null
  /** AMA-only: the three-bullet Key Points box that prints above the abstract. */
  keyPoints?: { question: string | null; findings: string | null; meaning: string | null } | null
  /** AMA-only: the format identifier so the builder can label the page header. */
  formatLabel?: 'Vancouver' | 'AMA'
}

export interface AcademicMeta {
  title: string
  subtitle?: string | null
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
  /** "Yüksek Lisans Tezi" / "Doktora Tezi" / "Master of Arts" / etc. */
  degreeType?: string | null
  course?: string | null
  instructor?: string | null
  city?: string | null
  /** ISNAD: false suppresses the "T.C." prefix on the title page. */
  isStateUniversity?: boolean
  /** Localised label for the advisor line. Defaults to "Danışman:" when omitted. */
  advisorLabel?: string
  /** Vancouver / AMA only — drives the manuscript-info page after the abstract. */
  submission?: SubmissionMeta | null
}

// =================================================================
//  TITLE PAGE
// =================================================================

export function buildTitlePage(format: CitationFormat, meta: AcademicMeta): Paragraph[] {
  const spec = getStructuralSpec(format)
  if (!spec.titlePage.enabled) return []

  const paragraphs: Paragraph[] = []

  // Vertical spacer above the title block. ISNAD prints the institution
  // header right at the top so the spacer is small; journal formats
  // (IEEE / Vancouver / AMA) place the title near the top of the page;
  // student-paper formats centre the block lower.
  const topSpacerLines =
    format === 'ISNAD' ? 4
    : format === 'IEEE' || format === 'VANCOUVER' || format === 'AMA' ? 2
    : 6
  for (let i = 0; i < topSpacerLines; i++) {
    paragraphs.push(new Paragraph({ children: [new TextRun({ text: '' })] }))
  }

  const gapBetweenGroups = format === 'ISNAD' ? 2 : 3

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
              color: '000000',
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
      // Skip the "T.C." prefix when the project is hosted by a private
      // (non-state) university — the meta carries an explicit toggle.
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
      return meta.author ? meta.author : null
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

/**
 * Detects a structured-abstract paragraph that begins with a label like
 * "Background.", "Methods.", "Importance.", etc. Returns the label plus
 * trailing space and the remainder, so the renderer can emit the label
 * as a bold run followed by the regular-weight body — Vancouver / AMA
 * structured abstract convention.
 */
function splitStructuredLabel(para: string): { label: string; body: string } | null {
  const m = para.match(/^([A-Z][A-Za-z][A-Za-z, ]{1,38}\.)\s+(.*)$/)
  if (!m) return null
  return { label: m[1], body: m[2] }
}

function renderAbstractPage(label: string, body: string, keywordsLabel: string, keywords: string[]): Paragraph[] {
  const out: Paragraph[] = []
  out.push(
    new Paragraph({
      children: [new TextRun({ text: label, bold: true, size: 28, font: 'Times New Roman', color: '000000' })],
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
    })
  )
  for (const para of body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)) {
    const structured = splitStructuredLabel(para)
    const runs = structured
      ? [
          new TextRun({ text: `${structured.label} `, bold: true, size: 24, font: 'Times New Roman', color: '000000' }),
          new TextRun({ text: structured.body, size: 24, font: 'Times New Roman', color: '000000' }),
        ]
      : [new TextRun({ text: para, size: 24, font: 'Times New Roman', color: '000000' })]
    out.push(
      new Paragraph({
        children: runs,
        spacing: { after: 120, line: 360 },
        // Modern Vancouver / APA / Chicago all recommend left-aligned
        // (NOT justified) for the abstract — justified abstracts read
        // awkwardly with the inline bold labels and uneven word gaps.
        alignment: AlignmentType.LEFT,
      })
    )
  }
  if (keywords.length > 0) {
    out.push(
      new Paragraph({
        children: [
          new TextRun({ text: `${keywordsLabel}: `, bold: true, size: 24, font: 'Times New Roman', color: '000000' }),
          new TextRun({ text: keywords.join(', '), size: 24, font: 'Times New Roman', color: '000000' }),
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
      new TextRun({ text: entry.label, size: 22, font: 'Times New Roman', color: '000000', bold: entry.depth === 0 }),
    ]
    if (entry.page !== undefined) {
      runs.push(new TextRun({ text: `\t${entry.page}`, size: 22, font: 'Times New Roman', color: '000000' }))
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

  // Numbering styles like 'numeric' and 'roman-intro' are conventionally
  // rendered inline with the title on a single Heading 1 line ("1. Title"
  // or "I. INTRODUCTION"). The traditional "Chapter N" / "BİRİNCİ BÖLÜM"
  // styles still render on their own line above the title.
  const isInline = c.numberStyle === 'numeric' || c.numberStyle === 'roman-intro'

  if (numberStr && !isInline) {
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: numberStr, bold: true, size: 28, font: 'Times New Roman', color: '000000' })],
        heading: HeadingLevel.HEADING_1,
        alignment: align,
        spacing: { after: 120 * Math.max(1, c.gapAfterNumber) },
      })
    )
  }

  const inlineHeadingText = numberStr && isInline
    ? `${numberStr}. ${titleStr}`
    : titleStr

  paragraphs.push(
    new Paragraph({
      children: [new TextRun({ text: inlineHeadingText, bold: true, size: 32, font: 'Times New Roman', color: '000000' })],
      heading: numberStr && !isInline ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_1,
      alignment: align,
      spacing: { after: 120 * Math.max(1, c.gapAfterTitle) },
    })
  )

  return paragraphs
}

// =================================================================
//  AMA KEY POINTS BOX
// =================================================================

/**
 * AMA prescribes a "Key Points" call-out above the abstract: three short
 * sentences (Question / Findings / Meaning), each prefixed with a bold
 * label. Renders as a compact block on its own page, before the abstract.
 */
export function buildKeyPointsPage(meta: AcademicMeta): Paragraph[] {
  const kp = meta.submission?.keyPoints
  if (!kp || (!kp.question && !kp.findings && !kp.meaning)) return []
  const out: Paragraph[] = []
  out.push(
    new Paragraph({
      children: [new TextRun({ text: 'Key Points', bold: true, size: 28, font: 'Times New Roman', color: '000000' })],
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
    })
  )
  const row = (label: string, text: string | null) => {
    if (!text) return
    out.push(
      new Paragraph({
        children: [
          new TextRun({ text: `${label} `, bold: true, size: 24, font: 'Times New Roman', color: '000000' }),
          new TextRun({ text, size: 24, font: 'Times New Roman', color: '000000' }),
        ],
        spacing: { after: 120, line: 320 },
      })
    )
  }
  row('Question.', kp.question)
  row('Findings.', kp.findings)
  row('Meaning.', kp.meaning)
  out.push(new Paragraph({ children: [new PageBreak()] }))
  return out
}

// =================================================================
//  SUBMISSION-INFO PAGE  (Vancouver / AMA)
// =================================================================

/**
 * Renders a "Manuscript Information" page after the abstract for
 * Vancouver / AMA exports. Lists the running short title, word counts,
 * table/figure counts, conflict of interest statement, funding source,
 * and trial registration number — the standard submission packet
 * journals expect alongside the manuscript itself.
 */
export function buildSubmissionInfoPage(meta: AcademicMeta): Paragraph[] {
  const sub = meta.submission
  if (!sub) return []
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
  if (present.length === 0) return []

  const out: Paragraph[] = []
  out.push(
    new Paragraph({
      children: [new TextRun({ text: 'Manuscript Information', bold: true, size: 28, font: 'Times New Roman', color: '000000' })],
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
    })
  )
  for (const [label, value] of present) {
    out.push(
      new Paragraph({
        children: [
          new TextRun({ text: `${label}: `, bold: true, size: 24, font: 'Times New Roman', color: '000000' }),
          new TextRun({ text: String(value), size: 24, font: 'Times New Roman', color: '000000' }),
        ],
        spacing: { after: 120, line: 320 },
      })
    )
  }
  out.push(new Paragraph({ children: [new PageBreak()] }))
  return out
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
    children: [new TextRun({ text: label, bold: true, size: 32, font: 'Times New Roman', color: '000000' })],
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
      children: [new TextRun({ text, italics: true, size: 24, font: 'Times New Roman', color: '000000' })],
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
      children: [new TextRun({ text: upper ? label.toUpperCase() : label, bold: true, size: 28, font: 'Times New Roman', color: '000000' })],
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
    })
  )
  for (const para of text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)) {
    out.push(
      new Paragraph({
        children: [new TextRun({ text: para, size: 24, font: 'Times New Roman', color: '000000' })],
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
        children: [new TextRun({ text: line, size: 24, font: 'Times New Roman', color: '000000' })],
        spacing: { after: 0, line: 480 },
      })
    )
  }
  out.push(
    new Paragraph({
      children: [new TextRun({ text: meta.title, size: 24, font: 'Times New Roman', color: '000000' })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 240, after: 240 },
    })
  )
  return out
}
