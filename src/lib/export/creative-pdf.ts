/**
 * PDF renderers for creative (non-academic) book styles. Consumes a
 * CreativeStructuralSpec produced by book-styles.ts and draws the
 * spec's chapter opening — number style, ornaments, case, alignment,
 * sinkage — into a pdfkit document.
 *
 * Mirrors the role of pdf-structural.ts on the academic side but
 * without the citation-format coupling: creative specs come from
 * book-style bundles, not from citation rules.
 */

import type PDFKit from 'pdfkit'
import type {
  CreativeStructuralSpec,
  ChapterNumberStyle,
  ChapterOrnament,
} from '../creative-specs'

type Doc = PDFKit.PDFDocument

interface FontBundle {
  regular: string
  bold: string
  italic: string
  boldItalic: string
}

// =================================================================
//  NUMBER → TEXT HELPERS
// =================================================================

function toRoman(n: number): string {
  const map: [number, string][] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ]
  let result = ''
  let remaining = n
  for (const [value, letters] of map) {
    while (remaining >= value) {
      result += letters
      remaining -= value
    }
  }
  return result
}

const WORD_ONES: Record<number, string> = {
  1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five',
  6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine', 10: 'Ten',
  11: 'Eleven', 12: 'Twelve', 13: 'Thirteen', 14: 'Fourteen', 15: 'Fifteen',
  16: 'Sixteen', 17: 'Seventeen', 18: 'Eighteen', 19: 'Nineteen', 20: 'Twenty',
}

function toWord(n: number): string {
  if (n in WORD_ONES) return WORD_ONES[n]
  // Fallback for > 20 — just use the number; most trade books don't exceed 20
  // chapters, and the few that do typically switch to Arabic past that anyway.
  return String(n)
}

export function chapterNumberText(style: ChapterNumberStyle, n: number): string {
  switch (style) {
    case 'none':
      return ''
    case 'arabic':
      return String(n)
    case 'roman-upper':
      return toRoman(n)
    case 'word-upper':
      return toWord(n).toUpperCase()
    case 'word-title':
      return toWord(n)
    case 'chapter-arabic':
      return `Chapter ${n}`
    case 'chapter-roman':
      return `Chapter ${toRoman(n)}`
  }
}

// =================================================================
//  ORNAMENT GLYPHS
// =================================================================

export function ornamentGlyph(kind: ChapterOrnament): string {
  switch (kind) {
    case 'fleuron':
      return '❦'
    case 'asterism':
      return '⁂'
    case 'three-stars':
      return '*  *  *'
    case 'dinkus':
      return '◆'
    default:
      return ''
  }
}

// =================================================================
//  CHAPTER OPENING RENDERER
// =================================================================

export function renderCreativeChapterOpening(
  doc: Doc,
  spec: CreativeStructuralSpec,
  chapterNumber: number,
  chapterTitle: string,
  isFirst: boolean,
  fonts: FontBundle,
  defaultTitleSize: number
): void {
  const chapter = spec.chapter

  // New page — except optionally on the very first chapter where the
  // user may prefer no blank page between TOC and chapter 1.
  if (chapter.newPage && !isFirst) {
    doc.addPage()
  } else if (chapter.newPage && isFirst) {
    // First chapter still gets its own page to separate from front matter.
    if (doc.y > 100) doc.addPage()
  }

  // Sinkage — traditional blank space above the chapter number.
  const pageContentHeight =
    doc.page.height - doc.page.margins.top - doc.page.margins.bottom
  const sinkageFactor = {
    none: 0,
    small: 0.04,
    medium: 0.1,
    large: 0.22,
  }[chapter.sinkage]
  if (sinkageFactor > 0) {
    doc.y = doc.page.margins.top + pageContentHeight * sinkageFactor
  }

  const align: 'center' | 'left' = chapter.align
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right

  // Ornament above
  if (chapter.ornamentAbove !== 'none') {
    if (chapter.ornamentAbove === 'horizontal-rule') {
      drawHorizontalRule(doc, align, width, 0.5)
      doc.moveDown(0.5)
    } else {
      const glyph = ornamentGlyph(chapter.ornamentAbove)
      if (glyph) {
        doc.font(fonts.regular).fontSize(defaultTitleSize * 0.6)
        doc.text(glyph, doc.page.margins.left, doc.y, { width, align })
        doc.moveDown(0.4)
      }
    }
  }

  // Chapter number
  const numberText = chapterNumberText(chapter.numberStyle, chapterNumber)
  if (numberText) {
    const sizeScale = {
      small: 0.65,
      medium: 0.9,
      large: 1.2,
      huge: 1.9,
    }[chapter.numberSize]
    doc.font(fonts.bold).fontSize(defaultTitleSize * sizeScale)
    doc.text(numberText, doc.page.margins.left, doc.y, { width, align })
    doc.moveDown(0.5)
  }

  // Chapter title with case treatment
  const titleText =
    chapter.titleCase === 'uppercase'
      ? chapterTitle.toUpperCase()
      : chapterTitle
  const titleFont = fonts.bold
  doc.font(titleFont).fontSize(defaultTitleSize)

  if (chapter.titleCase === 'small-caps') {
    // PDFKit doesn't support small caps directly — approximate with a
    // slight letter-spacing + uppercase hack. The resulting text looks
    // close enough to small caps for trade-book use.
    doc.text(titleText.toUpperCase(), doc.page.margins.left, doc.y, {
      width,
      align,
      characterSpacing: 1.5,
    })
  } else {
    doc.text(titleText, doc.page.margins.left, doc.y, { width, align })
  }
  doc.moveDown(0.3)

  // Ornament below
  if (chapter.ornamentBelow !== 'none') {
    if (chapter.ornamentBelow === 'horizontal-rule') {
      drawHorizontalRule(doc, align, width, 0.5)
      doc.moveDown(0.5)
    } else {
      const glyph = ornamentGlyph(chapter.ornamentBelow)
      if (glyph) {
        doc.font(fonts.regular).fontSize(defaultTitleSize * 0.5)
        doc.text(glyph, doc.page.margins.left, doc.y, { width, align })
        doc.moveDown(0.4)
      }
    }
  }

  // Breathing room before body
  doc.moveDown(0.8)
}

// =================================================================
//  HELPERS
// =================================================================

function drawHorizontalRule(
  doc: Doc,
  align: 'center' | 'left',
  contentWidth: number,
  thickness: number
): void {
  const ruleWidth = contentWidth * 0.35
  const startX =
    align === 'center'
      ? doc.page.margins.left + (contentWidth - ruleWidth) / 2
      : doc.page.margins.left
  const y = doc.y + 6
  doc
    .save()
    .lineWidth(thickness)
    .strokeColor('#666666')
    .moveTo(startX, y)
    .lineTo(startX + ruleWidth, y)
    .stroke()
    .restore()
  // Advance y so subsequent content doesn't overlap
  doc.y = y + 6
}
