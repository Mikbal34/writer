/**
 * Per-format structural specification for the export pipeline.
 *
 * Each citation format has its own rules for title page layout, abstract
 * wording, table-of-contents conventions, chapter openings, bibliography
 * label, running head content, and page-numbering strategy. This module
 * encodes those rules as plain data so the DOCX and PDF builders render
 * the same output from a single source of truth.
 *
 * References used (see README / research notes for per-format citations):
 *   APA 7:      apastyle.apa.org/instructional-aids/student-title-page-guide
 *   MLA 9:      style.mla.org
 *   Chicago 17: chicagomanualofstyle.org (NB variant)
 *   Turabian 9: chicagomanualofstyle.org/turabian
 *   Harvard:    citethemrightonline.com (13th ed.)
 *   IEEE:       journals.ieeeauthorcenter.ieee.org (Editorial Style Manual)
 *   Vancouver:  www.icmje.org + www.nlm.nih.gov (Citing Medicine)
 *   AMA 11:     amamanualofstyle.com
 *   ISNAD 2:    isnadsistemi.org (TR thesis format)
 */

import type { CitationFormat } from '@prisma/client'

// =================================================================
//  TITLE PAGE
// =================================================================

/**
 * A title-page element name. The structural builder resolves each name
 * to a concrete line of text using the project's academic metadata.
 * Vertical position (top-third, middle, bottom) is encoded by the group
 * index in `titlePage.groups`.
 */
export type TitlePageElement =
  | 'institution_tr_header' // "T.C. <UPPERCASE INSTITUTION>"
  | 'institution'
  | 'department'
  | 'title'
  | 'subtitle'
  | 'author'
  | 'advisor'
  | 'degree_type'
  | 'course'
  | 'instructor'
  | 'date'
  | 'city_and_date'
  | 'affiliation'

export type TitlePageLayout = {
  enabled: boolean
  /** Ordered groups; each renders with a big gap between groups. */
  groups: TitlePageElement[][]
  titleUppercase: boolean
  centerBlock: boolean
}

// =================================================================
//  ABSTRACT
// =================================================================

export type AbstractSpec = {
  enabled: boolean
  /** Label shown at the top of the abstract page(s). */
  label: string
  labelUppercase: boolean
  /** Whether to emit a second abstract page in the other language. */
  dualLanguage: boolean
  wordLimit: number
  /** If true, the prose is broken into labelled subsections. */
  structured: boolean
  structuredSections?: readonly string[]
  keywordsLabel: string
}

// =================================================================
//  TABLE OF CONTENTS
// =================================================================

export type TocSpec = {
  enabled: boolean
  label: string
  labelUppercase: boolean
  /** Include section rows (1.1, 1.2, …) under chapter rows. */
  includeSections: boolean
  /** Include subsection rows (1.1.1, …). */
  includeSubsections: boolean
  dotLeaders: boolean
}

// =================================================================
//  CHAPTER OPENING
// =================================================================

export type ChapterNumberStyle =
  | 'chapter-en'        // "Chapter 1"
  | 'ordinal-tr-upper'  // "BİRİNCİ BÖLÜM"
  | 'n-bolum-upper'     // "1. BÖLÜM"
  | 'roman-intro'       // "I. INTRODUCTION" (IEEE-style)
  | 'numeric'           // "1"
  | 'none'              // just the title

export type ChapterOpeningSpec = {
  newPage: boolean
  numberStyle: ChapterNumberStyle
  titleUppercase: boolean
  align: 'center' | 'left'
  /** Blank lines between chapter number and title. */
  gapAfterNumber: number
  /** Blank lines between title and first body paragraph. */
  gapAfterTitle: number
}

// =================================================================
//  BIBLIOGRAPHY HEADER
// =================================================================

export type BibliographyHeaderSpec = {
  label: string
  labelUppercase: boolean
  align: 'center' | 'left'
}

// =================================================================
//  RUNNING HEAD
// =================================================================

export type RunningHeadContent =
  | 'none'
  | 'page-only'         // APA 7 student
  | 'surname-page'      // MLA: "Smith 3"
  | 'short-title-caps'  // APA 7 professional: running head

export type RunningHeadSpec = {
  enabled: boolean
  content: RunningHeadContent
  position: 'top-right' | 'top-center'
}

// =================================================================
//  PAGINATION
// =================================================================

export type PaginationStyle = 'lower-roman' | 'upper-roman' | 'arabic' | 'none'

export type PaginationSpec = {
  frontMatter: PaginationStyle
  body: PaginationStyle
  position: 'bottom-center' | 'top-right' | 'top-center'
  /** Most formats count but don't DISPLAY the number on the title page. */
  showOnTitlePage: boolean
}

// =================================================================
//  FULL SPEC PER FORMAT
// =================================================================

export interface StructuralSpec {
  titlePage: TitlePageLayout
  abstract: AbstractSpec
  toc: TocSpec
  chapter: ChapterOpeningSpec
  bibliography: BibliographyHeaderSpec
  runningHead: RunningHeadSpec
  pagination: PaginationSpec
}

// Small helpers for readability of the large record below.
const t = <T>(x: T) => x

/**
 * APA 7 (student paper). No separate TOC by default; simple title page
 * with title / author / institution / course / instructor / date all
 * centered; page number top-right starting from the title page.
 */
const APA: StructuralSpec = {
  titlePage: {
    enabled: true,
    groups: [
      ['title'],
      ['author'],
      ['institution', 'department'],
      ['course', 'instructor', 'date'],
    ],
    titleUppercase: false,
    centerBlock: true,
  },
  abstract: {
    enabled: true,
    label: 'Abstract',
    labelUppercase: false,
    dualLanguage: false,
    wordLimit: 250,
    structured: false,
    keywordsLabel: 'Keywords',
  },
  toc: {
    enabled: false, // Optional in APA; off by default
    label: 'Table of Contents',
    labelUppercase: false,
    includeSections: true,
    includeSubsections: false,
    dotLeaders: true,
  },
  chapter: {
    newPage: true,
    numberStyle: 'chapter-en',
    titleUppercase: false,
    align: 'center',
    gapAfterNumber: 1,
    gapAfterTitle: 1,
  },
  bibliography: {
    label: 'References',
    labelUppercase: false,
    align: 'center',
  },
  runningHead: {
    enabled: true,
    content: 'page-only',
    position: 'top-right',
  },
  pagination: {
    frontMatter: 'arabic',
    body: 'arabic',
    position: 'top-right',
    showOnTitlePage: true,
  },
}

/**
 * MLA 9. No title page — info block on first page plus centered title.
 * Running head "Surname Page#" top-right from page 1.
 */
const MLA: StructuralSpec = {
  titlePage: {
    // MLA renders the name block on the first content page rather than a
    // separate title page; we handle this in the export assembler.
    enabled: false,
    groups: [],
    titleUppercase: false,
    centerBlock: false,
  },
  abstract: {
    enabled: false, // Non-standard in MLA
    label: 'Abstract',
    labelUppercase: false,
    dualLanguage: false,
    wordLimit: 250,
    structured: false,
    keywordsLabel: 'Keywords',
  },
  toc: {
    enabled: false,
    label: 'Contents',
    labelUppercase: false,
    includeSections: true,
    includeSubsections: false,
    dotLeaders: true,
  },
  chapter: {
    newPage: false,
    numberStyle: 'none',
    titleUppercase: false,
    align: 'center',
    gapAfterNumber: 0,
    gapAfterTitle: 1,
  },
  bibliography: {
    label: 'Works Cited',
    labelUppercase: false,
    align: 'center',
  },
  runningHead: {
    enabled: true,
    content: 'surname-page',
    position: 'top-right',
  },
  pagination: {
    frontMatter: 'arabic',
    body: 'arabic',
    position: 'top-right',
    showOnTitlePage: true,
  },
}

/**
 * Chicago 17 (NB). Title page bold centered around upper third.
 * Front matter lower-roman, body arabic. Chapter opening "Chapter 1 /
 * Title" on new page.
 */
const CHICAGO: StructuralSpec = {
  titlePage: {
    enabled: true,
    groups: [
      ['title'],
      ['author'],
      ['course', 'instructor', 'institution', 'date'],
    ],
    titleUppercase: false,
    centerBlock: true,
  },
  abstract: {
    enabled: true,
    label: 'Abstract',
    labelUppercase: false,
    dualLanguage: false,
    wordLimit: 300,
    structured: false,
    keywordsLabel: 'Keywords',
  },
  toc: {
    enabled: true,
    label: 'Contents',
    labelUppercase: false,
    includeSections: true,
    includeSubsections: false,
    dotLeaders: true,
  },
  chapter: {
    newPage: true,
    numberStyle: 'chapter-en',
    titleUppercase: false,
    align: 'center',
    gapAfterNumber: 1,
    gapAfterTitle: 2,
  },
  bibliography: {
    label: 'Bibliography',
    labelUppercase: false,
    align: 'center',
  },
  runningHead: {
    enabled: false,
    content: 'none',
    position: 'top-right',
  },
  pagination: {
    frontMatter: 'lower-roman',
    body: 'arabic',
    position: 'bottom-center',
    showOnTitlePage: false,
  },
}

/**
 * Turabian 9 = Chicago's student variant. Same layout, minor label
 * differences kept for future divergence.
 */
const TURABIAN: StructuralSpec = {
  ...CHICAGO,
  abstract: { ...CHICAGO.abstract, wordLimit: 350 },
  toc: { ...CHICAGO.toc, label: 'Table of Contents' },
}

/**
 * Harvard (Cite Them Right 13). Title page with institution info mid-
 * page; running head "Surname Page". References list labelled
 * "References".
 */
const HARVARD: StructuralSpec = {
  titlePage: {
    enabled: true,
    groups: [
      ['title'],
      ['author'],
      ['course', 'instructor', 'institution', 'date'],
    ],
    titleUppercase: false,
    centerBlock: true,
  },
  abstract: {
    enabled: true,
    label: 'Abstract',
    labelUppercase: false,
    dualLanguage: false,
    wordLimit: 250,
    structured: false,
    keywordsLabel: 'Keywords',
  },
  toc: {
    enabled: true,
    label: 'Contents',
    labelUppercase: false,
    includeSections: true,
    includeSubsections: false,
    dotLeaders: true,
  },
  chapter: {
    newPage: true,
    numberStyle: 'numeric',
    titleUppercase: false,
    align: 'left',
    gapAfterNumber: 0,
    gapAfterTitle: 1,
  },
  bibliography: {
    label: 'References',
    labelUppercase: false,
    align: 'left',
  },
  runningHead: {
    enabled: true,
    content: 'surname-page',
    position: 'top-right',
  },
  pagination: {
    frontMatter: 'lower-roman',
    body: 'arabic',
    position: 'bottom-center',
    showOnTitlePage: false,
  },
}

/**
 * IEEE (journal style, thesis-adapted). Title block centered at top of
 * page 1; single structured abstract italic; section headings with Roma
 * numerals ("I. INTRODUCTION"). REFERENCES all caps centered.
 */
const IEEE: StructuralSpec = {
  titlePage: {
    enabled: true,
    groups: [
      ['title'],
      ['author'],
      ['affiliation', 'department', 'institution'],
    ],
    titleUppercase: false,
    centerBlock: true,
  },
  abstract: {
    enabled: true,
    label: 'Abstract',
    labelUppercase: false,
    dualLanguage: false,
    wordLimit: 250,
    structured: false,
    keywordsLabel: 'Index Terms',
  },
  toc: {
    enabled: false, // Journal articles don't have TOC; thesis adaptations do
    label: 'Contents',
    labelUppercase: true,
    includeSections: true,
    includeSubsections: true,
    dotLeaders: true,
  },
  chapter: {
    newPage: false,
    numberStyle: 'roman-intro',
    titleUppercase: true,
    align: 'center',
    gapAfterNumber: 0,
    gapAfterTitle: 1,
  },
  bibliography: {
    label: 'References',
    labelUppercase: true,
    align: 'center',
  },
  runningHead: {
    enabled: false,
    content: 'none',
    position: 'top-center',
  },
  pagination: {
    frontMatter: 'arabic',
    body: 'arabic',
    position: 'bottom-center',
    showOnTitlePage: true,
  },
}

/**
 * Vancouver / ICMJE. Title page with structured abstract (Background /
 * Methods / Results / Conclusions). Numbered references.
 */
const VANCOUVER: StructuralSpec = {
  titlePage: {
    enabled: true,
    groups: [
      ['title'],
      ['author'],
      ['affiliation', 'department', 'institution'],
    ],
    titleUppercase: false,
    centerBlock: true,
  },
  abstract: {
    enabled: true,
    label: 'Abstract',
    labelUppercase: false,
    dualLanguage: false,
    wordLimit: 250,
    structured: true,
    structuredSections: t([
      'Background',
      'Methods',
      'Results',
      'Conclusions',
    ] as const),
    keywordsLabel: 'Keywords',
  },
  toc: {
    enabled: false,
    label: 'Contents',
    labelUppercase: false,
    includeSections: true,
    includeSubsections: false,
    dotLeaders: true,
  },
  chapter: {
    newPage: false,
    numberStyle: 'numeric',
    titleUppercase: false,
    align: 'left',
    gapAfterNumber: 0,
    gapAfterTitle: 1,
  },
  bibliography: {
    label: 'References',
    labelUppercase: false,
    align: 'center',
  },
  runningHead: {
    enabled: false,
    content: 'none',
    position: 'top-center',
  },
  pagination: {
    frontMatter: 'arabic',
    body: 'arabic',
    position: 'bottom-center',
    showOnTitlePage: true,
  },
}

/**
 * AMA 11. Structured abstract with 9-10 labelled subsections (Importance
 * / Objective / Design / … / Conclusions).
 */
const AMA: StructuralSpec = {
  ...VANCOUVER,
  abstract: {
    enabled: true,
    label: 'Abstract',
    labelUppercase: false,
    dualLanguage: false,
    wordLimit: 350,
    structured: true,
    structuredSections: t([
      'Importance',
      'Objective',
      'Design',
      'Setting',
      'Participants',
      'Interventions',
      'Main Outcomes and Measures',
      'Results',
      'Conclusions and Relevance',
    ] as const),
    keywordsLabel: 'Keywords',
  },
}

/**
 * ISNAD 2 (Turkish thesis format). The most prescribed of the nine:
 * dış kapak → iç kapak → kısaltmalar → ÖZET → ABSTRACT → İÇİNDEKİLER →
 * (lists) → body → KAYNAKÇA. Front matter lower-roman, body arabic.
 */
const ISNAD: StructuralSpec = {
  titlePage: {
    enabled: true,
    groups: [
      ['institution_tr_header'], // "T.C. <UNIVERSITY NAME>"
      ['department'],             // "LİSANSÜSTÜ EĞİTİM ENSTİTÜSÜ / <DEPT>"
      ['title'],
      ['author'],
      ['degree_type'],             // "Yüksek Lisans Tezi" / "Doktora Tezi"
      ['advisor'],                 // "Danışman: <Name>"
      ['city_and_date'],           // "<City>, <Year>"
    ],
    titleUppercase: false,
    centerBlock: true,
  },
  abstract: {
    enabled: true,
    label: 'ÖZET',
    labelUppercase: true,
    dualLanguage: true, // TR özet + EN abstract, both required
    wordLimit: 250,
    structured: false,
    keywordsLabel: 'Anahtar Kelimeler',
  },
  toc: {
    enabled: true,
    label: 'İÇİNDEKİLER',
    labelUppercase: true,
    includeSections: true,
    includeSubsections: true,
    dotLeaders: true,
  },
  chapter: {
    newPage: true,
    numberStyle: 'ordinal-tr-upper',
    titleUppercase: false,
    align: 'center',
    gapAfterNumber: 1,
    gapAfterTitle: 2,
  },
  bibliography: {
    label: 'KAYNAKÇA',
    labelUppercase: true,
    align: 'center',
  },
  runningHead: {
    enabled: false,
    content: 'none',
    position: 'bottom-center',
  },
  pagination: {
    frontMatter: 'lower-roman',
    body: 'arabic',
    position: 'bottom-center',
    showOnTitlePage: false,
  },
}

export const STRUCTURAL_SPECS: Record<CitationFormat, StructuralSpec> = {
  APA,
  MLA,
  CHICAGO,
  HARVARD,
  TURABIAN,
  IEEE,
  VANCOUVER,
  AMA,
  ISNAD,
}

export function getStructuralSpec(format: CitationFormat): StructuralSpec {
  return STRUCTURAL_SPECS[format]
}

// =================================================================
//  HELPERS
// =================================================================

/** Arabic → lower-roman (1 → i, 2 → ii, …). Small range suffices for
 * typical front matter. */
export function toRoman(n: number, upper = false): string {
  const map: Array<[number, string]> = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'],
    [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'],
    [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
  ]
  let out = ''
  let remaining = n
  for (const [val, sym] of map) {
    while (remaining >= val) {
      out += sym
      remaining -= val
    }
  }
  return upper ? out.toUpperCase() : out
}

/** 1 → "BİRİNCİ", 2 → "İKİNCİ", … (up to 10 — covers typical thesis). */
const TR_ORDINAL_UPPER: Record<number, string> = {
  1: 'BİRİNCİ', 2: 'İKİNCİ', 3: 'ÜÇÜNCÜ', 4: 'DÖRDÜNCÜ', 5: 'BEŞİNCİ',
  6: 'ALTINCI', 7: 'YEDİNCİ', 8: 'SEKİZİNCİ', 9: 'DOKUZUNCU', 10: 'ONUNCU',
}

export function formatChapterNumber(n: number, style: ChapterNumberStyle, titleUppercase: boolean): string {
  switch (style) {
    case 'chapter-en':
      return `Chapter ${n}`
    case 'ordinal-tr-upper':
      return `${TR_ORDINAL_UPPER[n] ?? `${n}.`} BÖLÜM`
    case 'n-bolum-upper':
      return `${n}. BÖLÜM`
    case 'roman-intro':
      // IEEE uses Roman + uppercase heading; the number is just the
      // roman numeral and the title is rendered uppercase elsewhere.
      return toRoman(n, true)
    case 'numeric':
      return String(n)
    case 'none':
      return titleUppercase ? '' : ''
  }
}
