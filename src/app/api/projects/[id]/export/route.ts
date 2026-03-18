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
          children: [new TextRun({ text: `${sub.chapterNumber}. Bölüm: ${sub.chapterTitle}`, bold: true, size: 32, font: 'Times New Roman', color: '000000' })],
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
              text: '[Bu alt başlık henüz yazılmamış]',
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
        text: 'Kaynakça',
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
// Build PDF document
// ---------------------------------------------------------------------------
function buildPdf(
  projectTitle: string,
  subsections: SubsectionData[],
  bibliography: BibliographyEntry[],
  formatter: CitationFormatter,
  includeBibliography: boolean
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Use Arial Unicode for full Turkish character support
    const FONT = '/Library/Fonts/Arial Unicode.ttf'

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 72, bottom: 72, left: 72, right: 72 },
      bufferPages: true,
      info: { Title: projectTitle },
    })

    doc.registerFont('main', FONT)

    const bufferChunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => bufferChunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(bufferChunks)))
    doc.on('error', reject)

    // Collect all footnotes as endnotes
    const allFootnotes: string[] = []
    let footnoteCounter = 1

    // Title page
    doc.font('main').fontSize(24)
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
        doc.font('main').fontSize(18)
        doc.text(`${sub.chapterNumber}. Bölüm: ${sub.chapterTitle}`, { align: 'left' })
        doc.moveDown(0.5)
      }

      // Section heading
      if (sub.sectionTitle !== currentSection) {
        currentSection = sub.sectionTitle
        doc.font('main').fontSize(14)
        doc.text(sub.sectionTitle)
        doc.moveDown(0.3)
      }

      // Subsection heading
      doc.font('main').fontSize(12)
      doc.text(sub.title)
      doc.moveDown(0.2)

      // Content
      doc.font('main').fontSize(11)
      if (sub.content) {
        // Replace [fn: ...] with superscript numbers and collect footnotes
        const processed = sub.content.replace(
          /\[fn:\s*([^\]]+)\]/g,
          (_match: string, fnText: string) => {
            const num = footnoteCounter++
            allFootnotes.push(`${num}. ${fnText.trim()}`)
            return `[${num}]`
          }
        )

        const paragraphs = processed.split('\n\n').filter((p: string) => p.trim())
        for (const para of paragraphs) {
          doc.text(para.trim(), {
            align: 'justify',
            indent: 36,
            lineGap: 4,
          })
          doc.moveDown(0.3)
        }
      } else {
        doc.fillColor('#999999')
        doc.text('[Bu alt başlık henüz yazılmamış]')
        doc.fillColor('#000000')
      }

      doc.moveDown(0.3)
    }

    // Endnotes section
    if (allFootnotes.length > 0) {
      doc.addPage()
      doc.font('main').fontSize(18)
      doc.text('Dipnotlar', { align: 'left' })
      doc.moveDown(0.5)

      doc.font('main').fontSize(9)
      for (const note of allFootnotes) {
        doc.text(note, { lineGap: 2 })
        doc.moveDown(0.1)
      }
    }

    // Bibliography
    if (includeBibliography && bibliography.length > 0) {
      doc.addPage()
      doc.font('main').fontSize(18)
      doc.text('Kaynakça', { align: 'left' })
      doc.moveDown(0.5)

      const formatted = bibliography.map((entry) => formatter.formatBibliographyEntry(entry))
      const sorted = CitationFormatter.sortBibliography(formatted)

      doc.font('main').fontSize(11)
      for (const item of sorted) {
        doc.text(item.entry, {
          indent: 36,
          lineGap: 2,
        })
        doc.moveDown(0.2)
      }
    }

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
    const exportsDir = path.join(process.cwd(), 'exports', projectId)
    await mkdir(exportsDir, { recursive: true })

    const timestamp = Date.now()
    const ext = fileType === 'pdf' ? 'pdf' : 'docx'
    const scopeLabel = scope === 'full' ? 'full' : scope === 'chapter' ? `ch` : 'sub'
    const filename = `${scopeLabel}_${timestamp}.${ext}`
    const filePath = path.join('exports', projectId, filename)
    const absolutePath = path.join(process.cwd(), filePath)

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
