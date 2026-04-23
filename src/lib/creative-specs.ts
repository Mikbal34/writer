/**
 * Per-bundle structural specification for creative (non-academic) book
 * styles. Mirrors the role of `src/lib/export/structural-specs.ts` on
 * the academic side, but encodes trade-book conventions: chapter
 * opening style, drop caps, scene breaks, first-paragraph treatment,
 * running heads, pagination.
 *
 * References (clean-room derivation — no copyrighted material copied):
 *   Standard Ebooks Manual of Style — standardebooks.org/manual
 *   LaTeX memoir class documentation (ctan.org/pkg/memoir)
 *   Bringhurst, Elements of Typographic Style (general principles)
 *   Felici, The Complete Manual of Typography (drop caps, ornaments)
 */

// =================================================================
//  CHAPTER OPENING
// =================================================================

export type ChapterNumberStyle =
  | 'none'              // title only, no number
  | 'arabic'            // "1", "2"
  | 'roman-upper'       // "I", "II"
  | 'word-upper'        // "ONE", "TWO"
  | 'word-title'        // "One", "Two"
  | 'chapter-arabic'    // "Chapter 1"
  | 'chapter-roman'     // "Chapter I"

export type ChapterOrnament =
  | 'none'
  | 'horizontal-rule'   // thin line under chapter title
  | 'fleuron'           // ❦ or similar decorative flourish
  | 'asterism'          // ⁂
  | 'three-stars'       // * * *
  | 'dinkus'            // a single centered character

export type CreativeChapterOpeningSpec = {
  newPage: boolean
  /** Start the chapter on a new recto (right-hand) page in print. */
  newRecto: boolean
  numberStyle: ChapterNumberStyle
  numberSize: 'small' | 'medium' | 'large' | 'huge'
  titleUppercase: boolean
  titleCase: 'normal' | 'small-caps' | 'uppercase'
  align: 'center' | 'left'
  /** Ornament drawn between chapter number and title. */
  ornamentAbove: ChapterOrnament
  /** Ornament drawn below chapter title, before body. */
  ornamentBelow: ChapterOrnament
  /** Leave ~30% top margin before the number (traditional "sinkage"). */
  sinkage: 'none' | 'small' | 'medium' | 'large'
}

// =================================================================
//  DROP CAP
// =================================================================

export type DropCapSpec = {
  enabled: boolean
  /** Drop cap spans this many lines of body text. 0 disables. */
  lines: number
  /** Optional distinct family for the drop cap character only. */
  fontFamily: string | null
  /** "raised" = baseline aligned to body, "dropped" = sunk into paragraph. */
  style: 'dropped' | 'raised'
  /** Small caps for the first few words right after the drop cap. */
  smallCapsLeadin: boolean
}

// =================================================================
//  SCENE BREAK
// =================================================================

export type SceneBreakStyle =
  | 'blank-line'        // just an empty line
  | 'asterism'          // ⁂
  | 'three-asterisks'   // *  *  *
  | 'horizontal-rule'   // thin centered line
  | 'fleuron'           // ❦
  | 'dinkus'            // custom ornament character
  | 'thought-break'     // # (plain)

export type SceneBreakSpec = {
  style: SceneBreakStyle
  /** Character used when style is "dinkus" or "fleuron" — overrides default. */
  character: string | null
  align: 'center' | 'left'
  /** Extra vertical space around the break, in points. */
  spacingPt: number
}

// =================================================================
//  FIRST PARAGRAPH
// =================================================================

export type FirstParagraphTreatment =
  | 'indent-as-normal'    // same indent as every paragraph
  | 'no-indent'           // no indent on the paragraph that opens a chapter/scene
  | 'small-caps-leadin'   // first 2-4 words in small caps

export type FirstParagraphSpec = {
  chapter: FirstParagraphTreatment
  afterSceneBreak: FirstParagraphTreatment
}

// =================================================================
//  RUNNING HEAD
// =================================================================

export type RunningHeadContent =
  | 'none'
  | 'book-title'        // same on both verso and recto
  | 'book-title-author' // author name on verso, book title on recto
  | 'chapter-book'      // book on verso, chapter title on recto (standard novel)
  | 'author-title'      // author on verso, title on recto

export type CreativeRunningHeadSpec = {
  enabled: boolean
  content: RunningHeadContent
  position: 'top-outside' | 'top-inside' | 'top-center'
  /** Hide on chapter-opening pages. */
  hideOnChapterOpener: boolean
  /** Small caps / lowercase / normal for the running head text. */
  textCase: 'normal' | 'small-caps' | 'italic'
}

// =================================================================
//  PAGINATION
// =================================================================

export type CreativePaginationSpec = {
  /** Front matter (title, copyright, dedication, TOC): roman numerals usually. */
  frontMatter: 'lower-roman' | 'none'
  body: 'arabic' | 'none'
  position: 'bottom-center' | 'bottom-outside' | 'top-outside'
  /** Hide on chapter-opening pages (traditional convention). */
  hideOnChapterOpener: boolean
  showOnFirstPage: boolean
}

// =================================================================
//  TITLE PAGE
// =================================================================

export type CreativeTitlePageElement =
  | 'title'
  | 'subtitle'
  | 'author'
  | 'publisher'
  | 'series'
  | 'ornament'
  | 'edition'

export type CreativeTitlePageSpec = {
  enabled: boolean
  layout: 'centered-upper-third' | 'centered-middle' | 'left-aligned' | 'minimalist-top'
  /** Ordered groups, rendered with large gaps between them. */
  groups: CreativeTitlePageElement[][]
  titleCase: 'normal' | 'uppercase' | 'small-caps'
  showOrnament: boolean
}

// =================================================================
//  TABLE OF CONTENTS
// =================================================================

export type CreativeTocSpec = {
  enabled: boolean
  label: string
  labelCase: 'normal' | 'uppercase' | 'small-caps'
  dotLeaders: boolean
  /** Show only chapter rows (most trade books) vs chapter+section. */
  depth: 'chapters-only' | 'chapters-and-sections'
}

// =================================================================
//  FULL SPEC
// =================================================================

export interface CreativeStructuralSpec {
  titlePage: CreativeTitlePageSpec
  toc: CreativeTocSpec
  chapter: CreativeChapterOpeningSpec
  dropCap: DropCapSpec
  sceneBreak: SceneBreakSpec
  firstParagraph: FirstParagraphSpec
  runningHead: CreativeRunningHeadSpec
  pagination: CreativePaginationSpec
}

// =================================================================
//  TEMPLATE SPECS — 8 curated creative styles
// =================================================================

/**
 * Penguin Classics — small hardback/paperback novel, restrained serif,
 * ornament chapter openers, roman-numeral chapters, no drop cap.
 */
export const PENGUIN_CLASSICS: CreativeStructuralSpec = {
  titlePage: {
    enabled: true,
    layout: 'centered-upper-third',
    groups: [['title'], ['author'], ['publisher']],
    titleCase: 'normal',
    showOrnament: true,
  },
  toc: {
    enabled: true,
    label: 'Contents',
    labelCase: 'normal',
    dotLeaders: false,
    depth: 'chapters-only',
  },
  chapter: {
    newPage: true,
    newRecto: true,
    numberStyle: 'roman-upper',
    numberSize: 'medium',
    titleUppercase: false,
    titleCase: 'small-caps',
    align: 'center',
    ornamentAbove: 'fleuron',
    ornamentBelow: 'none',
    sinkage: 'medium',
  },
  dropCap: {
    enabled: false,
    lines: 0,
    fontFamily: null,
    style: 'dropped',
    smallCapsLeadin: true,
  },
  sceneBreak: {
    style: 'fleuron',
    character: '❦',
    align: 'center',
    spacingPt: 18,
  },
  firstParagraph: {
    chapter: 'no-indent',
    afterSceneBreak: 'no-indent',
  },
  runningHead: {
    enabled: true,
    content: 'chapter-book',
    position: 'top-outside',
    hideOnChapterOpener: true,
    textCase: 'small-caps',
  },
  pagination: {
    frontMatter: 'lower-roman',
    body: 'arabic',
    position: 'bottom-outside',
    hideOnChapterOpener: true,
    showOnFirstPage: false,
  },
}

/**
 * New Yorker Essay — elegant long-form essay collection. Large dropped
 * cap at chapter start, asterism scene breaks, small-caps running head.
 */
export const NEW_YORKER_ESSAY: CreativeStructuralSpec = {
  titlePage: {
    enabled: true,
    layout: 'centered-middle',
    groups: [['title'], ['subtitle', 'author']],
    titleCase: 'normal',
    showOrnament: false,
  },
  toc: {
    enabled: true,
    label: 'Contents',
    labelCase: 'small-caps',
    dotLeaders: false,
    depth: 'chapters-only',
  },
  chapter: {
    newPage: true,
    newRecto: false,
    numberStyle: 'arabic',
    numberSize: 'small',
    titleUppercase: false,
    titleCase: 'normal',
    align: 'left',
    ornamentAbove: 'horizontal-rule',
    ornamentBelow: 'none',
    sinkage: 'small',
  },
  dropCap: {
    enabled: true,
    lines: 3,
    fontFamily: null,
    style: 'dropped',
    smallCapsLeadin: true,
  },
  sceneBreak: {
    style: 'asterism',
    character: '⁂',
    align: 'center',
    spacingPt: 14,
  },
  firstParagraph: {
    chapter: 'no-indent',
    afterSceneBreak: 'no-indent',
  },
  runningHead: {
    enabled: true,
    content: 'chapter-book',
    position: 'top-outside',
    hideOnChapterOpener: true,
    textCase: 'small-caps',
  },
  pagination: {
    frontMatter: 'lower-roman',
    body: 'arabic',
    position: 'bottom-outside',
    hideOnChapterOpener: true,
    showOnFirstPage: false,
  },
}

/**
 * Children's Picture Book — big sans-serif, colorful chapter numbers,
 * full-page illustration openers, no drop cap, generous spacing.
 */
export const CHILDRENS_PICTURE: CreativeStructuralSpec = {
  titlePage: {
    enabled: true,
    layout: 'centered-middle',
    groups: [['title'], ['author'], ['publisher']],
    titleCase: 'normal',
    showOrnament: true,
  },
  toc: {
    enabled: false,
    label: 'Contents',
    labelCase: 'normal',
    dotLeaders: true,
    depth: 'chapters-only',
  },
  chapter: {
    newPage: true,
    newRecto: false,
    numberStyle: 'word-title',
    numberSize: 'huge',
    titleUppercase: false,
    titleCase: 'normal',
    align: 'center',
    ornamentAbove: 'none',
    ornamentBelow: 'none',
    sinkage: 'large',
  },
  dropCap: {
    enabled: false,
    lines: 0,
    fontFamily: null,
    style: 'dropped',
    smallCapsLeadin: false,
  },
  sceneBreak: {
    style: 'blank-line',
    character: null,
    align: 'center',
    spacingPt: 24,
  },
  firstParagraph: {
    chapter: 'no-indent',
    afterSceneBreak: 'no-indent',
  },
  runningHead: {
    enabled: false,
    content: 'none',
    position: 'top-center',
    hideOnChapterOpener: true,
    textCase: 'normal',
  },
  pagination: {
    frontMatter: 'none',
    body: 'arabic',
    position: 'bottom-center',
    hideOnChapterOpener: true,
    showOnFirstPage: false,
  },
}

/**
 * Moleskine Memoir — intimate personal-journal feel. Italic serif,
 * cream background, warm tones, small ornament scene breaks.
 */
export const MOLESKINE_MEMOIR: CreativeStructuralSpec = {
  titlePage: {
    enabled: true,
    layout: 'centered-upper-third',
    groups: [['title'], ['subtitle'], ['author']],
    titleCase: 'normal',
    showOrnament: false,
  },
  toc: {
    enabled: true,
    label: 'Contents',
    labelCase: 'normal',
    dotLeaders: false,
    depth: 'chapters-only',
  },
  chapter: {
    newPage: true,
    newRecto: false,
    numberStyle: 'none',
    numberSize: 'small',
    titleUppercase: false,
    titleCase: 'normal',
    align: 'center',
    ornamentAbove: 'horizontal-rule',
    ornamentBelow: 'horizontal-rule',
    sinkage: 'medium',
  },
  dropCap: {
    enabled: false,
    lines: 0,
    fontFamily: null,
    style: 'dropped',
    smallCapsLeadin: false,
  },
  sceneBreak: {
    style: 'three-asterisks',
    character: null,
    align: 'center',
    spacingPt: 16,
  },
  firstParagraph: {
    chapter: 'no-indent',
    afterSceneBreak: 'no-indent',
  },
  runningHead: {
    enabled: true,
    content: 'book-title',
    position: 'top-center',
    hideOnChapterOpener: true,
    textCase: 'italic',
  },
  pagination: {
    frontMatter: 'lower-roman',
    body: 'arabic',
    position: 'bottom-center',
    hideOnChapterOpener: true,
    showOnFirstPage: false,
  },
}

/**
 * Japan Light Novel — tankōbon-style pocket paperback. Narrow page,
 * compact serif, minimal margins, simple chapter numbering.
 */
export const JAPAN_LIGHT_NOVEL: CreativeStructuralSpec = {
  titlePage: {
    enabled: true,
    layout: 'centered-middle',
    groups: [['title'], ['author'], ['publisher']],
    titleCase: 'normal',
    showOrnament: false,
  },
  toc: {
    enabled: true,
    label: 'Contents',
    labelCase: 'normal',
    dotLeaders: true,
    depth: 'chapters-only',
  },
  chapter: {
    newPage: true,
    newRecto: false,
    numberStyle: 'chapter-arabic',
    numberSize: 'medium',
    titleUppercase: false,
    titleCase: 'normal',
    align: 'left',
    ornamentAbove: 'none',
    ornamentBelow: 'horizontal-rule',
    sinkage: 'small',
  },
  dropCap: {
    enabled: false,
    lines: 0,
    fontFamily: null,
    style: 'dropped',
    smallCapsLeadin: false,
  },
  sceneBreak: {
    style: 'horizontal-rule',
    character: null,
    align: 'center',
    spacingPt: 10,
  },
  firstParagraph: {
    chapter: 'indent-as-normal',
    afterSceneBreak: 'indent-as-normal',
  },
  runningHead: {
    enabled: true,
    content: 'chapter-book',
    position: 'top-outside',
    hideOnChapterOpener: true,
    textCase: 'normal',
  },
  pagination: {
    frontMatter: 'lower-roman',
    body: 'arabic',
    position: 'bottom-outside',
    hideOnChapterOpener: true,
    showOnFirstPage: false,
  },
}

/**
 * Vintage Paperback — 50s-70s pulp/mass-market novel. Compact serif,
 * centered chapter titles with a dividing rule, dense text.
 */
export const VINTAGE_PAPERBACK: CreativeStructuralSpec = {
  titlePage: {
    enabled: true,
    layout: 'centered-upper-third',
    groups: [['title'], ['author'], ['publisher']],
    titleCase: 'uppercase',
    showOrnament: true,
  },
  toc: {
    enabled: true,
    label: 'Contents',
    labelCase: 'uppercase',
    dotLeaders: true,
    depth: 'chapters-only',
  },
  chapter: {
    newPage: true,
    newRecto: false,
    numberStyle: 'arabic',
    numberSize: 'medium',
    titleUppercase: true,
    titleCase: 'uppercase',
    align: 'center',
    ornamentAbove: 'horizontal-rule',
    ornamentBelow: 'horizontal-rule',
    sinkage: 'small',
  },
  dropCap: {
    enabled: false,
    lines: 0,
    fontFamily: null,
    style: 'dropped',
    smallCapsLeadin: true,
  },
  sceneBreak: {
    style: 'three-asterisks',
    character: null,
    align: 'center',
    spacingPt: 12,
  },
  firstParagraph: {
    chapter: 'small-caps-leadin',
    afterSceneBreak: 'indent-as-normal',
  },
  runningHead: {
    enabled: true,
    content: 'chapter-book',
    position: 'top-outside',
    hideOnChapterOpener: true,
    textCase: 'small-caps',
  },
  pagination: {
    frontMatter: 'lower-roman',
    body: 'arabic',
    position: 'bottom-outside',
    hideOnChapterOpener: true,
    showOnFirstPage: false,
  },
}

/**
 * Graphic Novel / Manga — minimal text, full-page illustration
 * orientation. Short chapter titles, no drop cap, minimal furniture.
 */
export const GRAPHIC_NOVEL: CreativeStructuralSpec = {
  titlePage: {
    enabled: true,
    layout: 'minimalist-top',
    groups: [['title'], ['author']],
    titleCase: 'uppercase',
    showOrnament: false,
  },
  toc: {
    enabled: false,
    label: 'Contents',
    labelCase: 'normal',
    dotLeaders: false,
    depth: 'chapters-only',
  },
  chapter: {
    newPage: true,
    newRecto: false,
    numberStyle: 'arabic',
    numberSize: 'huge',
    titleUppercase: true,
    titleCase: 'uppercase',
    align: 'center',
    ornamentAbove: 'none',
    ornamentBelow: 'none',
    sinkage: 'large',
  },
  dropCap: {
    enabled: false,
    lines: 0,
    fontFamily: null,
    style: 'dropped',
    smallCapsLeadin: false,
  },
  sceneBreak: {
    style: 'blank-line',
    character: null,
    align: 'center',
    spacingPt: 20,
  },
  firstParagraph: {
    chapter: 'no-indent',
    afterSceneBreak: 'no-indent',
  },
  runningHead: {
    enabled: false,
    content: 'none',
    position: 'top-outside',
    hideOnChapterOpener: true,
    textCase: 'normal',
  },
  pagination: {
    frontMatter: 'none',
    body: 'arabic',
    position: 'bottom-outside',
    hideOnChapterOpener: true,
    showOnFirstPage: false,
  },
}

/**
 * Modern Editorial — clean sans-serif magazine/trade book. Small-caps
 * chapter numbers, horizontal rule openers, no drop cap, contemporary
 * feel. Good for business/non-fiction.
 */
export const MODERN_EDITORIAL: CreativeStructuralSpec = {
  titlePage: {
    enabled: true,
    layout: 'left-aligned',
    groups: [['title'], ['subtitle'], ['author']],
    titleCase: 'normal',
    showOrnament: false,
  },
  toc: {
    enabled: true,
    label: 'Contents',
    labelCase: 'small-caps',
    dotLeaders: false,
    depth: 'chapters-and-sections',
  },
  chapter: {
    newPage: true,
    newRecto: false,
    numberStyle: 'arabic',
    numberSize: 'large',
    titleUppercase: false,
    titleCase: 'normal',
    align: 'left',
    ornamentAbove: 'horizontal-rule',
    ornamentBelow: 'none',
    sinkage: 'small',
  },
  dropCap: {
    enabled: false,
    lines: 0,
    fontFamily: null,
    style: 'dropped',
    smallCapsLeadin: false,
  },
  sceneBreak: {
    style: 'horizontal-rule',
    character: null,
    align: 'center',
    spacingPt: 14,
  },
  firstParagraph: {
    chapter: 'no-indent',
    afterSceneBreak: 'no-indent',
  },
  runningHead: {
    enabled: true,
    content: 'chapter-book',
    position: 'top-outside',
    hideOnChapterOpener: true,
    textCase: 'small-caps',
  },
  pagination: {
    frontMatter: 'lower-roman',
    body: 'arabic',
    position: 'bottom-outside',
    hideOnChapterOpener: true,
    showOnFirstPage: false,
  },
}

/**
 * Lookup map for bundle id → spec. Used by BookStyleBundle catalog in
 * src/lib/book-styles.ts so UI and export code share a single source.
 */
export const CREATIVE_SPECS: Record<string, CreativeStructuralSpec> = {
  penguin_classics: PENGUIN_CLASSICS,
  new_yorker_essay: NEW_YORKER_ESSAY,
  childrens_picture: CHILDRENS_PICTURE,
  moleskine_memoir: MOLESKINE_MEMOIR,
  japan_light_novel: JAPAN_LIGHT_NOVEL,
  vintage_paperback: VINTAGE_PAPERBACK,
  graphic_novel: GRAPHIC_NOVEL,
  modern_editorial: MODERN_EDITORIAL,
}
