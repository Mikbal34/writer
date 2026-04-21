/**
 * Per-format page-layout defaults, derived from each citation format's
 * official style manual. These populate the project's `bookDesign` field
 * when the user clicks "Apply {format} defaults" on the design page — the
 * user can still override every knob afterwards.
 *
 * Units are PDF points (72pt = 1 inch). Margins follow each spec:
 *   APA 7, MLA 9, Chicago 17, Turabian 9  → 1" all sides           (72pt)
 *   Harvard (Cite Them Right)             → Typically 2.5–3cm       (~72pt, 85pt)
 *   IEEE                                  → Narrower for journal     (54pt ~= 0.75")
 *   Vancouver / ICMJE                     → ~1" (publisher-dependent)
 *   AMA                                   → 1"
 *   ISNAD 2                               → 2.5cm (~72pt)
 *
 * References:
 *   APA 7:     https://apastyle.apa.org/style-grammar-guidelines/paper-format
 *   MLA 9:     https://style.mla.org (paper format)
 *   Chicago:   https://www.chicagomanualofstyle.org/tools_citationguide
 *   Turabian:  https://www.chicagomanualofstyle.org/turabian
 *   Harvard:   https://www.citethemrightonline.com
 *   IEEE:      https://journals.ieeeauthorcenter.ieee.org (style manual)
 *   Vancouver: https://www.nlm.nih.gov/bsd/uniform_requirements.html
 *   AMA 11:    https://www.amamanualofstyle.com
 *   ISNAD 2:   https://www.isnadsistemi.org
 */

import type { CitationFormat } from '@prisma/client'

export interface FormatDefaults {
  pageSize: 'A4' | 'Letter'
  marginTop: number
  marginBottom: number
  marginLeft: number
  marginRight: number
  bodyFontSize: number
  lineHeight: number
  paragraphSpacing: number
  firstLineIndent: number
  textAlign: 'left' | 'justify' | 'center'
  chapterTitleSize: number
  chapterTitleAlign: 'left' | 'center'
  sectionTitleSize: number
  subsectionTitleSize: number
  showPageNumbers: boolean
  /** Short, human-readable summary for the UI tooltip. */
  description: string
}

const IN = 72     // 1 inch in points
const HALF_IN = 36 // 0.5 inch

/**
 * APA 7 — Student paper defaults. 1" margins all around, Times New Roman
 * 12pt, double-spaced, 0.5" first-line indent, left-aligned (NOT
 * justified), page numbers top-right.
 */
const APA: FormatDefaults = {
  pageSize: 'A4',
  marginTop: IN,
  marginBottom: IN,
  marginLeft: IN,
  marginRight: IN,
  bodyFontSize: 12,
  lineHeight: 2.0,
  paragraphSpacing: 0,
  firstLineIndent: HALF_IN,
  textAlign: 'left',
  chapterTitleSize: 14,
  chapterTitleAlign: 'center',
  sectionTitleSize: 12,
  subsectionTitleSize: 12,
  showPageNumbers: true,
  description: 'APA 7: 1" margin, 12pt, çift aralık, 0.5" paragraf girintisi, sol hizalı',
}

/**
 * MLA 9 — 1" margins, 12pt, double-spaced, 0.5" first-line indent,
 * left-aligned, page numbers top-right with surname.
 */
const MLA: FormatDefaults = {
  pageSize: 'A4',
  marginTop: IN,
  marginBottom: IN,
  marginLeft: IN,
  marginRight: IN,
  bodyFontSize: 12,
  lineHeight: 2.0,
  paragraphSpacing: 0,
  firstLineIndent: HALF_IN,
  textAlign: 'left',
  chapterTitleSize: 12,
  chapterTitleAlign: 'center',
  sectionTitleSize: 12,
  subsectionTitleSize: 12,
  showPageNumbers: true,
  description: 'MLA 9: 1" margin, 12pt, çift aralık, 0.5" girinti, sol hizalı',
}

/**
 * Chicago 17 (Notes-Bibliography). 1" margins, 12pt body, double-spaced,
 * 0.5" first-line indent, centered chapter titles.
 */
const CHICAGO: FormatDefaults = {
  pageSize: 'A4',
  marginTop: IN,
  marginBottom: IN,
  marginLeft: IN,
  marginRight: IN,
  bodyFontSize: 12,
  lineHeight: 2.0,
  paragraphSpacing: 0,
  firstLineIndent: HALF_IN,
  textAlign: 'left',
  chapterTitleSize: 14,
  chapterTitleAlign: 'center',
  sectionTitleSize: 12,
  subsectionTitleSize: 12,
  showPageNumbers: true,
  description: 'Chicago 17: 1" margin, 12pt, çift aralık, merkezlenmiş bölüm başlığı',
}

/**
 * Turabian 9 — student variant of Chicago; same page geometry.
 */
const TURABIAN: FormatDefaults = {
  ...CHICAGO,
  description: 'Turabian 9: Chicago ile aynı düzen (tez/ödev odaklı)',
}

/**
 * Harvard (Cite Them Right). British academic convention: 1" margins,
 * 12pt, 1.5 line spacing, block paragraphs (no first-line indent).
 */
const HARVARD: FormatDefaults = {
  pageSize: 'A4',
  marginTop: IN,
  marginBottom: IN,
  marginLeft: IN,
  marginRight: IN,
  bodyFontSize: 12,
  lineHeight: 1.5,
  paragraphSpacing: 6,
  firstLineIndent: 0,
  textAlign: 'justify',
  chapterTitleSize: 14,
  chapterTitleAlign: 'left',
  sectionTitleSize: 12,
  subsectionTitleSize: 12,
  showPageNumbers: true,
  description: 'Harvard: 1" margin, 12pt, 1.5 aralık, blok paragraf (UK stili)',
}

/**
 * IEEE — journal-style dense layout. 0.75" margins, 10pt body, single
 * spaced, justified text, first-line indent.
 */
const IEEE: FormatDefaults = {
  pageSize: 'A4',
  marginTop: 54,
  marginBottom: 54,
  marginLeft: 54,
  marginRight: 54,
  bodyFontSize: 10,
  lineHeight: 1.0,
  paragraphSpacing: 4,
  firstLineIndent: 18,
  textAlign: 'justify',
  chapterTitleSize: 12,
  chapterTitleAlign: 'center',
  sectionTitleSize: 11,
  subsectionTitleSize: 10,
  showPageNumbers: true,
  description: 'IEEE: 0.75" margin, 10pt, tek aralık, iki yana dayalı (dergi stili)',
}

/**
 * Vancouver / ICMJE — medical journal style, compact.
 */
const VANCOUVER: FormatDefaults = {
  pageSize: 'A4',
  marginTop: IN,
  marginBottom: IN,
  marginLeft: IN,
  marginRight: IN,
  bodyFontSize: 11,
  lineHeight: 1.15,
  paragraphSpacing: 6,
  firstLineIndent: 0,
  textAlign: 'left',
  chapterTitleSize: 13,
  chapterTitleAlign: 'left',
  sectionTitleSize: 12,
  subsectionTitleSize: 11,
  showPageNumbers: true,
  description: 'Vancouver: 1" margin, 11pt, 1.15 aralık (tıp dergisi stili)',
}

/**
 * AMA 11 — JAMA Network conventions; similar to Vancouver but italic
 * journal titles. Layout essentially matches.
 */
const AMA: FormatDefaults = {
  ...VANCOUVER,
  description: 'AMA 11: Vancouver ile benzer düzen; dergi başlıkları italik',
}

/**
 * ISNAD 2 — Turkish humanities. 2.5cm margins, TNR 12pt, 1.5 line
 * spacing, 1cm first-line indent, justified text. Page numbers centered
 * at bottom.
 */
const ISNAD: FormatDefaults = {
  pageSize: 'A4',
  marginTop: IN,
  marginBottom: IN,
  marginLeft: IN,
  marginRight: IN,
  bodyFontSize: 12,
  lineHeight: 1.5,
  paragraphSpacing: 0,
  firstLineIndent: 28,
  textAlign: 'justify',
  chapterTitleSize: 14,
  chapterTitleAlign: 'center',
  sectionTitleSize: 12,
  subsectionTitleSize: 12,
  showPageNumbers: true,
  description: 'ISNAD 2: 2.5cm margin, 12pt, 1.5 aralık, 1cm girinti, iki yana dayalı',
}

export const FORMAT_LAYOUT_DEFAULTS: Record<CitationFormat, FormatDefaults> = {
  APA,
  MLA,
  CHICAGO,
  HARVARD,
  IEEE,
  VANCOUVER,
  AMA,
  TURABIAN,
  ISNAD,
}

/** Convenience accessor — always returns an object. */
export function getFormatDefaults(format: CitationFormat): FormatDefaults {
  return FORMAT_LAYOUT_DEFAULTS[format]
}
