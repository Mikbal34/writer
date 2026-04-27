/**
 * Generates a sample DOCX + PDF for every academic citation format
 * using realistic mock metadata, so we can verify cover / abstract /
 * manuscript info / body / bibliography styling per format end-to-end.
 *
 * Output: /tmp/format-tests/{FORMAT}.docx + .pdf
 *
 *   npx tsx scripts/test-all-formats.mts
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  Document,
  Packer,
  Paragraph,
  PageBreak,
  Header,
  Footer,
  PageNumber,
  NumberFormat,
} from 'docx'
import PDFDocumentPkg from 'pdfkit'
const PDFDocument = PDFDocumentPkg as unknown as typeof import('pdfkit')

import {
  buildTitlePage,
  buildAbstractPages,
  buildKeyPointsPage,
  buildSubmissionInfoPage,
  buildBibliographyHeader,
  buildChapterOpening,
  type AcademicMeta,
} from '../src/lib/export/docx-structural'
import {
  renderTitlePage,
  renderAbstractPages,
  renderKeyPointsPage,
  renderSubmissionInfoPage,
  renderChapterOpening,
} from '../src/lib/export/pdf-structural'
import { getFormatDefaults } from '../src/lib/citations/format-defaults'
import type { CitationFormat } from '@prisma/client'

const FORMATS: CitationFormat[] = [
  'APA', 'MLA', 'CHICAGO', 'TURABIAN', 'HARVARD',
  'IEEE', 'VANCOUVER', 'AMA', 'ISNAD',
]

function buildMeta(format: CitationFormat): AcademicMeta {
  const isIsnad = format === 'ISNAD'
  const advisor = isIsnad ? 'Prof. Dr. Ahmet Yılmaz' : 'Prof. Jane Smith'
  const advisorLabel = isIsnad ? 'Danışman:' : 'Advisor:'

  // Vancouver / AMA carry submission info; AMA also adds the Key Points box.
  const submission = (format === 'VANCOUVER' || format === 'AMA') ? {
    shortTitle: 'COVID-19 Test Title',
    wordCountAbstract: 247,
    wordCountText: 4823,
    tableCount: 2,
    figureCount: 3,
    conflictOfInterest: 'The authors declare no conflict of interest.',
    funding: 'No specific funding received.',
    trialRegistration: format === 'AMA' ? 'NCT01234567' : null,
    keyPoints: format === 'AMA' ? {
      question: 'Did the intervention reduce mortality?',
      findings: 'Yes — a 12% absolute risk reduction was observed.',
      meaning: 'The intervention should be considered standard care.',
    } : null,
    formatLabel: format === 'AMA' ? 'AMA' as const : 'Vancouver' as const,
  } : null

  return {
    title: 'Test Manuscript Title',
    subtitle: 'A Survey of Per-Format Export Behaviour',
    author: 'Jane Doe',
    institution: 'University of Example',
    department: 'Department of Computer Science',
    advisor,
    abstractTr: isIsnad
      ? 'Bu çalışma, format-spesifik export davranışını test eder. Her formatın kendi tipografi ve yapısal kurallarını uyguladığı doğrulanır.'
      : null,
    abstractEn: isIsnad
      ? 'This study tests format-specific export behaviour. Each format applies its own typography and structural rules as expected.'
      : 'Background. This is a generic abstract that exercises the structured-abstract rendering for journal formats. Methods. We tested all nine formats. Results. All formats render with format-specific typography. Conclusions. The export pipeline is uniformly format-aware.',
    keywordsTr: isIsnad ? ['test', 'akademik', 'export', 'biçim'] : [],
    keywordsEn: isIsnad
      ? ['test', 'academic', 'export', 'format']
      : ['test', 'export', 'format', 'manuscript'],
    acknowledgments: 'Thanks to the test team for verifying every format.',
    dedication: null,
    language: isIsnad ? 'tr' : 'en',
    date: '2026',
    degreeType: format === 'TURABIAN' || format === 'ISNAD' || format === 'CHICAGO'
      ? (isIsnad ? 'Yüksek Lisans Tezi' : 'Master of Arts')
      : null,
    course: format === 'APA' || format === 'CHICAGO' || format === 'MLA'
      ? 'Research Methods 301' : null,
    instructor: format === 'APA' || format === 'CHICAGO' || format === 'MLA'
      ? 'Dr. John Brown' : null,
    city: format === 'TURABIAN' || format === 'ISNAD' || format === 'CHICAGO'
      ? (isIsnad ? 'Bandırma' : 'Chicago, Illinois') : null,
    isStateUniversity: isIsnad ? true : undefined,
    advisorLabel,
    authors: (format === 'IEEE' || format === 'VANCOUVER' || format === 'AMA') ? [
      { name: 'Jane Doe', degrees: ['MD', 'PhD'], department: 'Department of Cardiology',
        institution: 'Mayo Clinic', city: 'Rochester', country: 'USA',
        email: 'jdoe@mayo.edu', orcid: '0000-0001-0000-0001' },
      { name: 'Ahmet Yılmaz', degrees: ['MD'], department: 'Department of Internal Medicine',
        institution: 'Hacettepe University', city: 'Ankara', country: 'Turkey',
        email: 'ayilmaz@hacettepe.edu.tr', orcid: '0000-0002-0000-0002' },
      { name: 'Maria García', degrees: ['PhD'], department: 'School of Public Health',
        institution: 'University of Barcelona', city: 'Barcelona', country: 'Spain',
        email: 'mgarcia@ub.edu', orcid: null },
    ] : null,
    submission,
  }
}

// =================================================================
//  DOCX writer
// =================================================================

async function writeDocx(format: CitationFormat, outDir: string): Promise<void> {
  const meta = buildMeta(format)
  const fmtDefaults = getFormatDefaults(format)
  const children: Paragraph[] = []
  children.push(...buildTitlePage(format, meta))
  children.push(...buildKeyPointsPage(format, meta))
  children.push(...buildAbstractPages(format, meta))
  children.push(...buildSubmissionInfoPage(format, meta))
  // Body — single chapter for the smoke test.
  children.push(...buildChapterOpening(format, 1, 'Introduction', true))
  // Bibliography header.
  children.push(new Paragraph({ children: [new PageBreak()] }))
  children.push(buildBibliographyHeader(format))

  const isLetter = fmtDefaults.pageSize.toLowerCase() === 'letter'
  const pageWidthTwips = isLetter ? 12240 : 11906
  const pageHeightTwips = isLetter ? 15840 : 16838

  // Per-format Roman vs Arabic numbering (front matter / body).
  const numFmt = (style: 'lower-roman' | 'upper-roman' | 'arabic' | 'none') => {
    switch (style) {
      case 'lower-roman': return NumberFormat.LOWER_ROMAN
      case 'upper-roman': return NumberFormat.UPPER_ROMAN
      default: return NumberFormat.DECIMAL
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: pageWidthTwips, height: pageHeightTwips },
            margin: {
              top: fmtDefaults.marginTop * 20,
              right: fmtDefaults.marginRight * 20,
              bottom: fmtDefaults.marginBottom * 20,
              left: fmtDefaults.marginLeft * 20,
            },
            pageNumbers: { formatType: numFmt('arabic') },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [new (await import('docx')).TextRun({
                  children: [PageNumber.CURRENT],
                  size: 22,
                })],
                alignment: 'center' as never,
              }),
            ],
          }),
        },
        children,
      },
    ],
  })
  const buffer = await Packer.toBuffer(doc)
  await fs.writeFile(path.join(outDir, `${format}.docx`), buffer)
}

// =================================================================
//  PDF writer
// =================================================================

async function writePdf(format: CitationFormat, outDir: string): Promise<void> {
  const meta = buildMeta(format)
  const fmtDefaults = getFormatDefaults(format)
  const isLetter = fmtDefaults.pageSize.toLowerCase() === 'letter'
  const pageWidth = isLetter ? 612 : 595.28
  const pageHeight = isLetter ? 792 : 841.89

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [pageWidth, pageHeight],
      margins: {
        top: fmtDefaults.marginTop,
        right: fmtDefaults.marginRight,
        bottom: fmtDefaults.marginBottom,
        left: fmtDefaults.marginLeft,
      },
      bufferPages: true,
    })
    const chunks: Buffer[] = []
    doc.on('data', (c) => chunks.push(c as Buffer))
    doc.on('end', async () => {
      try {
        await fs.writeFile(path.join(outDir, `${format}.pdf`), Buffer.concat(chunks))
        resolve()
      } catch (e) { reject(e) }
    })
    doc.on('error', reject)

    const fonts = {
      regular: 'Times-Roman',
      bold: 'Times-Bold',
      italic: 'Times-Italic',
      boldItalic: 'Times-BoldItalic',
    }
    const BODY_SIZE = fmtDefaults.bodyFontSize

    renderTitlePage(doc, format, meta, fonts)
    renderKeyPointsPage(doc, format, meta, fonts, BODY_SIZE)
    renderAbstractPages(doc, format, meta, fonts, BODY_SIZE)
    renderSubmissionInfoPage(doc, format, meta, fonts, BODY_SIZE)
    renderChapterOpening(doc, format, 1, 'Introduction', true, fonts, fmtDefaults.chapterTitleSize)
    doc.font(fonts.regular).fontSize(BODY_SIZE)
    doc.text('This is a sample body paragraph for the format smoke test.', {
      align: fmtDefaults.textAlign === 'justify' ? 'justify' : 'left',
    })

    doc.end()
  })
}

// =================================================================
//  Main
// =================================================================

async function main() {
  const outDir = '/tmp/format-tests'
  await fs.rm(outDir, { recursive: true, force: true })
  await fs.mkdir(outDir, { recursive: true })

  for (const format of FORMATS) {
    process.stdout.write(`Generating ${format}… `)
    try {
      await writeDocx(format, outDir)
      await writePdf(format, outDir)
      console.log('OK')
    } catch (err) {
      console.log('FAIL')
      console.error(err)
    }
  }
  console.log(`\nOutputs in ${outDir}`)
}

main()
