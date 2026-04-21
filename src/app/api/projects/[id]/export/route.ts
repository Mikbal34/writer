import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getCitationFormatter, CitationFormatter } from '@/lib/citations/formatter'
import {
  createResolverState,
  resolveInlineCitations,
  orderEntriesForBibliography,
  type InlineResolverState,
} from '@/lib/citations/inline-resolver'
import {
  buildTitlePage,
  buildAbstractPages,
  buildTableOfContents,
  buildChapterOpening,
  buildBibliographyHeader,
  buildDedicationPage,
  buildAcknowledgmentsPage,
  buildMlaInfoBlock,
  type AcademicMeta,
  type TocEntry,
} from '@/lib/export/docx-structural'
import {
  renderTitlePage,
  renderAbstractPages,
  renderTableOfContents,
  renderChapterOpening,
  getBibliographyHeaderText,
  getBibliographyHeaderAlign,
} from '@/lib/export/pdf-structural'
import { getStructuralSpec } from '@/lib/export/structural-specs'
import type { BibliographyEntry } from '@/types/bibliography'
import type { CitationFormat } from '@prisma/client'
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  FootnoteReferenceRun,
  AlignmentType,
  PageBreak,
  convertInchesToTwip,
  Table as DocxTable,
  TableRow as DocxTableRow,
  TableCell as DocxTableCell,
  WidthType,
  BorderStyle,
} from 'docx'
import PDFDocument from 'pdfkit'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

type RouteContext = { params: Promise<{ id: string }> }

// Language-aware labels for export
const EXPORT_LABELS: Record<string, { chapter: string; bibliography: string; notWritten: string }> = {
  tr: { chapter: 'Bölüm', bibliography: 'Kaynakça', notWritten: '[Bu alt bölüm henüz yazılmadı]' },
  en: { chapter: 'Chapter', bibliography: 'Bibliography', notWritten: '[This subsection has not been written yet]' },
  ar: { chapter: 'الفصل', bibliography: 'المراجع', notWritten: '[لم يُكتب هذا القسم بعد]' },
  de: { chapter: 'Kapitel', bibliography: 'Literaturverzeichnis', notWritten: '[Dieser Abschnitt wurde noch nicht geschrieben]' },
  fr: { chapter: 'Chapitre', bibliography: 'Bibliographie', notWritten: "[Cette sous-section n'a pas encore été rédigée]" },
}

function getLabels(language?: string | null) {
  return EXPORT_LABELS[language ?? 'en'] ?? EXPORT_LABELS.en
}

// ---------------------------------------------------------------------------
// Parse [fn: ...] markers from content
// ---------------------------------------------------------------------------
interface ContentBlock {
  text: string
  footnote?: string
}

function parseContent(content: string): ContentBlock[] {
  const blocks: ContentBlock[] = []
  const regex = /\[fn:\s*([^\]]+)\]/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({ text: content.slice(lastIndex, match.index) })
    }
    blocks.push({ text: '', footnote: match[1].trim() })
    lastIndex = regex.lastIndex
  }

  if (lastIndex < content.length) {
    blocks.push({ text: content.slice(lastIndex) })
  }

  return blocks
}

// ---------------------------------------------------------------------------
// Parse inline markdown (bold, italic, bold+italic) into styled TextRuns
// ---------------------------------------------------------------------------
function parseInlineRuns(text: string, fontSize: number, baseOpts?: { bold?: boolean; italic?: boolean }): TextRun[] {
  // Split by bold+italic (***), bold (**), italic (*), preserving delimiters
  const parts = text.split(/((?:\*\*\*).+?(?:\*\*\*)|(?:\*\*).+?(?:\*\*)|(?:\*).+?(?:\*))/g)
  return parts.filter(Boolean).map(part => {
    let bold = baseOpts?.bold ?? false
    let italic = baseOpts?.italic ?? false
    let content = part

    if (part.startsWith('***') && part.endsWith('***')) {
      bold = true
      italic = true
      content = part.slice(3, -3)
    } else if (part.startsWith('**') && part.endsWith('**')) {
      bold = true
      content = part.slice(2, -2)
    } else if (part.startsWith('*') && part.endsWith('*')) {
      italic = true
      content = part.slice(1, -1)
    }

    return new TextRun({
      text: content,
      bold,
      italics: italic,
      size: fontSize,
      font: 'Times New Roman',
    })
  })
}

// Backward-compatible alias
function parseMarkdownRuns(text: string, fontSize: number): TextRun[] {
  return parseInlineRuns(text, fontSize)
}

// ---------------------------------------------------------------------------
// Markdown block types for structured content parsing
// ---------------------------------------------------------------------------
type MdBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: 2 | 3; text: string }
  | { type: 'bullet_list'; items: string[] }
  | { type: 'ordered_list'; items: string[] }
  | { type: 'blockquote'; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'hr' }

function parseMarkdownBlocks(content: string): MdBlock[] {
  const blocks: MdBlock[] = []
  const rawBlocks = content.split(/\n{2,}/)

  for (const raw of rawBlocks) {
    const trimmed = raw.trim()
    if (!trimmed) continue

    // Horizontal rule
    if (/^---+$/.test(trimmed)) {
      blocks.push({ type: 'hr' })
      continue
    }

    // Headings
    if (trimmed.startsWith('### ')) {
      blocks.push({ type: 'heading', level: 3, text: trimmed.slice(4) })
      continue
    }
    if (trimmed.startsWith('## ')) {
      blocks.push({ type: 'heading', level: 2, text: trimmed.slice(3) })
      continue
    }

    // Table detection
    const lines = trimmed.split('\n')
    if (lines.length >= 2 && lines[0].includes('|') && /^\|[\s:*-]+(\|[\s:*-]+)*\|?$/.test(lines[1].trim())) {
      const parseCells = (row: string) => row.split('|').slice(1, -1).map(c => c.trim())
      const headers = parseCells(lines[0])
      const rows = lines.slice(2).filter(l => l.includes('|')).map(parseCells)
      blocks.push({ type: 'table', headers, rows })
      continue
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      const text = lines.map(l => l.replace(/^>\s?/, '')).join(' ')
      blocks.push({ type: 'blockquote', text })
      continue
    }

    // Unordered list
    if (/^[-*]\s/.test(trimmed)) {
      const items = lines.filter(l => /^[-*]\s/.test(l.trim())).map(l => l.replace(/^[-*]\s+/, '').trim())
      if (items.length > 0) {
        blocks.push({ type: 'bullet_list', items })
        continue
      }
    }

    // Ordered list
    if (/^\d+\.\s/.test(trimmed)) {
      const items = lines.filter(l => /^\d+\.\s/.test(l.trim())).map(l => l.replace(/^\d+\.\s+/, '').trim())
      if (items.length > 0) {
        blocks.push({ type: 'ordered_list', items })
        continue
      }
    }

    // Regular paragraph
    blocks.push({ type: 'paragraph', text: trimmed })
  }

  return blocks
}

// ---------------------------------------------------------------------------
// Build DOCX document
// ---------------------------------------------------------------------------
interface SubsectionData {
  subsectionId: string
  subsectionDbId: string
  title: string
  content: string | null
  sectionTitle: string
  chapterTitle: string
  chapterNumber: number
  chapterId: string
  isLastInChapter: boolean
}

/**
 * Everything buildDocx / buildPdf need for the academic front matter +
 * per-chapter opening + headers. `title` is supplied separately (it's
 * already threaded through the builder signatures).
 */
type AcademicStructuralInput = Omit<AcademicMeta, 'title'>



function buildDocx(
  projectTitle: string,
  subsections: SubsectionData[],
  bibliography: BibliographyEntry[],
  formatter: CitationFormatter,
  includeBibliography: boolean,
  language?: string | null,
  academic?: AcademicStructuralInput | null,
  format: CitationFormat = 'ISNAD'
): Document {
  const labels = getLabels(language)
  const footnotes: Record<number, { children: Paragraph[] }> = {}
  let footnoteCounter = 1
  let currentChapter = ''
  let currentSection = ''
  let chapterIndex = 0

  const children: Paragraph[] = []

  // Structural front matter (academic projects only). For non-academic or
  // when the toggle is off, fall back to a single plain title page.
  if (academic) {
    const spec = getStructuralSpec(format)
    const meta: AcademicMeta = { ...academic, title: projectTitle }

    if (spec.titlePage.enabled) {
      children.push(...buildTitlePage(format, meta))
    }
    children.push(...buildDedicationPage(meta.dedication))
    children.push(...buildAcknowledgmentsPage(format, meta.acknowledgments))
    children.push(...buildAbstractPages(format, meta))

    // Build TOC entries from subsection data.
    const tocEntries: TocEntry[] = []
    const seenChapters = new Set<string>()
    const seenSections = new Set<string>()
    for (const sub of subsections) {
      if (!seenChapters.has(sub.chapterTitle)) {
        seenChapters.add(sub.chapterTitle)
        tocEntries.push({
          label: `${sub.chapterNumber}. ${sub.chapterTitle}`,
          depth: 0,
        })
      }
      const sectionKey = `${sub.chapterTitle}/${sub.sectionTitle}`
      if (!seenSections.has(sectionKey)) {
        seenSections.add(sectionKey)
        tocEntries.push({ label: sub.sectionTitle, depth: 1 })
      }
      tocEntries.push({ label: `${sub.subsectionId} ${sub.title}`, depth: 2 })
    }
    children.push(...buildTableOfContents(format, tocEntries))
  } else {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: projectTitle, bold: true, size: 36, font: 'Times New Roman' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 600 },
      })
    )
    children.push(new Paragraph({ children: [new PageBreak()] }))
  }

  for (const sub of subsections) {
    // Chapter heading — structural builders when academic, simple heading otherwise.
    if (sub.chapterTitle !== currentChapter) {
      currentChapter = sub.chapterTitle
      currentSection = '' // reset section
      if (academic) {
        children.push(
          ...buildChapterOpening(format, sub.chapterNumber, sub.chapterTitle, chapterIndex === 0)
        )
        // MLA renders the author/instructor/course block on the first
        // page of the body (no separate title page).
        if (chapterIndex === 0 && format === 'MLA') {
          const meta: AcademicMeta = { ...academic, title: projectTitle }
          children.unshift(...buildMlaInfoBlock(meta))
        }
        chapterIndex++
      } else {
        if (children.length > 2) {
          children.push(new Paragraph({ children: [new PageBreak()] }))
        }
        children.push(
          new Paragraph({
            children: [new TextRun({ text: `${labels.chapter} ${sub.chapterNumber}: ${sub.chapterTitle}`, bold: true, size: 32, font: 'Times New Roman', color: '000000' })],
            heading: HeadingLevel.HEADING_1,
            spacing: { after: 300 },
          })
        )
      }
    }

    // Section heading
    if (sub.sectionTitle !== currentSection) {
      currentSection = sub.sectionTitle
      children.push(
        new Paragraph({
          children: [new TextRun({ text: sub.sectionTitle, bold: true, size: 28, font: 'Times New Roman', color: '000000' })],
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 200 },
        })
      )
    }

    // Subsection heading
    children.push(
      new Paragraph({
        children: [new TextRun({ text: sub.title, bold: true, size: 26, font: 'Times New Roman', color: '000000' })],
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 150, after: 100 },
      })
    )

    // Content with rich formatting
    if (sub.content) {
      const mdBlocks = parseMarkdownBlocks(sub.content)

      // Helper: build inline runs with footnote support
      function buildRunsWithFootnotes(text: string, fontSize: number, baseOpts?: { bold?: boolean }): (TextRun | FootnoteReferenceRun)[] {
        const contentBlocks = parseContent(text)
        const runs: (TextRun | FootnoteReferenceRun)[] = []
        for (const block of contentBlocks) {
          if (block.text) {
            runs.push(...parseInlineRuns(block.text, fontSize, baseOpts))
          }
          if (block.footnote) {
            const fnId = footnoteCounter++
            footnotes[fnId] = {
              children: [
                new Paragraph({ children: parseInlineRuns(block.footnote, 20) }),
              ],
            }
            runs.push(new FootnoteReferenceRun(fnId))
          }
        }
        return runs
      }

      for (const mdBlock of mdBlocks) {
        switch (mdBlock.type) {
          case 'paragraph': {
            children.push(
              new Paragraph({
                children: buildRunsWithFootnotes(mdBlock.text, 24),
                spacing: { after: 120, line: 360 },
                indent: { firstLine: convertInchesToTwip(0.5) },
              })
            )
            break
          }
          case 'heading': {
            children.push(
              new Paragraph({
                children: [new TextRun({ text: mdBlock.text, bold: true, size: mdBlock.level === 2 ? 28 : 26, font: 'Times New Roman', color: '000000' })],
                heading: mdBlock.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
                spacing: { before: 200, after: 100 },
              })
            )
            break
          }
          case 'bullet_list': {
            for (const item of mdBlock.items) {
              children.push(
                new Paragraph({
                  children: buildRunsWithFootnotes(item, 24),
                  bullet: { level: 0 },
                  spacing: { after: 60 },
                  indent: { left: convertInchesToTwip(0.5) },
                })
              )
            }
            break
          }
          case 'ordered_list': {
            for (let li = 0; li < mdBlock.items.length; li++) {
              children.push(
                new Paragraph({
                  children: [
                    new TextRun({ text: `${li + 1}. `, size: 24, font: 'Times New Roman' }),
                    ...buildRunsWithFootnotes(mdBlock.items[li], 24),
                  ],
                  spacing: { after: 60 },
                  indent: { left: convertInchesToTwip(0.5) },
                })
              )
            }
            break
          }
          case 'blockquote': {
            children.push(
              new Paragraph({
                children: buildRunsWithFootnotes(mdBlock.text, 24, { bold: false }),
                spacing: { after: 120, line: 360 },
                indent: { left: convertInchesToTwip(0.5), right: convertInchesToTwip(0.5) },
                border: {
                  left: { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 8 },
                },
              })
            )
            break
          }
          case 'table': {
            const allRows = [mdBlock.headers, ...mdBlock.rows]
            const colCount = mdBlock.headers.length || 1
            const table = new DocxTable({
              rows: allRows.map((cells, rowIdx) =>
                new DocxTableRow({
                  children: cells.map(cell =>
                    new DocxTableCell({
                      children: [
                        new Paragraph({
                          children: parseInlineRuns(cell, 22, rowIdx === 0 ? { bold: true } : undefined),
                          spacing: { after: 40 },
                        }),
                      ],
                      width: { size: Math.floor(100 / colCount), type: WidthType.PERCENTAGE },
                    })
                  ),
                })
              ),
              width: { size: 100, type: WidthType.PERCENTAGE },
            })
            children.push(new Paragraph({ spacing: { after: 60 } })) // gap before table
            children.push(table as unknown as Paragraph) // docx sections accept tables in children
            children.push(new Paragraph({ spacing: { after: 120 } })) // gap after table
            break
          }
          case 'hr': {
            children.push(
              new Paragraph({
                children: [new TextRun({ text: '' })],
                border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' } },
                spacing: { before: 200, after: 200 },
              })
            )
            break
          }
        }
      }
    } else {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: labels.notWritten,
              italics: true,
              color: '999999',
              size: 24,
              font: 'Times New Roman',
            }),
          ],
          spacing: { after: 120 },
        })
      )
    }
  }

  // Bibliography section — use the format's own label ("References" /
  // "Works Cited" / "KAYNAKÇA" / "Bibliography" / …) when available.
  if (includeBibliography && bibliography.length > 0) {
    children.push(new Paragraph({ children: [new PageBreak()] }))
    if (academic) {
      children.push(buildBibliographyHeader(format))
    } else {
      children.push(
        new Paragraph({
          text: labels.bibliography,
          heading: HeadingLevel.HEADING_1,
          spacing: { after: 300 },
        })
      )
    }

    // `bibliography` arrives already ordered by the caller (POST handler):
    // citation-order for numeric formats, insertion order for the rest.
    // Per-format alphabetical sort happens on the formatted strings.
    const formatted = bibliography.map((entry) => formatter.formatBibliographyEntry(entry))
    const ordered = CitationFormatter.orderBibliography(formatted, formatter)
    const prefix = formatter.bibliographyPrefix

    ordered.forEach((item, idx) => {
      const prefixStr = CitationFormatter.renderPrefix(idx, prefix)
      const runs: TextRun[] = []
      if (prefixStr) {
        runs.push(new TextRun({ text: prefixStr, size: 24, font: 'Times New Roman' }))
      }
      // parseInlineRuns turns `*italic*` markdown into italic TextRuns.
      runs.push(...parseInlineRuns(item.entry, 24))
      children.push(
        new Paragraph({
          children: runs,
          spacing: { after: 80 },
          indent: prefix === 'bracket'
            ? { left: convertInchesToTwip(0.5) }
            : { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.5) },
        })
      )
    })
  }

  return new Document({
    footnotes,
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1),
            },
          },
        },
        children,
      },
    ],
  })
}

// ---------------------------------------------------------------------------
// Resolve Unicode-capable font family for PDF generation (platform-aware)
// Returns { regular, bold, italic, boldItalic } paths or empty strings
// ---------------------------------------------------------------------------
interface PdfFontFamily {
  regular: string
  bold: string
  italic: string
  boldItalic: string
}

function resolvePdfFontFamily(): PdfFontFamily {
  const fs = require('fs')

  // Priority 1: Bundled DejaVu Serif — try multiple possible root directories
  // (process.cwd() can differ between dev, build, and Railway runtime)
  const possibleRoots = [
    process.cwd(),
    path.join(process.cwd(), '.next', 'standalone'),
    path.resolve('.'),
    '/app', // Railway default working directory
  ]

  for (const root of possibleRoots) {
    const bundledDir = path.join(root, 'public', 'fonts')
    const bundled: PdfFontFamily = {
      regular: path.join(bundledDir, 'DejaVuSerif.ttf'),
      bold: path.join(bundledDir, 'DejaVuSerif-Bold.ttf'),
      italic: path.join(bundledDir, 'DejaVuSerif-Italic.ttf'),
      boldItalic: path.join(bundledDir, 'DejaVuSerif-BoldItalic.ttf'),
    }
    try {
      fs.accessSync(bundled.regular)
      console.log(`[export] Found bundled fonts at: ${bundledDir}`)
      return bundled
    } catch { /* try next root */ }
  }
  console.warn('[export] Bundled fonts not found in any root directory, trying system fonts')

  // Priority 2: Allow override via env var
  if (process.env.PDF_FONT_PATH) {
    return { regular: process.env.PDF_FONT_PATH, bold: process.env.PDF_FONT_PATH, italic: process.env.PDF_FONT_PATH, boldItalic: process.env.PDF_FONT_PATH }
  }

  // Priority 3: System Times New Roman
  const tnrFamilies = [
    {
      regular: '/System/Library/Fonts/Supplemental/Times New Roman.ttf',
      bold: '/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf',
      italic: '/System/Library/Fonts/Supplemental/Times New Roman Italic.ttf',
      boldItalic: '/System/Library/Fonts/Supplemental/Times New Roman Bold Italic.ttf',
    },
    {
      regular: '/Library/Fonts/Times New Roman.ttf',
      bold: '/Library/Fonts/Times New Roman Bold.ttf',
      italic: '/Library/Fonts/Times New Roman Italic.ttf',
      boldItalic: '/Library/Fonts/Times New Roman Bold Italic.ttf',
    },
  ]

  for (const family of tnrFamilies) {
    try {
      fs.accessSync(family.regular)
      const result: PdfFontFamily = { regular: family.regular, bold: family.regular, italic: family.regular, boldItalic: family.regular }
      try { fs.accessSync(family.bold); result.bold = family.bold } catch { /* use regular */ }
      try { fs.accessSync(family.italic); result.italic = family.italic } catch { /* use regular */ }
      try { fs.accessSync(family.boldItalic); result.boldItalic = family.boldItalic } catch { /* use regular */ }
      return result
    } catch { /* try next family */ }
  }

  // Priority 4: Any system Unicode font
  const singleFonts = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
    '/usr/share/fonts/dejavu-serif-fonts/DejaVuSerif.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf',
  ]
  for (const p of singleFonts) {
    try { fs.accessSync(p); return { regular: p, bold: p, italic: p, boldItalic: p } } catch { /* skip */ }
  }

  return { regular: '', bold: '', italic: '', boldItalic: '' }
}

// ---------------------------------------------------------------------------
// Build PDF document — with proper fonts, italic support, and page footnotes
// ---------------------------------------------------------------------------

/** Render mixed plain/italic text using *markdown* markers */
function pdfRichText(
  doc: InstanceType<typeof PDFDocument>,
  text: string,
  fonts: { regular: string; italic: string },
  options: { fontSize: number; lineGap?: number; indent?: number; align?: string },
) {
  const parts = text.split(/(\*[^*]+\*)/g).filter(Boolean)
  const leftMargin = doc.page.margins.left
  const startX = leftMargin + (options.indent ?? 0)
  const width = (doc.page.width - leftMargin - doc.page.margins.right) - (options.indent ?? 0)

  // If no italic markers, render as plain text (faster path)
  if (parts.length === 1 && !parts[0].startsWith('*')) {
    doc.font(fonts.regular).fontSize(options.fontSize)
    doc.text(text, startX, undefined, { width, align: options.align as any, lineGap: options.lineGap })
    return
  }

  // Mixed italic/regular — use doc.text continuation
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    const isItalic = part.startsWith('*') && part.endsWith('*')
    const content = isItalic ? part.slice(1, -1) : part
    const font = isItalic ? fonts.italic : fonts.regular

    doc.font(font).fontSize(options.fontSize)

    if (i === 0) {
      doc.text(content, startX, undefined, {
        width,
        align: options.align as any,
        lineGap: options.lineGap,
        continued: i < parts.length - 1,
      })
    } else {
      doc.text(content, {
        width,
        align: options.align as any,
        lineGap: options.lineGap,
        continued: i < parts.length - 1,
      })
    }
  }
}

interface ProjectImageData {
  imageData: Buffer
  chapterId: string | null
  subsectionId: string | null
  sortOrder: number
  layout: string
  position: string
}

interface BookDesignSettings {
  bodyFontSize?: number
  headingFontSize?: number
  lineHeight?: number
  paragraphSpacing?: number
  firstLineIndent?: number
  textAlign?: string
  pageSize?: string
  marginTop?: number
  marginBottom?: number
  marginLeft?: number
  marginRight?: number
  chapterTitleSize?: number
  chapterTitleAlign?: string
  sectionTitleSize?: number
  subsectionTitleSize?: number
  textColor?: string
  headingColor?: string
  showPageNumbers?: boolean
  showChapterDivider?: boolean
  imageLayout?: string
  imageWidthPercent?: number
  imagePosition?: string
}

const PAGE_SIZES: Record<string, [number, number]> = {
  'A4': [595.28, 841.89],
  'A5': [419.53, 595.28],
  'B5': [498.90, 708.66],
  '6x9': [432, 648],
  '5x8': [360, 576],
}

function buildPdf(
  projectTitle: string,
  subsections: SubsectionData[],
  bibliography: BibliographyEntry[],
  formatter: CitationFormatter,
  includeBibliography: boolean,
  language?: string | null,
  images?: ProjectImageData[],
  design?: BookDesignSettings | null,
  academic?: AcademicStructuralInput | null,
  format: CitationFormat = 'ISNAD'
): Promise<Buffer> {
  const labels = getLabels(language)
  const d = design ?? {}

  // Page dimensions from design settings
  const pageDimensions = PAGE_SIZES[d.pageSize ?? 'A4'] ?? PAGE_SIZES['A4']
  const mTop = d.marginTop ?? 72
  const mBottom = d.marginBottom ?? 72
  const mLeft = d.marginLeft ?? 72
  const mRight = d.marginRight ?? 72

  return new Promise((resolve, reject) => {
    const fontFamily = resolvePdfFontFamily()
    const hasCustomFont = !!fontFamily.regular

    const doc = new PDFDocument({
      size: pageDimensions as [number, number],
      margins: { top: mTop, bottom: mBottom, left: mLeft, right: mRight },
      bufferPages: true,
      info: { Title: projectTitle },
    })

    // Register font variants with error handling
    let fontsRegistered = hasCustomFont
    if (hasCustomFont) {
      try {
        doc.registerFont('main', fontFamily.regular)
        doc.registerFont('main-bold', fontFamily.bold || fontFamily.regular)
        doc.registerFont('main-italic', fontFamily.italic || fontFamily.regular)
        doc.registerFont('main-bolditalic', fontFamily.boldItalic || fontFamily.regular)
        console.log('[export] Custom fonts registered successfully')
      } catch (fontErr) {
        console.error('[export] Font registration failed, falling back to Helvetica:', fontErr)
        fontsRegistered = false
      }
    }
    const fonts = {
      regular: fontsRegistered ? 'main' : 'Helvetica',
      bold: fontsRegistered ? 'main-bold' : 'Helvetica-Bold',
      italic: fontsRegistered ? 'main-italic' : 'Helvetica-Oblique',
      boldItalic: fontsRegistered ? 'main-bolditalic' : 'Helvetica-BoldOblique',
    }

    const bufferChunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => bufferChunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(bufferChunks)))
    doc.on('error', reject)

    // ---- Page-bottom footnote tracking ----
    const PAGE_HEIGHT = pageDimensions[1]
    const PAGE_WIDTH = pageDimensions[0]
    const MARGIN_BOTTOM = mBottom
    const MARGIN_LEFT = mLeft
    const CONTENT_BOTTOM = PAGE_HEIGHT - MARGIN_BOTTOM
    const FOOTNOTE_FONT_SIZE = 8.5
    const FOOTNOTE_LINE_GAP = 1.5
    const FOOTNOTE_SEPARATOR_HEIGHT = 15 // space for the separator line + padding
    const CONTENT_WIDTH = PAGE_WIDTH - mLeft - mRight

    // Font sizes from design settings
    const BODY_SIZE = d.bodyFontSize ?? 11
    const CHAPTER_SIZE = d.chapterTitleSize ?? 18
    const SECTION_SIZE = d.sectionTitleSize ?? 14
    const SUBSECTION_SIZE = d.subsectionTitleSize ?? 12
    const LINE_GAP = Math.round((d.lineHeight ?? 1.5) * BODY_SIZE - BODY_SIZE)
    const PARA_INDENT = d.firstLineIndent ?? 36

    // Per-page footnote storage
    const pageFootnotes: Map<number, Array<{ num: number; text: string }>> = new Map()
    // How much space is reserved for footnotes on each page (grows from bottom up)
    const pageFootnoteSpace: Map<number, number> = new Map()
    let globalFootnoteCounter = 1

    function getCurrentPageIndex(): number {
      const range = doc.bufferedPageRange()
      return range.start + range.count - 1
    }

    /** Get the Y coordinate below which content should not go on current page */
    function getContentFloor(): number {
      const pageIdx = getCurrentPageIndex()
      const reserved = pageFootnoteSpace.get(pageIdx) ?? 0
      return CONTENT_BOTTOM - reserved
    }

    /** Reserve footnote space on the current page and record footnote */
    function addPageFootnote(num: number, text: string): void {
      const pageIdx = getCurrentPageIndex()
      // Calculate height this footnote will need
      doc.font(fonts.regular).fontSize(FOOTNOTE_FONT_SIZE)
      const fnHeight = doc.heightOfString(`${num}. ${text}`, {
        width: CONTENT_WIDTH,
        lineGap: FOOTNOTE_LINE_GAP,
      }) + 3 // padding between footnotes

      const currentReserved = pageFootnoteSpace.get(pageIdx) ?? 0
      const isFirstOnPage = currentReserved === 0
      const extraHeight = isFirstOnPage ? FOOTNOTE_SEPARATOR_HEIGHT : 0

      pageFootnoteSpace.set(pageIdx, currentReserved + fnHeight + extraHeight)

      if (!pageFootnotes.has(pageIdx)) pageFootnotes.set(pageIdx, [])
      pageFootnotes.get(pageIdx)!.push({ num, text })
    }

    /** Check if adding text would overflow into footnote area; if so, add page */
    function ensureSpace(neededHeight: number): void {
      if (doc.y + neededHeight > getContentFloor()) {
        doc.addPage()
      }
    }

    // ---- Cover / Title page ----
    // Priority: explicit cover image (story books) > academic title page
    // > plain text title.
    const coverImage = images?.find((img) => img.sortOrder === -1)
    if (coverImage) {
      try {
        doc.image(coverImage.imageData, 0, 0, { width: PAGE_WIDTH, height: PAGE_HEIGHT })
        doc.addPage()
      } catch {
        doc.font(fonts.bold).fontSize(24)
        doc.text(projectTitle, { align: 'center' })
        doc.addPage()
      }
    } else if (academic) {
      const meta: AcademicMeta = { ...academic, title: projectTitle }
      renderTitlePage(doc, format, meta, fonts)
      renderAbstractPages(doc, format, meta, fonts, BODY_SIZE)
      // Build TOC entries from subsection list (flat pass).
      const tocEntries: TocEntry[] = []
      const seenChapters = new Set<string>()
      const seenSections = new Set<string>()
      for (const sub of subsections) {
        if (!seenChapters.has(sub.chapterTitle)) {
          seenChapters.add(sub.chapterTitle)
          tocEntries.push({ label: `${sub.chapterNumber}. ${sub.chapterTitle}`, depth: 0 })
        }
        const secKey = `${sub.chapterTitle}/${sub.sectionTitle}`
        if (!seenSections.has(secKey)) {
          seenSections.add(secKey)
          tocEntries.push({ label: sub.sectionTitle, depth: 1 })
        }
        tocEntries.push({ label: `${sub.subsectionId} ${sub.title}`, depth: 2 })
      }
      renderTableOfContents(doc, format, tocEntries, fonts)
    } else {
      doc.font(fonts.bold).fontSize(24)
      doc.text(projectTitle, { align: 'center' })
      doc.addPage()
    }

    let currentChapter = ''
    let currentSection = ''
    let chapterIdx = 0

    for (const sub of subsections) {
      // Chapter heading — delegate to structural builder when academic.
      if (sub.chapterTitle !== currentChapter) {
        currentChapter = sub.chapterTitle
        currentSection = ''
        if (academic) {
          renderChapterOpening(
            doc,
            format,
            sub.chapterNumber,
            sub.chapterTitle,
            chapterIdx === 0,
            fonts,
            CHAPTER_SIZE
          )
          chapterIdx++
        } else {
          if (doc.y > 100) doc.addPage()
          doc.font(fonts.bold).fontSize(CHAPTER_SIZE)
          doc.text(`${labels.chapter} ${sub.chapterNumber}: ${sub.chapterTitle}`, { align: 'left' })
          doc.moveDown(0.5)
        }

      }

      // Section heading
      if (sub.sectionTitle !== currentSection) {
        currentSection = sub.sectionTitle
        doc.font(fonts.bold).fontSize(SECTION_SIZE)
        ensureSpace(30)
        doc.text(sub.sectionTitle)
        doc.moveDown(0.3)
      }

      // Subsection heading
      doc.font(fonts.bold).fontSize(SUBSECTION_SIZE)
      ensureSpace(25)
      doc.text(sub.title)
      doc.moveDown(0.2)

      // Helper: render an image based on its layout type
      function renderImage(img: ProjectImageData) {
        try {
          if (img.layout === 'full_page') {
            doc.addPage()
            const maxW = CONTENT_WIDTH
            const maxH = PAGE_HEIGHT - 72 - 72
            doc.image(img.imageData, MARGIN_LEFT, 72, {
              fit: [maxW, maxH],
              align: 'center',
              valign: 'center',
            })
            doc.addPage()
          } else if (img.layout === 'half_page') {
            ensureSpace(PAGE_HEIGHT * 0.4)
            const halfH = PAGE_HEIGHT * 0.35
            doc.image(img.imageData, MARGIN_LEFT + CONTENT_WIDTH * 0.1, undefined, {
              fit: [CONTENT_WIDTH * 0.8, halfH],
              align: 'center',
            })
            doc.moveDown(0.5)
          } else {
            // inline: smaller image within text flow
            ensureSpace(200)
            doc.image(img.imageData, MARGIN_LEFT + CONTENT_WIDTH * 0.15, undefined, {
              fit: [CONTENT_WIDTH * 0.7, 250],
              align: 'center',
            })
            doc.moveDown(0.5)
          }
        } catch (imgErr) {
          console.error('[export] Failed to embed image:', imgErr)
        }
      }

      // Insert "before" images for this subsection
      if (images && images.length > 0) {
        const beforeImages = images.filter(
          (img) => img.subsectionId === sub.subsectionDbId && img.position === 'before' && img.sortOrder >= 0
        )
        for (const img of beforeImages) renderImage(img)
      }

      // Content with rich formatting
      if (sub.content) {
        const mdBlocks = parseMarkdownBlocks(sub.content)

        // Helper: extract footnotes and return text with [N] markers
        function extractFootnotes(text: string): string {
          const blocks = parseContent(text)
          let result = ''
          for (const block of blocks) {
            if (block.text) result += block.text
            if (block.footnote) {
              const num = globalFootnoteCounter++
              addPageFootnote(num, block.footnote)
              result += `[${num}]`
            }
          }
          return result
        }

        for (const mdBlock of mdBlocks) {
          switch (mdBlock.type) {
            case 'paragraph': {
              const plainText = extractFootnotes(mdBlock.text).trim()
              doc.font(fonts.regular).fontSize(BODY_SIZE)
              const paraHeight = doc.heightOfString(plainText, { width: CONTENT_WIDTH - PARA_INDENT, lineGap: LINE_GAP })
              ensureSpace(paraHeight + 10)
              pdfRichText(doc, plainText, { regular: fonts.regular, italic: fonts.italic }, {
                fontSize: BODY_SIZE,
                lineGap: LINE_GAP,
                indent: PARA_INDENT,
                align: d.textAlign ?? 'justify',
              })
              doc.moveDown(0.3)
              break
            }
            case 'heading': {
              const size = mdBlock.level === 2 ? SECTION_SIZE : SUBSECTION_SIZE
              doc.font(fonts.bold).fontSize(size)
              ensureSpace(size + 20)
              doc.text(mdBlock.text, { align: 'left' })
              doc.moveDown(0.3)
              break
            }
            case 'bullet_list': {
              for (const item of mdBlock.items) {
                const plainItem = extractFootnotes(item).trim()
                doc.font(fonts.regular).fontSize(BODY_SIZE)
                const itemHeight = doc.heightOfString(`\u2022  ${plainItem}`, { width: CONTENT_WIDTH - PARA_INDENT, lineGap: LINE_GAP })
                ensureSpace(itemHeight + 5)
                // Bullet character + text
                doc.font(fonts.regular).fontSize(BODY_SIZE)
                doc.text(`\u2022`, MARGIN_LEFT + PARA_INDENT * 0.5, undefined, { continued: true, lineGap: LINE_GAP })
                doc.text(`  ${plainItem}`, { width: CONTENT_WIDTH - PARA_INDENT, lineGap: LINE_GAP })
              }
              doc.moveDown(0.3)
              break
            }
            case 'ordered_list': {
              for (let li = 0; li < mdBlock.items.length; li++) {
                const plainItem = extractFootnotes(mdBlock.items[li]).trim()
                doc.font(fonts.regular).fontSize(BODY_SIZE)
                const itemHeight = doc.heightOfString(`${li + 1}. ${plainItem}`, { width: CONTENT_WIDTH - PARA_INDENT, lineGap: LINE_GAP })
                ensureSpace(itemHeight + 5)
                doc.text(`${li + 1}.`, MARGIN_LEFT + PARA_INDENT * 0.5, undefined, { continued: true, lineGap: LINE_GAP })
                doc.text(` ${plainItem}`, { width: CONTENT_WIDTH - PARA_INDENT, lineGap: LINE_GAP })
              }
              doc.moveDown(0.3)
              break
            }
            case 'blockquote': {
              const plainText = extractFootnotes(mdBlock.text).trim()
              doc.font(fonts.italic).fontSize(BODY_SIZE)
              const quoteHeight = doc.heightOfString(plainText, { width: CONTENT_WIDTH - PARA_INDENT * 2, lineGap: LINE_GAP })
              ensureSpace(quoteHeight + 15)
              // Draw left border
              const quoteY = doc.y
              doc.save()
              doc.strokeColor('#999999').lineWidth(2)
              doc.moveTo(MARGIN_LEFT + PARA_INDENT * 0.75, quoteY)
                .lineTo(MARGIN_LEFT + PARA_INDENT * 0.75, quoteY + quoteHeight + 4)
                .stroke()
              doc.restore()
              doc.font(fonts.italic).fontSize(BODY_SIZE)
              doc.text(plainText, MARGIN_LEFT + PARA_INDENT, undefined, {
                width: CONTENT_WIDTH - PARA_INDENT * 2,
                lineGap: LINE_GAP,
              })
              doc.moveDown(0.3)
              break
            }
            case 'table': {
              const allRows = [mdBlock.headers, ...mdBlock.rows]
              const colCount = mdBlock.headers.length || 1
              const colWidth = CONTENT_WIDTH / colCount
              const cellPadding = 4
              const tableFontSize = BODY_SIZE - 1

              // Calculate row heights
              doc.font(fonts.regular).fontSize(tableFontSize)
              const rowHeights = allRows.map(cells => {
                let maxH = 0
                for (const cell of cells) {
                  const h = doc.heightOfString(cell, { width: colWidth - cellPadding * 2 })
                  if (h > maxH) maxH = h
                }
                return maxH + cellPadding * 2
              })

              const totalHeight = rowHeights.reduce((a, b) => a + b, 0)
              ensureSpace(Math.min(totalHeight + 20, 200)) // at least start on this page

              for (let ri = 0; ri < allRows.length; ri++) {
                const rowH = rowHeights[ri]
                ensureSpace(rowH + 2)
                const startY = doc.y

                for (let ci = 0; ci < allRows[ri].length; ci++) {
                  const cellX = MARGIN_LEFT + ci * colWidth
                  // Draw cell border
                  doc.save()
                  doc.strokeColor('#CCCCCC').lineWidth(0.5)
                  doc.rect(cellX, startY, colWidth, rowH).stroke()
                  doc.restore()

                  // Header row: bold + background
                  if (ri === 0) {
                    doc.save()
                    doc.fillColor('#F5F5F5').rect(cellX, startY, colWidth, rowH).fill()
                    doc.restore()
                    doc.font(fonts.bold).fontSize(tableFontSize).fillColor('#000000')
                  } else {
                    doc.font(fonts.regular).fontSize(tableFontSize).fillColor('#000000')
                  }

                  doc.text(
                    allRows[ri][ci] ?? '',
                    cellX + cellPadding,
                    startY + cellPadding,
                    { width: colWidth - cellPadding * 2 }
                  )
                }

                doc.y = startY + rowH
              }
              doc.moveDown(0.5)
              break
            }
            case 'hr': {
              ensureSpace(20)
              doc.save()
              doc.strokeColor('#CCCCCC').lineWidth(0.5)
              doc.moveTo(MARGIN_LEFT + CONTENT_WIDTH * 0.2, doc.y)
                .lineTo(MARGIN_LEFT + CONTENT_WIDTH * 0.8, doc.y)
                .stroke()
              doc.restore()
              doc.moveDown(0.8)
              break
            }
          }
        }
      } else {
        doc.fillColor('#999999')
        doc.font(fonts.italic).fontSize(BODY_SIZE)
        doc.text(labels.notWritten)
        doc.fillColor('#000000')
      }

      // Insert "after" images for this subsection
      if (images && images.length > 0) {
        const afterImages = images.filter(
          (img) => img.subsectionId === sub.subsectionDbId && img.position === 'after' && img.sortOrder >= 0
        )
        for (const img of afterImages) renderImage(img)
      }

      // Also insert chapter-level images (no subsection) that haven't been placed yet
      // These go after the LAST subsection of that chapter
      if (images && images.length > 0 && sub.isLastInChapter) {
        const chapterOnlyImages = images.filter(
          (img) => img.chapterId === sub.chapterId && !img.subsectionId && img.sortOrder >= 0
        )
        for (const img of chapterOnlyImages) renderImage(img)
      }

      doc.moveDown(0.3)
    }

    // Bibliography
    if (includeBibliography && bibliography.length > 0) {
      doc.addPage()
      doc.font(fonts.bold).fontSize(CHAPTER_SIZE)
      if (academic) {
        doc.text(getBibliographyHeaderText(format), { align: getBibliographyHeaderAlign(format) })
      } else {
        doc.text(labels.bibliography, { align: 'left' })
      }
      doc.moveDown(0.5)

      const formatted = bibliography.map((entry) => formatter.formatBibliographyEntry(entry))
      const ordered = CitationFormatter.orderBibliography(formatted, formatter)
      const prefix = formatter.bibliographyPrefix

      doc.font(fonts.regular).fontSize(BODY_SIZE)
      ordered.forEach((item, idx) => {
        const prefixStr = CitationFormatter.renderPrefix(idx, prefix)
        const line = `${prefixStr}${item.entry}`
        // pdfRichText honours `*italic*` spans — renders them with the italic font.
        pdfRichText(doc, line, { regular: fonts.regular, italic: fonts.italic }, {
          fontSize: BODY_SIZE,
          lineGap: 2,
          indent: prefix === 'bracket' ? 36 : 0,
          align: 'left',
        })
        doc.moveDown(0.2)
      })
    }

    // ---- Render page-bottom footnotes (second pass via bufferPages) ----
    pageFootnotes.forEach((notes, pageIdx) => {
      doc.switchToPage(pageIdx)

      // Calculate total footnote block height
      doc.font(fonts.regular).fontSize(FOOTNOTE_FONT_SIZE)
      let totalHeight = FOOTNOTE_SEPARATOR_HEIGHT
      for (const note of notes) {
        totalHeight += doc.heightOfString(`${note.num}. ${note.text}`, {
          width: CONTENT_WIDTH,
          lineGap: FOOTNOTE_LINE_GAP,
        }) + 3
      }

      let y = CONTENT_BOTTOM - totalHeight

      // Draw separator line
      doc.save()
      doc.strokeColor('#000000').lineWidth(0.5)
      doc.moveTo(MARGIN_LEFT, y).lineTo(MARGIN_LEFT + 120, y).stroke()
      doc.restore()
      y += FOOTNOTE_SEPARATOR_HEIGHT - 5

      // Render each footnote
      doc.font(fonts.regular).fontSize(FOOTNOTE_FONT_SIZE)
      for (const note of notes) {
        const fnText = `${note.num}. ${note.text}`
        doc.text(fnText, MARGIN_LEFT, y, {
          width: CONTENT_WIDTH,
          lineGap: FOOTNOTE_LINE_GAP,
        })
        y += doc.heightOfString(fnText, {
          width: CONTENT_WIDTH,
          lineGap: FOOTNOTE_LINE_GAP,
        }) + 3
      }
    })

    doc.end()
  })
}

// ---------------------------------------------------------------------------
// POST /api/projects/[id]/export
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id: projectId } = await ctx.params

    const body = await req.json()
    const {
      scope = 'full',
      chapterId,
      subsectionId,
      includeBibliography = true,
      includeIllustrations = false,
      includeStructural = true,
      fileType = 'docx',
    } = body as {
      scope?: 'full' | 'chapter' | 'subsection'
      chapterId?: string
      subsectionId?: string
      includeBibliography?: boolean
      includeIllustrations?: boolean
      includeStructural?: boolean
      fileType?: 'docx' | 'pdf'
    }

    // Verify project ownership. We select the academic metadata fields
    // (author, institution, abstract, …) so the export can render the
    // format-specific title page / abstract / TOC without another round
    // trip. `as any` avoids a Prisma client regeneration lag in dev —
    // the fields are typed at the destination (`AcademicStructuralInput`).
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: session.user.id },
      select: {
        id: true,
        title: true,
        citationFormat: true,
        language: true,
        projectType: true,
        bookDesign: true,
        author: true,
        institution: true,
        department: true,
        advisor: true,
        abstractTr: true,
        abstractEn: true,
        keywordsTr: true,
        keywordsEn: true,
        acknowledgments: true,
        dedication: true,
      },
    }) as unknown as (
      | ({
          id: string
          title: string
          citationFormat: CitationFormat
          language: string | null
          projectType: string
          bookDesign: unknown
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
        })
      | null
    )
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Build where clause based on scope
    let chapterWhere: object = { projectId }
    if (scope === 'chapter' && chapterId) {
      chapterWhere = { projectId, id: chapterId }
    }

    // Fetch chapters with content
    const chapters = await prisma.chapter.findMany({
      where: chapterWhere,
      orderBy: { sortOrder: 'asc' },
      include: {
        sections: {
          orderBy: { sortOrder: 'asc' },
          include: {
            subsections: {
              orderBy: { sortOrder: 'asc' },
              ...(scope === 'subsection' && subsectionId
                ? { where: { id: subsectionId } }
                : {}),
            },
          },
        },
      },
    })

    // Flatten to subsection list
    const subsections: SubsectionData[] = []
    for (const ch of chapters) {
      // Collect all subsection ids for this chapter to mark the last one
      const allSubIds: string[] = []
      for (const sec of ch.sections) {
        for (const sub of sec.subsections) allSubIds.push(sub.id)
      }
      const lastSubId = allSubIds[allSubIds.length - 1]

      for (const sec of ch.sections) {
        for (const sub of sec.subsections) {
          subsections.push({
            subsectionId: sub.subsectionId,
            subsectionDbId: sub.id,
            title: sub.title,
            content: sub.content,
            sectionTitle: sec.title,
            chapterTitle: ch.title,
            chapterNumber: ch.number,
            chapterId: ch.id,
            isLastInChapter: sub.id === lastSubId,
          })
        }
      }
    }

    if (subsections.length === 0) {
      return NextResponse.json({ error: 'No subsections found for this scope' }, { status: 404 })
    }

    // Fetch bibliography entries. We always need the full set (even when
    // the bibliography section is suppressed) so inline `[cite:…]` markers
    // can resolve author/title/page info.
    const bibliography = (await prisma.bibliography.findMany({
      where: { projectId },
      orderBy: [{ authorSurname: 'asc' }, { year: 'asc' }],
    })) as unknown as BibliographyEntry[]

    // Get citation formatter
    const formatter = getCitationFormatter(project.citationFormat as CitationFormat)

    // Resolve `[cite:bibId,p=N]` markers inside each subsection. State is
    // shared across subsections so numeric formats keep stable reference
    // numbers and footnote formats track first-vs-subsequent correctly.
    const resolverState: InlineResolverState = createResolverState()
    for (const sub of subsections) {
      if (sub.content) {
        sub.content = resolveInlineCitations(
          sub.content,
          bibliography,
          formatter,
          resolverState
        )
      }
    }

    // Citation-order formats (IEEE / Vancouver / AMA) render the
    // bibliography in first-appearance order; others keep the DB sort and
    // let CitationFormatter.orderBibliography handle the final alphabetical
    // pass on formatted strings.
    const orderedBibliography = includeBibliography
      ? orderEntriesForBibliography(bibliography, formatter, resolverState)
      : []

    // Fetch project images if requested
    let projectImages: ProjectImageData[] = []
    if (includeIllustrations && project.projectType !== 'ACADEMIC') {
      const imgs = await prisma.projectImage.findMany({
        where: { projectId },
        select: { imageData: true, chapterId: true, subsectionId: true, sortOrder: true, layout: true, position: true },
        orderBy: { sortOrder: 'asc' },
      })
      projectImages = imgs.map((img) => ({
        imageData: Buffer.from(img.imageData),
        chapterId: img.chapterId,
        subsectionId: img.subsectionId,
        sortOrder: img.sortOrder,
        layout: img.layout,
        position: img.position,
      }))
    }

    // Academic metadata — only attached for ACADEMIC projects with the
    // structural toggle on. When `academic` is null, both builders fall
    // back to the plain title-page / chapter-heading rendering.
    const academic: AcademicStructuralInput | null =
      includeStructural && project.projectType === 'ACADEMIC'
        ? {
            author: project.author,
            institution: project.institution,
            department: project.department,
            advisor: project.advisor,
            abstractTr: project.abstractTr,
            abstractEn: project.abstractEn,
            keywordsTr: project.keywordsTr ?? [],
            keywordsEn: project.keywordsEn ?? [],
            acknowledgments: project.acknowledgments,
            dedication: project.dedication,
            language: project.language,
            date: String(new Date().getFullYear()),
            // Optional fields not yet surfaced in the schema — left blank
            // so the title-page builder skips them cleanly.
            degreeType: null,
            course: null,
            instructor: null,
            city: null,
          }
        : null

    // Build file
    let buffer: Buffer
    if (fileType === 'pdf') {
      buffer = await buildPdf(
        project.title,
        subsections,
        orderedBibliography,
        formatter,
        includeBibliography,
        project.language,
        projectImages,
        project.bookDesign as BookDesignSettings | null,
        academic,
        project.citationFormat
      )
    } else {
      const doc = buildDocx(
        project.title,
        subsections,
        orderedBibliography,
        formatter,
        includeBibliography,
        project.language,
        academic,
        project.citationFormat
      )
      buffer = await Packer.toBuffer(doc)
    }

    // Save to disk
    const ext = fileType === 'pdf' ? 'pdf' : 'docx'

    // Build a human-readable filename (ASCII-safe for filesystem, Türkçe transliterated)
    const trMap: Record<string, string> = { 'ç': 'c', 'Ç': 'C', 'ğ': 'g', 'Ğ': 'G', 'ı': 'i', 'İ': 'I', 'ö': 'o', 'Ö': 'O', 'ş': 's', 'Ş': 'S', 'ü': 'u', 'Ü': 'U' }
    const sanitize = (s: string) => s
      .split('').map((c) => trMap[c] ?? c).join('')
      .replace(/[^a-zA-Z0-9 _-]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 80)

    let fileLabel: string
    if (scope === 'full') {
      fileLabel = sanitize(project.title)
    } else if (scope === 'chapter' && chapterId) {
      const ch = chapters.find((c) => c.id === chapterId)
      fileLabel = ch ? sanitize(`${ch.number}_Chapter_${ch.title}`) : 'chapter'
    } else if (scope === 'subsection' && subsections.length > 0) {
      fileLabel = sanitize(`${subsections[0].subsectionId}_${subsections[0].title}`)
    } else {
      fileLabel = sanitize(project.title)
    }
    const filename = `${fileLabel}.${ext}`
    // Use a short timestamp subfolder to avoid overwriting same-named files
    const ts = Date.now().toString(36)
    const filePath = path.join('exports', projectId, ts, filename)
    const absolutePath = path.join(process.cwd(), filePath)
    await mkdir(path.dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, buffer)

    // Save to DB
    const output = await prisma.output.create({
      data: {
        projectId,
        subsectionId: scope === 'subsection' ? subsectionId : null,
        fileType: ext,
        filePath,
        scope,
      },
      include: {
        subsection: { select: { title: true } },
      },
    })

    return NextResponse.json({ output })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/projects/[id]/export]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
