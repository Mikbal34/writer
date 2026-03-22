import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getCitationFormatter, CitationFormatter } from '@/lib/citations/formatter'
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
} from 'docx'
import PDFDocument from 'pdfkit'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

type RouteContext = { params: Promise<{ id: string }> }

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
    // Text before the footnote
    if (match.index > lastIndex) {
      blocks.push({ text: content.slice(lastIndex, match.index) })
    }
    // The footnote itself (empty text, just a reference)
    blocks.push({ text: '', footnote: match[1].trim() })
    lastIndex = regex.lastIndex
  }

  // Remaining text
  if (lastIndex < content.length) {
    blocks.push({ text: content.slice(lastIndex) })
  }

  return blocks
}

// ---------------------------------------------------------------------------
// Parse markdown *italic* into styled TextRuns (works for body + footnotes)
// ---------------------------------------------------------------------------
function parseMarkdownRuns(text: string, fontSize: number): TextRun[] {
  const parts = text.split(/(\*[^*]+\*)/g)
  return parts.filter(Boolean).map(part => {
    if (part.startsWith('*') && part.endsWith('*')) {
      return new TextRun({
        text: part.slice(1, -1),
        italics: true,
        size: fontSize,
        font: 'Times New Roman',
      })
    }
    return new TextRun({
      text: part,
      size: fontSize,
      font: 'Times New Roman',
    })
  })
}

// ---------------------------------------------------------------------------
// Build DOCX document
// ---------------------------------------------------------------------------
interface SubsectionData {
  subsectionId: string
  title: string
  content: string | null
  sectionTitle: string
  chapterTitle: string
  chapterNumber: number
}

function buildDocx(
  projectTitle: string,
  subsections: SubsectionData[],
  bibliography: BibliographyEntry[],
  formatter: CitationFormatter,
  includeBibliography: boolean
): Document {
  const footnotes: Record<number, { children: Paragraph[] }> = {}
  let footnoteCounter = 1
  let currentChapter = ''
  let currentSection = ''

  const children: Paragraph[] = []

  // Title page
  children.push(
    new Paragraph({
      children: [new TextRun({ text: projectTitle, bold: true, size: 36, font: 'Times New Roman' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 },
    })
  )
  children.push(
    new Paragraph({
      children: [new PageBreak()],
    })
  )

  for (const sub of subsections) {
    // Chapter heading
    if (sub.chapterTitle !== currentChapter) {
      currentChapter = sub.chapterTitle
      currentSection = '' // reset section
      if (children.length > 2) {
        children.push(new Paragraph({ children: [new PageBreak()] }))
      }
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `Chapter ${sub.chapterNumber}: ${sub.chapterTitle}`, bold: true, size: 32, font: 'Times New Roman', color: '000000' })],
          heading: HeadingLevel.HEADING_1,
          spacing: { after: 300 },
        })
      )
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

    // Content with footnotes
    if (sub.content) {
      const paragraphs = sub.content.split('\n\n').filter((p) => p.trim())
      for (const para of paragraphs) {
        const blocks = parseContent(para)
        const runs: (TextRun | FootnoteReferenceRun)[] = []

        for (const block of blocks) {
          if (block.text) {
            runs.push(...parseMarkdownRuns(block.text, 24))
          }
          if (block.footnote) {
            const fnId = footnoteCounter++
            footnotes[fnId] = {
              children: [
                new Paragraph({
                  children: parseMarkdownRuns(block.footnote, 20),
                }),
              ],
            }
            runs.push(new FootnoteReferenceRun(fnId))
          }
        }

        children.push(
          new Paragraph({
            children: runs,
            spacing: { after: 120, line: 360 }, // 1.5 line spacing
            indent: { firstLine: convertInchesToTwip(0.5) },
          })
        )
      }
    } else {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: '[This subsection has not been written yet]',
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

  // Bibliography section
  if (includeBibliography && bibliography.length > 0) {
    children.push(new Paragraph({ children: [new PageBreak()] }))
    children.push(
      new Paragraph({
        text: 'Bibliography',
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 300 },
      })
    )

    const formatted = bibliography
      .map((entry) => formatter.formatBibliographyEntry(entry))
    const sorted = CitationFormatter.sortBibliography(formatted)

    for (const item of sorted) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: item.entry,
              size: 24,
              font: 'Times New Roman',
            }),
          ],
          spacing: { after: 80 },
          indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.5) },
        })
      )
    }
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
  const empty: PdfFontFamily = { regular: '', bold: '', italic: '', boldItalic: '' }

  // Allow override via env var (regular font path; derive variants)
  if (process.env.PDF_FONT_PATH) {
    return { regular: process.env.PDF_FONT_PATH, bold: '', italic: '', boldItalic: '' }
  }

  // Times New Roman — best match with DOCX output
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
    {
      // Windows
      regular: 'C:\\Windows\\Fonts\\times.ttf',
      bold: 'C:\\Windows\\Fonts\\timesbd.ttf',
      italic: 'C:\\Windows\\Fonts\\timesi.ttf',
      boldItalic: 'C:\\Windows\\Fonts\\timesbi.ttf',
    },
  ]

  for (const family of tnrFamilies) {
    try {
      fs.accessSync(family.regular)
      // Regular must exist; variants are optional (fallback to regular)
      const result: PdfFontFamily = { regular: family.regular, bold: family.regular, italic: family.regular, boldItalic: family.regular }
      try { fs.accessSync(family.bold); result.bold = family.bold } catch { /* use regular */ }
      try { fs.accessSync(family.italic); result.italic = family.italic } catch { /* use regular */ }
      try { fs.accessSync(family.boldItalic); result.boldItalic = family.boldItalic } catch { /* use regular */ }
      return result
    } catch { /* try next family */ }
  }

  // Fallback: any single Unicode-capable font
  const singleFonts = [
    '/Library/Fonts/Arial Unicode.ttf',
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
    '/usr/share/fonts/dejavu-serif-fonts/DejaVuSerif.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf',
    'C:\\Windows\\Fonts\\arial.ttf',
  ]
  for (const p of singleFonts) {
    try { fs.accessSync(p); return { regular: p, bold: p, italic: p, boldItalic: p } } catch { /* skip */ }
  }

  return empty // fallback: use pdfkit built-in (ASCII only)
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
  const x = (doc as any).x as number
  const startX = x + (options.indent ?? 0)
  const width = (doc.page.width - doc.page.margins.left - doc.page.margins.right) - (options.indent ?? 0)

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

function buildPdf(
  projectTitle: string,
  subsections: SubsectionData[],
  bibliography: BibliographyEntry[],
  formatter: CitationFormatter,
  includeBibliography: boolean
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const fontFamily = resolvePdfFontFamily()
    const hasCustomFont = !!fontFamily.regular

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 72, bottom: 72, left: 72, right: 72 },
      bufferPages: true,
      info: { Title: projectTitle },
    })

    // Register font variants
    if (hasCustomFont) {
      doc.registerFont('main', fontFamily.regular)
      doc.registerFont('main-bold', fontFamily.bold)
      doc.registerFont('main-italic', fontFamily.italic)
      doc.registerFont('main-bolditalic', fontFamily.boldItalic)
    }
    const fonts = {
      regular: hasCustomFont ? 'main' : 'Helvetica',
      bold: hasCustomFont ? 'main-bold' : 'Helvetica-Bold',
      italic: hasCustomFont ? 'main-italic' : 'Helvetica-Oblique',
      boldItalic: hasCustomFont ? 'main-bolditalic' : 'Helvetica-BoldOblique',
    }

    const bufferChunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => bufferChunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(bufferChunks)))
    doc.on('error', reject)

    // ---- Page-bottom footnote tracking ----
    const PAGE_HEIGHT = 841.89 // A4
    const MARGIN_BOTTOM = 72
    const MARGIN_LEFT = 72
    const CONTENT_BOTTOM = PAGE_HEIGHT - MARGIN_BOTTOM
    const FOOTNOTE_FONT_SIZE = 8.5
    const FOOTNOTE_LINE_GAP = 1.5
    const FOOTNOTE_SEPARATOR_HEIGHT = 15 // space for the separator line + padding
    const CONTENT_WIDTH = 595.28 - 72 - 72 // A4 width minus margins

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

    // ---- Title page ----
    doc.font(fonts.bold).fontSize(24)
    doc.text(projectTitle, { align: 'center' })
    doc.addPage()

    let currentChapter = ''
    let currentSection = ''

    for (const sub of subsections) {
      // Chapter heading
      if (sub.chapterTitle !== currentChapter) {
        currentChapter = sub.chapterTitle
        currentSection = ''
        if (doc.y > 100) doc.addPage()
        doc.font(fonts.bold).fontSize(18)
        doc.text(`Chapter ${sub.chapterNumber}: ${sub.chapterTitle}`, { align: 'left' })
        doc.moveDown(0.5)
      }

      // Section heading
      if (sub.sectionTitle !== currentSection) {
        currentSection = sub.sectionTitle
        doc.font(fonts.bold).fontSize(14)
        ensureSpace(30)
        doc.text(sub.sectionTitle)
        doc.moveDown(0.3)
      }

      // Subsection heading
      doc.font(fonts.bold).fontSize(12)
      ensureSpace(25)
      doc.text(sub.title)
      doc.moveDown(0.2)

      // Content
      if (sub.content) {
        const paragraphs = sub.content.split('\n\n').filter((p: string) => p.trim())

        for (const para of paragraphs) {
          // Extract footnotes from this paragraph
          const blocks = parseContent(para)
          let plainText = ''
          const paraFootnotes: Array<{ pos: number; text: string; num: number }> = []

          for (const block of blocks) {
            if (block.text) plainText += block.text
            if (block.footnote) {
              const num = globalFootnoteCounter++
              paraFootnotes.push({ pos: plainText.length, text: block.footnote, num })
              plainText += `[${num}]`
            }
          }

          // Register footnotes on this page (reserve space at bottom)
          for (const fn of paraFootnotes) {
            addPageFootnote(fn.num, fn.text)
          }

          // Check if paragraph fits; if not, new page
          doc.font(fonts.regular).fontSize(11)
          const paraHeight = doc.heightOfString(plainText.trim(), {
            width: CONTENT_WIDTH - 36,
            lineGap: 4,
          })
          ensureSpace(paraHeight + 10)

          // Render paragraph with italic support
          pdfRichText(doc, plainText.trim(), { regular: fonts.regular, italic: fonts.italic }, {
            fontSize: 11,
            lineGap: 4,
            indent: 36,
            align: 'justify',
          })
          doc.moveDown(0.3)
        }
      } else {
        doc.fillColor('#999999')
        doc.font(fonts.italic).fontSize(11)
        doc.text('[This subsection has not been written yet]')
        doc.fillColor('#000000')
      }

      doc.moveDown(0.3)
    }

    // Bibliography
    if (includeBibliography && bibliography.length > 0) {
      doc.addPage()
      doc.font(fonts.bold).fontSize(18)
      doc.text('Bibliography', { align: 'left' })
      doc.moveDown(0.5)

      const formatted = bibliography.map((entry) => formatter.formatBibliographyEntry(entry))
      const sorted = CitationFormatter.sortBibliography(formatted)

      doc.font(fonts.regular).fontSize(11)
      for (const item of sorted) {
        doc.text(item.entry, {
          indent: 36,
          lineGap: 2,
        })
        doc.moveDown(0.2)
      }
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
      fileType = 'docx',
    } = body as {
      scope?: 'full' | 'chapter' | 'subsection'
      chapterId?: string
      subsectionId?: string
      includeBibliography?: boolean
      fileType?: 'docx' | 'pdf'
    }

    // Verify project ownership
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: session.user.id },
      select: { id: true, title: true, citationFormat: true },
    })
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
      for (const sec of ch.sections) {
        for (const sub of sec.subsections) {
          subsections.push({
            subsectionId: sub.subsectionId,
            title: sub.title,
            content: sub.content,
            sectionTitle: sec.title,
            chapterTitle: ch.title,
            chapterNumber: ch.number,
          })
        }
      }
    }

    if (subsections.length === 0) {
      return NextResponse.json({ error: 'No subsections found for this scope' }, { status: 404 })
    }

    // Fetch bibliography entries
    const bibliography = includeBibliography
      ? await prisma.bibliography.findMany({
          where: { projectId },
          orderBy: [{ authorSurname: 'asc' }, { year: 'asc' }],
        })
      : []

    // Get citation formatter
    const formatter = getCitationFormatter(project.citationFormat as CitationFormat)

    // Build file
    let buffer: Buffer
    if (fileType === 'pdf') {
      buffer = await buildPdf(
        project.title,
        subsections,
        bibliography as unknown as BibliographyEntry[],
        formatter,
        includeBibliography
      )
    } else {
      const doc = buildDocx(
        project.title,
        subsections,
        bibliography as unknown as BibliographyEntry[],
        formatter,
        includeBibliography
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
