/**
 * Unified Book Style bundles.
 *
 * A book style is the single decision users make about how their book looks
 * and reads: it cascades into (a) the art style used for illustrations and
 * (b) the complete BookDesign spec (typography, margins, colors, image
 * layout). Keeping these paired here is what prevents the "picked cartoon
 * art but got novel typography" mismatch.
 *
 * Shape of `design` matches the BookDesign interface used by
 * src/app/projects/[id]/design/page.tsx.
 */

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
}

export const BOOK_STYLES: BookStyleBundle[] = [
  {
    id: 'children_cartoon',
    label: 'Çocuk / Karikatür',
    desc: 'Büyük yazı, canlı renkler, tam sayfa çizimler',
    artStyle: 'children_book',
    design: {
      bodyFont: 'Sans-serif', bodyFontSize: 16, headingFont: 'Sans-serif Bold', headingFontSize: 28,
      lineHeight: 1.8, paragraphSpacing: 12, firstLineIndent: 0, textAlign: 'left',
      pageSize: 'A4', marginTop: 72, marginBottom: 72, marginLeft: 72, marginRight: 72,
      chapterTitleSize: 32, chapterTitleAlign: 'center', chapterTitleStyle: 'bold',
      sectionTitleSize: 22, subsectionTitleSize: 18,
      imageLayout: 'full_page', imageWidthPercent: 90, imagePosition: 'before',
      textColor: '#2D1F0E', headingColor: '#C9A84C', accentColor: '#E8A838',
      showPageNumbers: true, pageNumberPosition: 'bottom-center', showChapterDivider: true,
    },
  },
  {
    id: 'novel_classic',
    label: 'Klasik Roman',
    desc: 'Serif yazı, 5x8, sade iç görsel',
    artStyle: 'oil_painting',
    design: {
      bodyFont: 'Serif (default)', bodyFontSize: 11, headingFont: 'Serif Bold', headingFontSize: 18,
      lineHeight: 1.6, paragraphSpacing: 4, firstLineIndent: 24, textAlign: 'justify',
      pageSize: '5x8', marginTop: 54, marginBottom: 54, marginLeft: 54, marginRight: 54,
      chapterTitleSize: 22, chapterTitleAlign: 'center', chapterTitleStyle: 'bold',
      sectionTitleSize: 14, subsectionTitleSize: 12,
      imageLayout: 'inline_right', imageWidthPercent: 40, imagePosition: 'after',
      textColor: '#1a1a1a', headingColor: '#1a1a1a', accentColor: '#666666',
      showPageNumbers: true, pageNumberPosition: 'bottom-center', showChapterDivider: true,
    },
  },
  {
    id: 'memoir',
    label: 'Anı / Yumuşak Roman',
    desc: 'Sulu boya görseller, sıcak serif',
    artStyle: 'watercolor',
    design: {
      bodyFont: 'Serif (default)', bodyFontSize: 11, headingFont: 'Serif', headingFontSize: 17,
      lineHeight: 1.7, paragraphSpacing: 6, firstLineIndent: 18, textAlign: 'left',
      pageSize: '5x8', marginTop: 60, marginBottom: 60, marginLeft: 60, marginRight: 60,
      chapterTitleSize: 20, chapterTitleAlign: 'center', chapterTitleStyle: 'italic',
      sectionTitleSize: 14, subsectionTitleSize: 12,
      imageLayout: 'center', imageWidthPercent: 65, imagePosition: 'before',
      textColor: '#2D1F0E', headingColor: '#5C4A32', accentColor: '#A68B5B',
      showPageNumbers: true, pageNumberPosition: 'bottom-center', showChapterDivider: true,
    },
  },
  {
    id: 'poetry',
    label: 'Şiir',
    desc: 'A5, italik serif, ortalı, kurşun kalem eskiz',
    artStyle: 'pencil_sketch',
    design: {
      bodyFont: 'Serif Italic', bodyFontSize: 13, headingFont: 'Serif Bold', headingFontSize: 20,
      lineHeight: 2.0, paragraphSpacing: 12, firstLineIndent: 0, textAlign: 'center',
      pageSize: 'A5', marginTop: 72, marginBottom: 72, marginLeft: 54, marginRight: 54,
      chapterTitleSize: 22, chapterTitleAlign: 'center', chapterTitleStyle: 'italic',
      sectionTitleSize: 16, subsectionTitleSize: 13,
      imageLayout: 'center', imageWidthPercent: 60, imagePosition: 'before',
      textColor: '#2D1F0E', headingColor: '#5C4A32', accentColor: '#C9A84C',
      showPageNumbers: true, pageNumberPosition: 'bottom-center', showChapterDivider: true,
    },
  },
  {
    id: 'magazine',
    label: 'Magazin / Editoryal',
    desc: 'Sans-serif, modern, iki sütun hissi',
    artStyle: 'digital_art',
    design: {
      bodyFont: 'Sans-serif', bodyFontSize: 10, headingFont: 'Sans-serif Bold', headingFontSize: 20,
      lineHeight: 1.4, paragraphSpacing: 6, firstLineIndent: 0, textAlign: 'left',
      pageSize: 'A4', marginTop: 54, marginBottom: 54, marginLeft: 54, marginRight: 54,
      chapterTitleSize: 26, chapterTitleAlign: 'left', chapterTitleStyle: 'bold',
      sectionTitleSize: 16, subsectionTitleSize: 12,
      imageLayout: 'half_page', imageWidthPercent: 60, imagePosition: 'before',
      textColor: '#222222', headingColor: '#0066cc', accentColor: '#0066cc',
      showPageNumbers: true, pageNumberPosition: 'bottom-outside', showChapterDivider: false,
    },
  },
  {
    id: 'graphic_novel',
    label: 'Grafik Roman / Manga',
    desc: 'Anime stili, tam sayfa paneller',
    artStyle: 'anime',
    design: {
      bodyFont: 'Sans-serif', bodyFontSize: 11, headingFont: 'Sans-serif Bold', headingFontSize: 22,
      lineHeight: 1.5, paragraphSpacing: 8, firstLineIndent: 0, textAlign: 'left',
      pageSize: 'A4', marginTop: 36, marginBottom: 36, marginLeft: 36, marginRight: 36,
      chapterTitleSize: 28, chapterTitleAlign: 'center', chapterTitleStyle: 'bold',
      sectionTitleSize: 18, subsectionTitleSize: 14,
      imageLayout: 'full_page', imageWidthPercent: 95, imagePosition: 'before',
      textColor: '#111111', headingColor: '#111111', accentColor: '#d94f4f',
      showPageNumbers: true, pageNumberPosition: 'bottom-outside', showChapterDivider: false,
    },
  },
  {
    id: 'realistic',
    label: 'Gerçekçi',
    desc: 'Fotoğraf-gerçekçi görseller, klasik roman layout',
    artStyle: 'realistic',
    design: {
      bodyFont: 'Serif (default)', bodyFontSize: 11, headingFont: 'Serif Bold', headingFontSize: 18,
      lineHeight: 1.6, paragraphSpacing: 4, firstLineIndent: 24, textAlign: 'justify',
      pageSize: '5x8', marginTop: 54, marginBottom: 54, marginLeft: 54, marginRight: 54,
      chapterTitleSize: 22, chapterTitleAlign: 'center', chapterTitleStyle: 'bold',
      sectionTitleSize: 14, subsectionTitleSize: 12,
      imageLayout: 'center', imageWidthPercent: 70, imagePosition: 'after',
      textColor: '#1a1a1a', headingColor: '#1a1a1a', accentColor: '#666666',
      showPageNumbers: true, pageNumberPosition: 'bottom-center', showChapterDivider: true,
    },
  },
]

/**
 * Find the bundle whose (artStyle + design) best matches the current project
 * settings. Returns null when nothing matches cleanly — the user is in
 * "custom" mode (override individual fields).
 */
export function detectBundleId(
  currentArtStyle: string | null | undefined,
  currentDesign: Partial<BookDesign> | null | undefined
): string | null {
  if (!currentArtStyle || !currentDesign) return null
  const match = BOOK_STYLES.find(
    (b) =>
      b.artStyle === currentArtStyle &&
      b.design.pageSize === currentDesign.pageSize &&
      b.design.bodyFont === currentDesign.bodyFont &&
      b.design.imageLayout === currentDesign.imageLayout
  )
  return match?.id ?? null
}
