/**
 * Unified Book Style bundles.
 *
 * A book style is the single decision users make about how their book
 * looks and reads: it cascades into (a) the art style used for
 * illustrations, (b) the complete BookDesign spec (typography, margins,
 * colors, image layout), and (c) the CreativeStructuralSpec (chapter
 * opening, drop cap, scene break, running head, pagination).
 *
 * Shape of `design` matches the BookDesign interface used by
 * src/app/projects/[id]/design/page.tsx.
 */

import {
  CREATIVE_SPECS,
  type CreativeStructuralSpec,
} from './creative-specs'

export interface BookDesign {
  bodyFont: string
  bodyFontSize: number
  headingFont: string
  headingFontSize: number
  lineHeight: number
  paragraphSpacing: number
  firstLineIndent: number
  textAlign: string
  pageSize: string
  marginTop: number
  marginBottom: number
  marginLeft: number
  marginRight: number
  chapterTitleSize: number
  chapterTitleAlign: string
  chapterTitleStyle: string
  sectionTitleSize: number
  subsectionTitleSize: number
  imageLayout: string
  imageWidthPercent: number
  imagePosition: string
  textColor: string
  headingColor: string
  accentColor: string
  showPageNumbers: boolean
  pageNumberPosition: string
  showChapterDivider: boolean
}

export type ArtStyle =
  | 'watercolor'
  | 'digital_art'
  | 'pencil_sketch'
  | 'oil_painting'
  | 'anime'
  | 'children_book'
  | 'realistic'

export interface BookStyleBundle {
  id: string
  label: string
  desc: string
  artStyle: ArtStyle
  design: BookDesign
  structural: CreativeStructuralSpec
  /** Short list of trait chips shown on the preview card. */
  traits: string[]
}

export const BOOK_STYLES: BookStyleBundle[] = [
  {
    id: 'penguin_classics',
    label: 'Penguin Klasik',
    desc: 'Küçük ciltli klasik roman — serif, fleuron, roman rakam',
    artStyle: 'oil_painting',
    traits: ['Serif', 'Fleuron', 'Roman rakam', 'Small caps başlık'],
    structural: CREATIVE_SPECS.penguin_classics,
    design: {
      bodyFont: 'Serif (default)', bodyFontSize: 11, headingFont: 'Serif', headingFontSize: 16,
      lineHeight: 1.55, paragraphSpacing: 2, firstLineIndent: 24, textAlign: 'justify',
      pageSize: '5x8', marginTop: 54, marginBottom: 54, marginLeft: 54, marginRight: 54,
      chapterTitleSize: 18, chapterTitleAlign: 'center', chapterTitleStyle: 'normal',
      sectionTitleSize: 14, subsectionTitleSize: 12,
      imageLayout: 'center', imageWidthPercent: 50, imagePosition: 'after',
      textColor: '#1a1a1a', headingColor: '#1a1a1a', accentColor: '#8a7355',
      showPageNumbers: true, pageNumberPosition: 'bottom-outside', showChapterDivider: false,
    },
  },
  {
    id: 'new_yorker_essay',
    label: 'New Yorker Deneme',
    desc: 'Uzun deneme — büyük drop cap, asterism sahne arası',
    artStyle: 'watercolor',
    traits: ['Drop cap', 'Asterism', 'Small-caps running head', 'Elegant serif'],
    structural: CREATIVE_SPECS.new_yorker_essay,
    design: {
      bodyFont: 'Serif (default)', bodyFontSize: 11, headingFont: 'Serif Bold', headingFontSize: 17,
      lineHeight: 1.6, paragraphSpacing: 4, firstLineIndent: 20, textAlign: 'justify',
      pageSize: 'A5', marginTop: 60, marginBottom: 60, marginLeft: 60, marginRight: 60,
      chapterTitleSize: 20, chapterTitleAlign: 'left', chapterTitleStyle: 'normal',
      sectionTitleSize: 14, subsectionTitleSize: 12,
      imageLayout: 'center', imageWidthPercent: 65, imagePosition: 'before',
      textColor: '#1a1a1a', headingColor: '#1a1a1a', accentColor: '#b83a3a',
      showPageNumbers: true, pageNumberPosition: 'bottom-outside', showChapterDivider: false,
    },
  },
  {
    id: 'childrens_picture',
    label: 'Çocuk Resimli Kitap',
    desc: 'Büyük yazı, canlı renk, tam sayfa çizim — Little Golden Book ruhu',
    artStyle: 'children_book',
    traits: ['Sans-serif 16pt', 'Tam sayfa görsel', 'Sarı accent', 'Kelime chapter'],
    structural: CREATIVE_SPECS.childrens_picture,
    design: {
      bodyFont: 'Sans-serif', bodyFontSize: 16, headingFont: 'Sans-serif Bold', headingFontSize: 28,
      lineHeight: 1.8, paragraphSpacing: 12, firstLineIndent: 0, textAlign: 'left',
      pageSize: 'A4', marginTop: 72, marginBottom: 72, marginLeft: 72, marginRight: 72,
      chapterTitleSize: 32, chapterTitleAlign: 'center', chapterTitleStyle: 'bold',
      sectionTitleSize: 22, subsectionTitleSize: 18,
      imageLayout: 'full_page', imageWidthPercent: 90, imagePosition: 'before',
      textColor: '#2D1F0E', headingColor: '#C9A84C', accentColor: '#E8A838',
      showPageNumbers: true, pageNumberPosition: 'bottom-center', showChapterDivider: false,
    },
  },
  {
    id: 'moleskine_memoir',
    label: 'Moleskine Anı',
    desc: 'Defter hissi — italik serif, krem ton, yatay çizgi süsleme',
    artStyle: 'watercolor',
    traits: ['Italic serif', 'Krem ton', 'Yatay rule', 'Ortalı başlık'],
    structural: CREATIVE_SPECS.moleskine_memoir,
    design: {
      bodyFont: 'Serif (default)', bodyFontSize: 11, headingFont: 'Serif', headingFontSize: 17,
      lineHeight: 1.7, paragraphSpacing: 6, firstLineIndent: 18, textAlign: 'left',
      pageSize: '5.5x8.5', marginTop: 60, marginBottom: 60, marginLeft: 60, marginRight: 60,
      chapterTitleSize: 18, chapterTitleAlign: 'center', chapterTitleStyle: 'italic',
      sectionTitleSize: 14, subsectionTitleSize: 12,
      imageLayout: 'center', imageWidthPercent: 65, imagePosition: 'before',
      textColor: '#2D1F0E', headingColor: '#5C4A32', accentColor: '#A68B5B',
      showPageNumbers: true, pageNumberPosition: 'bottom-center', showChapterDivider: true,
    },
  },
  {
    id: 'japan_light_novel',
    label: 'Japon Light Novel',
    desc: 'Tankōbon cep boyutu — kompakt, dar margin, sade chapter',
    artStyle: 'anime',
    traits: ['5×8 cep', 'Kompakt serif', 'Dar margin', 'Chapter 1 stili'],
    structural: CREATIVE_SPECS.japan_light_novel,
    design: {
      bodyFont: 'Serif (default)', bodyFontSize: 10, headingFont: 'Sans-serif Bold', headingFontSize: 16,
      lineHeight: 1.45, paragraphSpacing: 3, firstLineIndent: 16, textAlign: 'justify',
      pageSize: '5x8', marginTop: 42, marginBottom: 42, marginLeft: 42, marginRight: 42,
      chapterTitleSize: 16, chapterTitleAlign: 'left', chapterTitleStyle: 'bold',
      sectionTitleSize: 13, subsectionTitleSize: 11,
      imageLayout: 'center', imageWidthPercent: 70, imagePosition: 'before',
      textColor: '#1a1a1a', headingColor: '#1a1a1a', accentColor: '#c94a6b',
      showPageNumbers: true, pageNumberPosition: 'bottom-outside', showChapterDivider: false,
    },
  },
  {
    id: 'vintage_paperback',
    label: 'Vintage Paperback',
    desc: '50-70\'ler pulp cep kitabı — büyük harf başlık, çift rule',
    artStyle: 'oil_painting',
    traits: ['UPPERCASE başlık', 'Çift rule', '*** sahne arası', 'Small-caps leadin'],
    structural: CREATIVE_SPECS.vintage_paperback,
    design: {
      bodyFont: 'Serif (default)', bodyFontSize: 10, headingFont: 'Serif Bold', headingFontSize: 16,
      lineHeight: 1.5, paragraphSpacing: 2, firstLineIndent: 20, textAlign: 'justify',
      pageSize: '5x8', marginTop: 48, marginBottom: 48, marginLeft: 48, marginRight: 48,
      chapterTitleSize: 16, chapterTitleAlign: 'center', chapterTitleStyle: 'bold',
      sectionTitleSize: 13, subsectionTitleSize: 11,
      imageLayout: 'center', imageWidthPercent: 60, imagePosition: 'before',
      textColor: '#111111', headingColor: '#111111', accentColor: '#8a3333',
      showPageNumbers: true, pageNumberPosition: 'bottom-outside', showChapterDivider: true,
    },
  },
  {
    id: 'graphic_novel',
    label: 'Grafik Roman / Manga',
    desc: 'Panel odaklı — minimal yazı, dev bölüm numarası, full-bleed',
    artStyle: 'anime',
    traits: ['Dev numeral', 'Tam sayfa panel', 'Sans-serif', 'Çıplak sayfa'],
    structural: CREATIVE_SPECS.graphic_novel,
    design: {
      bodyFont: 'Sans-serif', bodyFontSize: 11, headingFont: 'Sans-serif Bold', headingFontSize: 22,
      lineHeight: 1.5, paragraphSpacing: 8, firstLineIndent: 0, textAlign: 'left',
      pageSize: '6x9', marginTop: 30, marginBottom: 30, marginLeft: 30, marginRight: 30,
      chapterTitleSize: 48, chapterTitleAlign: 'center', chapterTitleStyle: 'bold',
      sectionTitleSize: 18, subsectionTitleSize: 14,
      imageLayout: 'full_page', imageWidthPercent: 100, imagePosition: 'before',
      textColor: '#111111', headingColor: '#111111', accentColor: '#d94f4f',
      showPageNumbers: true, pageNumberPosition: 'bottom-outside', showChapterDivider: false,
    },
  },
  {
    id: 'modern_editorial',
    label: 'Modern Editoryal',
    desc: 'Çağdaş sans-serif — iş/non-fiction için temiz, ferah',
    artStyle: 'digital_art',
    traits: ['Sans-serif', 'Sol hizalı', 'Chapter + section', 'Mavi accent'],
    structural: CREATIVE_SPECS.modern_editorial,
    design: {
      bodyFont: 'Sans-serif', bodyFontSize: 11, headingFont: 'Sans-serif Bold', headingFontSize: 20,
      lineHeight: 1.55, paragraphSpacing: 6, firstLineIndent: 0, textAlign: 'left',
      pageSize: '6x9', marginTop: 54, marginBottom: 54, marginLeft: 60, marginRight: 60,
      chapterTitleSize: 22, chapterTitleAlign: 'left', chapterTitleStyle: 'bold',
      sectionTitleSize: 15, subsectionTitleSize: 12,
      imageLayout: 'half_page', imageWidthPercent: 60, imagePosition: 'before',
      textColor: '#1a1a1a', headingColor: '#0066cc', accentColor: '#0066cc',
      showPageNumbers: true, pageNumberPosition: 'bottom-outside', showChapterDivider: false,
    },
  },
]

/**
 * Find the bundle whose (artStyle + design) best matches the current
 * project settings. Returns null when nothing matches cleanly — the
 * user is in "custom" mode (override individual fields).
 */
export function detectBundleId(
  currentArtStyle: string | null | undefined,
  currentDesign: Partial<BookDesign> | null | undefined
): string | null {
  if (!currentDesign) return null
  const match = BOOK_STYLES.find(
    (b) =>
      (currentArtStyle ? b.artStyle === currentArtStyle : true) &&
      b.design.pageSize === currentDesign.pageSize &&
      b.design.bodyFont === currentDesign.bodyFont &&
      b.design.headingColor === currentDesign.headingColor
  )
  return match?.id ?? null
}
