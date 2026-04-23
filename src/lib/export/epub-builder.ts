/**
 * Minimal EPUB 3 builder.
 *
 * Input: chapter bodies (each a list of parsed markdown blocks), metadata,
 * optional cover JPEG.
 * Output: Buffer holding a valid .epub (zip archive).
 *
 * The generated file is a conformant EPUB 3 package — mimetype entry first
 * and uncompressed, META-INF/container.xml pointing at OPS/content.opf,
 * nav.xhtml for the EPUB 3 table of contents, and toc.ncx retained for
 * EPUB 2 reader compatibility (Kindle legacy, older Nook).
 *
 * No external HTML/markdown deps — we convert a small, well-defined block
 * subset in-house so the output stays strict XHTML without cleanup passes.
 */

import JSZip from 'jszip'
import { randomUUID } from 'crypto'

// ---------------------------------------------------------------------------
// Public block types — caller parses content into these before calling.
// ---------------------------------------------------------------------------

export type EpubBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'bullet_list'; items: string[] }
  | { type: 'ordered_list'; items: string[] }
  | { type: 'blockquote'; text: string }
  | { type: 'hr' }
  | { type: 'image'; src: string; alt: string }

export interface EpubChapter {
  number: number
  title: string
  blocks: EpubBlock[]
}

export interface EpubMetadata {
  title: string
  author: string | null
  language: string
  /** Unique identifier — we generate a UUID if one isn't provided. */
  identifier?: string
  publisher?: string | null
  description?: string | null
}

export interface EpubStyleHints {
  bodyFontFamily?: string
  headingFontFamily?: string
  textColor?: string
  headingColor?: string
  accentColor?: string
  /** Chapter title alignment in the generated CSS. */
  chapterAlign?: 'left' | 'center'
  /** First-line indent pt value for body paragraphs. */
  firstLineIndentPt?: number
}

export interface BuildEpubOptions {
  metadata: EpubMetadata
  chapters: EpubChapter[]
  /** Cover image bytes + mime. JPG and PNG supported. */
  cover?: { data: Buffer; mime: 'image/jpeg' | 'image/png' } | null
  /** Inline images referenced from chapter blocks. Filename → bytes + mime. */
  inlineImages?: Record<string, { data: Buffer; mime: 'image/jpeg' | 'image/png' }>
  style?: EpubStyleHints
}

// ---------------------------------------------------------------------------
// XHTML utilities
// ---------------------------------------------------------------------------

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Convert a minimal markdown inline subset to XHTML.
 * Supported: **bold**, *italic*, `code`.
 * Everything else is escaped as text to avoid emitting invalid XML.
 */
function inlineMdToXhtml(text: string): string {
  // Escape first, then re-interpret markers (so "<script>" stays escaped
  // but **x** still becomes bold).
  const escaped = escapeXml(text)
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

function blockToXhtml(block: EpubBlock): string {
  switch (block.type) {
    case 'paragraph':
      return `<p>${inlineMdToXhtml(block.text)}</p>`
    case 'heading':
      return `<h${block.level}>${inlineMdToXhtml(block.text)}</h${block.level}>`
    case 'bullet_list':
      return `<ul>${block.items.map((i) => `<li>${inlineMdToXhtml(i)}</li>`).join('')}</ul>`
    case 'ordered_list':
      return `<ol>${block.items.map((i) => `<li>${inlineMdToXhtml(i)}</li>`).join('')}</ol>`
    case 'blockquote':
      return `<blockquote><p>${inlineMdToXhtml(block.text)}</p></blockquote>`
    case 'hr':
      return `<hr/>`
    case 'image':
      return `<figure class="inline-image"><img src="${escapeXml(block.src)}" alt="${escapeXml(block.alt)}"/></figure>`
  }
}

// ---------------------------------------------------------------------------
// EPUB file templates
// ---------------------------------------------------------------------------

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`

function buildStylesCss(style: EpubStyleHints): string {
  const body = style.bodyFontFamily ?? 'Georgia, "Times New Roman", serif'
  const heading = style.headingFontFamily ?? body
  const textColor = style.textColor ?? '#1a1a1a'
  const headingColor = style.headingColor ?? textColor
  const accent = style.accentColor ?? '#666666'
  const align = style.chapterAlign ?? 'center'
  const indent = (style.firstLineIndentPt ?? 18) / 2 // rough px equivalent

  return `@charset "utf-8";
body {
  font-family: ${body};
  color: ${textColor};
  line-height: 1.55;
  margin: 0;
  padding: 0;
}
h1, h2, h3 {
  font-family: ${heading};
  color: ${headingColor};
  line-height: 1.2;
  page-break-after: avoid;
}
.chapter-opener {
  text-align: ${align};
  margin-top: 3em;
  margin-bottom: 2em;
}
.chapter-opener .chapter-number {
  font-size: 0.9em;
  letter-spacing: 0.15em;
  color: ${accent};
  margin-bottom: 0.6em;
  text-transform: uppercase;
}
.chapter-opener h1 {
  font-size: 1.8em;
  margin: 0;
}
p {
  margin: 0;
  text-indent: ${indent}px;
  text-align: justify;
  orphans: 2;
  widows: 2;
}
p + p {
  margin-top: 0;
}
.chapter-opener + p,
h1 + p,
h2 + p,
h3 + p,
blockquote + p {
  text-indent: 0;
}
blockquote {
  margin: 1em 2em;
  font-style: italic;
  color: ${accent};
}
ul, ol {
  margin: 0.8em 0;
  padding-left: 2em;
}
figure.inline-image {
  text-align: center;
  margin: 1.2em 0;
}
figure.inline-image img {
  max-width: 100%;
  height: auto;
}
hr {
  border: none;
  border-top: 0.5px solid ${accent};
  width: 30%;
  margin: 1.6em auto;
}
.cover-page {
  margin: 0;
  padding: 0;
  text-align: center;
}
.cover-page img {
  max-width: 100%;
  height: auto;
}
`
}

function chapterXhtml(chapter: EpubChapter, lang: string): string {
  const body = chapter.blocks.map(blockToXhtml).join('\n  ')
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(lang)}" xml:lang="${escapeXml(lang)}">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(chapter.title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <section epub:type="chapter">
    <header class="chapter-opener">
      <p class="chapter-number">Chapter ${chapter.number}</p>
      <h1>${escapeXml(chapter.title)}</h1>
    </header>
    ${body}
  </section>
</body>
</html>`
}

function coverXhtml(lang: string, coverSrc: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(lang)}" xml:lang="${escapeXml(lang)}">
<head>
  <meta charset="utf-8"/>
  <title>Cover</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body class="cover-page">
  <section epub:type="cover">
    <img src="${escapeXml(coverSrc)}" alt="Cover"/>
  </section>
</body>
</html>`
}

function titlePageXhtml(meta: EpubMetadata): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(meta.language)}" xml:lang="${escapeXml(meta.language)}">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(meta.title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <section epub:type="titlepage" style="text-align:center;margin-top:6em;">
    <h1 style="font-size:2em;">${escapeXml(meta.title)}</h1>
    ${meta.author ? `<p style="margin-top:2em;font-size:1.1em;">${escapeXml(meta.author)}</p>` : ''}
    ${meta.publisher ? `<p style="margin-top:6em;font-size:0.9em;">${escapeXml(meta.publisher)}</p>` : ''}
  </section>
</body>
</html>`
}

function navXhtml(chapters: EpubChapter[], lang: string, hasCover: boolean): string {
  const coverLink = hasCover ? '<li><a href="cover.xhtml">Cover</a></li>' : ''
  const items = chapters
    .map((c) => `<li><a href="chapter-${c.number}.xhtml">${escapeXml(c.title)}</a></li>`)
    .join('\n      ')
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(lang)}" xml:lang="${escapeXml(lang)}">
<head>
  <meta charset="utf-8"/>
  <title>Contents</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
      ${coverLink}
      <li><a href="title.xhtml">Title Page</a></li>
      ${items}
    </ol>
  </nav>
</body>
</html>`
}

function ncxXml(chapters: EpubChapter[], meta: EpubMetadata, id: string): string {
  const navPoints = chapters
    .map(
      (c, idx) => `<navPoint id="np-${c.number}" playOrder="${idx + 2}">
  <navLabel><text>${escapeXml(c.title)}</text></navLabel>
  <content src="chapter-${c.number}.xhtml"/>
</navPoint>`
    )
    .join('\n')

  return `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head>
  <meta name="dtb:uid" content="${escapeXml(id)}"/>
  <meta name="dtb:depth" content="1"/>
  <meta name="dtb:totalPageCount" content="0"/>
  <meta name="dtb:maxPageNumber" content="0"/>
</head>
<docTitle><text>${escapeXml(meta.title)}</text></docTitle>
<navMap>
  <navPoint id="title" playOrder="1">
    <navLabel><text>Title Page</text></navLabel>
    <content src="title.xhtml"/>
  </navPoint>
  ${navPoints}
</navMap>
</ncx>`
}

function opfXml(
  chapters: EpubChapter[],
  meta: EpubMetadata,
  id: string,
  hasCover: boolean,
  coverMime: string | null,
  inlineImages: Record<string, { data: Buffer; mime: string }>
): string {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')

  const manifestItems = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `<item id="styles" href="styles.css" media-type="text/css"/>`,
    `<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>`,
    hasCover
      ? `<item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>`
      : '',
    hasCover && coverMime
      ? `<item id="cover-image" href="images/cover.${coverMime === 'image/png' ? 'png' : 'jpg'}" media-type="${coverMime}" properties="cover-image"/>`
      : '',
    ...chapters.map(
      (c) =>
        `<item id="ch-${c.number}" href="chapter-${c.number}.xhtml" media-type="application/xhtml+xml"/>`
    ),
    ...Object.entries(inlineImages).map(
      ([filename, img], i) =>
        `<item id="img-${i}" href="images/${filename}" media-type="${img.mime}"/>`
    ),
  ].filter(Boolean).join('\n    ')

  const spineItems = [
    hasCover ? `<itemref idref="cover-page"/>` : '',
    `<itemref idref="title"/>`,
    ...chapters.map((c) => `<itemref idref="ch-${c.number}"/>`),
  ].filter(Boolean).join('\n    ')

  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${escapeXml(meta.language)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:${escapeXml(id)}</dc:identifier>
    <dc:title>${escapeXml(meta.title)}</dc:title>
    <dc:language>${escapeXml(meta.language)}</dc:language>
    ${meta.author ? `<dc:creator>${escapeXml(meta.author)}</dc:creator>` : ''}
    ${meta.publisher ? `<dc:publisher>${escapeXml(meta.publisher)}</dc:publisher>` : ''}
    ${meta.description ? `<dc:description>${escapeXml(meta.description)}</dc:description>` : ''}
    <meta property="dcterms:modified">${now}</meta>
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine toc="ncx">
    ${spineItems}
  </spine>
</package>`
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export async function buildEpub(opts: BuildEpubOptions): Promise<Buffer> {
  const id = opts.metadata.identifier ?? randomUUID()
  const zip = new JSZip()

  // 1. mimetype — MUST be the first entry, uncompressed.
  zip.file('mimetype', 'application/epub+zip', {
    compression: 'STORE',
    createFolders: false,
  })

  // 2. META-INF/container.xml
  zip.folder('META-INF')!.file('container.xml', CONTAINER_XML)

  const ops = zip.folder('OPS')!
  const images = ops.folder('images')!

  // Stylesheet
  ops.file('styles.css', buildStylesCss(opts.style ?? {}))

  // Cover
  const hasCover = !!opts.cover
  if (opts.cover) {
    const ext = opts.cover.mime === 'image/png' ? 'png' : 'jpg'
    images.file(`cover.${ext}`, opts.cover.data)
    ops.file('cover.xhtml', coverXhtml(opts.metadata.language, `images/cover.${ext}`))
  }

  // Title page
  ops.file('title.xhtml', titlePageXhtml(opts.metadata))

  // Chapters
  for (const ch of opts.chapters) {
    ops.file(`chapter-${ch.number}.xhtml`, chapterXhtml(ch, opts.metadata.language))
  }

  // Inline images (if any)
  for (const [filename, img] of Object.entries(opts.inlineImages ?? {})) {
    images.file(filename, img.data)
  }

  // TOC (EPUB 3)
  ops.file('nav.xhtml', navXhtml(opts.chapters, opts.metadata.language, hasCover))

  // TOC (EPUB 2 legacy)
  ops.file('toc.ncx', ncxXml(opts.chapters, opts.metadata, id))

  // Package document
  ops.file(
    'content.opf',
    opfXml(
      opts.chapters,
      opts.metadata,
      id,
      hasCover,
      opts.cover?.mime ?? null,
      opts.inlineImages ?? {}
    )
  )

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

// ---------------------------------------------------------------------------
// Helper: convert the route's parseMarkdownBlocks output to EpubBlock[].
// The two types overlap except that EPUB rejects the 'table' variant — we
// serialise tables as a bullet list of cell strings to keep output valid.
// ---------------------------------------------------------------------------

export type RouteMdBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: 2 | 3; text: string }
  | { type: 'bullet_list'; items: string[] }
  | { type: 'ordered_list'; items: string[] }
  | { type: 'blockquote'; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'hr' }

export function routeBlocksToEpubBlocks(blocks: RouteMdBlock[]): EpubBlock[] {
  const out: EpubBlock[] = []
  for (const b of blocks) {
    if (b.type === 'table') {
      // Simple flattened rendering — dedicated table support could come later.
      out.push({
        type: 'paragraph',
        text: b.headers.join(' · '),
      })
      for (const row of b.rows) {
        out.push({ type: 'paragraph', text: row.join(' · ') })
      }
    } else {
      out.push(b)
    }
  }
  return out
}
