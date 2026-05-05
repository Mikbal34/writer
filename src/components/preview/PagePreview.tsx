'use client'

/**
 * Reusable book-page preview. Renders one or many pages at the
 * project's configured pageSize (A4/A5/B5/…) using the BookDesign
 * typography, margins, and page-number placement.
 *
 *  - No `contentHtml` (sample / design-page mode) → one or two
 *    lorem-ipsum pages, used by the design sidebar.
 *  - With `contentHtml` (writing-editor preview) → the body is
 *    measured once, then split across N A4-shaped pages stacked
 *    vertically; spread mode pairs them into spreads. There is no
 *    inner scroll — the parent container handles vertical scrolling
 *    so the user reads the document page-by-page like a real book.
 */
import type { BookDesign } from '@/lib/book-styles'
import React from 'react'

const PAGE_ASPECTS: Record<string, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
  B5: { w: 176, h: 250 },
  '16x24cm': { w: 160, h: 240 },
  '17x24cm': { w: 170, h: 240 },
  '5x8': { w: 127, h: 203 },
  '5.5x8.5': { w: 140, h: 216 },
  '6x9': { w: 152, h: 229 },
  letter: { w: 216, h: 279 },
}

const PAGE_SIZE_PT_WIDTH: Record<string, number> = {
  A4: 595,
  A5: 420,
  B5: 499,
  '16x24cm': 454,
  '17x24cm': 482,
  '6x9': 432,
  '5x8': 360,
  '5.5x8.5': 396,
  letter: 612,
}

export type PagePreviewMode = 'single' | 'spread'

export interface PagePreviewProps {
  design: BookDesign
  /** 'single' = one column of pages, 'spread' = pages paired side by side */
  mode?: PagePreviewMode
  /**
   * Pre-rendered HTML for the body text. When omitted we fall back to
   * the legacy sample (Chapter 1 / lorem-ipsum) so the design page
   * still gets a meaningful preview without real content.
   */
  contentHtml?: string
  /** Width of a single page in CSS pixels. */
  pageWidthPx?: number
  /** Show the small "A4 · serif 12pt" caption underneath. */
  showCaption?: boolean
  className?: string
}

export function PagePreview({
  design,
  mode = 'spread',
  contentHtml,
  pageWidthPx = 110,
  showCaption = true,
  className,
}: PagePreviewProps) {
  const dims = PAGE_ASPECTS[design.pageSize] ?? PAGE_ASPECTS.A4
  const pageW = pageWidthPx
  const previewH = Math.round((dims.h / dims.w) * pageW)
  const pageWidthPt = PAGE_SIZE_PT_WIDTH[design.pageSize] ?? 595
  const ptToPx = (pt: number) => (pt / pageWidthPt) * pageW

  if (contentHtml) {
    return (
      <MultiPagePreview
        design={design}
        mode={mode}
        contentHtml={contentHtml}
        pageW={pageW}
        pageH={previewH}
        ptToPx={ptToPx}
        showCaption={showCaption}
        className={className}
      />
    )
  }

  // Sample mode (no real content): keep the legacy single-spread render.
  return (
    <div className={`flex flex-col items-center gap-2 ${className ?? ''}`}>
      <div className="flex shadow-md rounded-sm overflow-hidden" style={{ background: '#d4c9b5' }}>
        {mode === 'spread' ? (
          <>
            <SamplePage design={design} side="verso" pageW={pageW} previewH={previewH} ptToPx={ptToPx} />
            <div style={{ width: 1, background: '#a89e8b' }} aria-hidden />
            <SamplePage design={design} side="recto" pageW={pageW} previewH={previewH} ptToPx={ptToPx} />
          </>
        ) : (
          <SamplePage design={design} side="recto" pageW={pageW} previewH={previewH} ptToPx={ptToPx} />
        )}
      </div>
      {showCaption && (
        <p className="font-ui text-[10px] text-muted-foreground">
          {design.pageSize} · {design.bodyFont} {design.bodyFontSize}pt
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Multi-page preview: measure → split → render N clipped pages.
// ---------------------------------------------------------------------------

interface MultiPageProps {
  design: BookDesign
  mode: PagePreviewMode
  contentHtml: string
  pageW: number
  pageH: number
  ptToPx: (pt: number) => number
  showCaption?: boolean
  className?: string
}

function MultiPagePreview({
  design,
  mode,
  contentHtml,
  pageW,
  pageH,
  ptToPx,
  showCaption,
  className,
}: MultiPageProps) {
  const measureRef = React.useRef<HTMLDivElement | null>(null)
  const [pageCount, setPageCount] = React.useState(1)

  const contentLeft = ptToPx(design.marginLeft)
  const contentTop = ptToPx(design.marginTop)
  const contentRight = ptToPx(design.marginRight)
  const contentBottom = ptToPx(design.marginBottom)
  const contentWidth = pageW - contentLeft - contentRight
  const pageContentH = pageH - contentTop - contentBottom

  // Body styling — same for the measurement node and every visible page
  // so heights line up. We strip color here; the page-level <div> below
  // re-applies it (color doesn't affect layout, so leaving it on the
  // measurement div would only complicate dark-mode flickers).
  const bodyStyle: React.CSSProperties = {
    fontSize: ptToPx(design.bodyFontSize),
    lineHeight: design.lineHeight,
    color: design.textColor,
    textAlign: design.textAlign as React.CSSProperties['textAlign'],
    fontFamily: 'serif',
  }

  const paragraphIndent = design.firstLineIndent ? ptToPx(design.firstLineIndent) : 0
  const paragraphSpacing = ptToPx(design.paragraphSpacing)

  const styleId = React.useId().replace(/[^\w]/g, '')
  const bodyClass = `pp-body-${styleId}`
  const bodyCss =
    `.${bodyClass} p { margin-bottom: ${paragraphSpacing}px;` +
    (paragraphIndent ? ` text-indent: ${paragraphIndent}px;` : '') +
    ` }` +
    `.${bodyClass} h2, .${bodyClass} h3 { font-weight: 600; margin-top: 0.5em; margin-bottom: 0.3em; line-height: 1.2; }` +
    `.${bodyClass} h2 { font-size: 1.2em; }` +
    `.${bodyClass} h3 { font-size: 1.05em; }` +
    `.${bodyClass} em { font-style: italic; }` +
    `.${bodyClass} strong { font-weight: 600; }`

  React.useLayoutEffect(() => {
    if (!measureRef.current) return
    const measured = measureRef.current.scrollHeight
    if (measured > 0 && pageContentH > 0) {
      const next = Math.max(1, Math.ceil(measured / pageContentH))
      setPageCount((prev) => (prev === next ? prev : next))
    }
  }, [contentHtml, pageContentH, contentWidth, paragraphSpacing, paragraphIndent])

  // Group pages: single → one page per row, spread → pairs.
  const groups: number[][] =
    mode === 'spread'
      ? Array.from({ length: Math.ceil(pageCount / 2) }, (_, i) =>
          [i * 2, i * 2 + 1].filter((p) => p < pageCount),
        )
      : Array.from({ length: pageCount }, (_, i) => [i])

  return (
    <div className={`flex flex-col items-center gap-4 ${className ?? ''}`}>
      <style>{bodyCss}</style>

      {/* Off-screen measurement — same width and styling as a single
          page's content area so heights match the visible pages. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: -99999,
          top: 0,
          visibility: 'hidden',
          pointerEvents: 'none',
          width: contentWidth,
        }}
      >
        <div
          ref={measureRef}
          className={bodyClass}
          style={bodyStyle}
          dangerouslySetInnerHTML={{ __html: contentHtml }}
        />
      </div>

      {groups.map((group, gi) => (
        <div
          key={gi}
          className="flex shadow-md rounded-sm overflow-hidden"
          style={{ background: '#d4c9b5' }}
        >
          {group.map((pageIdx, posInGroup) => (
            <React.Fragment key={pageIdx}>
              {posInGroup === 1 && (
                <div style={{ width: 1, background: '#a89e8b' }} aria-hidden />
              )}
              <PageSlice
                design={design}
                pageIdx={pageIdx}
                inSpread={mode === 'spread'}
                positionInSpread={mode === 'spread' ? (posInGroup === 0 ? 'verso' : 'recto') : 'recto'}
                pageW={pageW}
                pageH={pageH}
                pageContentH={pageContentH}
                contentTop={contentTop}
                contentBottom={contentBottom}
                contentLeft={contentLeft}
                contentRight={contentRight}
                ptToPx={ptToPx}
                bodyClass={bodyClass}
                bodyStyle={bodyStyle}
                contentHtml={contentHtml}
              />
            </React.Fragment>
          ))}
        </div>
      ))}

      {showCaption && (
        <p className="font-ui text-[10px] text-muted-foreground">
          {design.pageSize} · {design.bodyFont} {design.bodyFontSize}pt
          {pageCount > 1 ? ` · ${pageCount} pages` : ''}
        </p>
      )}
    </div>
  )
}

interface PageSliceProps {
  design: BookDesign
  pageIdx: number
  inSpread: boolean
  positionInSpread: 'verso' | 'recto'
  pageW: number
  pageH: number
  pageContentH: number
  contentTop: number
  contentBottom: number
  contentLeft: number
  contentRight: number
  ptToPx: (pt: number) => number
  bodyClass: string
  bodyStyle: React.CSSProperties
  contentHtml: string
}

function PageSlice({
  design,
  pageIdx,
  inSpread,
  positionInSpread,
  pageW,
  pageH,
  pageContentH,
  contentTop,
  contentBottom,
  contentLeft,
  contentRight,
  ptToPx,
  bodyClass,
  bodyStyle,
  contentHtml,
}: PageSliceProps) {
  const pageNumber = pageIdx + 1

  const pageNumLeftSide =
    design.pageNumberPosition === 'bottom-outside'
      ? inSpread
        ? positionInSpread === 'verso'
          ? 'left'
          : 'right'
        : 'right'
      : 'center'

  return (
    <div
      className="relative bg-white shadow-md overflow-hidden"
      style={{
        width: pageW,
        height: pageH,
        borderRadius:
          inSpread && positionInSpread === 'verso'
            ? '2px 0 0 2px'
            : inSpread && positionInSpread === 'recto'
              ? '0 2px 2px 0'
              : '2px',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: contentTop,
          bottom: contentBottom,
          left: contentLeft,
          right: contentRight,
          overflow: 'hidden',
        }}
      >
        <div
          className={bodyClass}
          style={{
            ...bodyStyle,
            transform: `translateY(-${pageIdx * pageContentH}px)`,
            willChange: 'transform',
          }}
          dangerouslySetInnerHTML={{ __html: contentHtml }}
        />
      </div>

      {design.showPageNumbers && (
        <div
          style={{
            position: 'absolute',
            bottom: ptToPx(design.marginBottom) * 0.4,
            left:
              pageNumLeftSide === 'left'
                ? ptToPx(design.marginLeft)
                : pageNumLeftSide === 'center'
                  ? '50%'
                  : 'auto',
            right:
              pageNumLeftSide === 'right' ? ptToPx(design.marginRight) : 'auto',
            transform: pageNumLeftSide === 'center' ? 'translateX(-50%)' : undefined,
            fontSize: ptToPx(8),
            color: design.textColor,
            opacity: 0.6,
          }}
        >
          {pageNumber}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sample / lorem-ipsum page used by the design sidebar when no real
// content is available. Preserves the legacy "Chapter 1 / The Beginning"
// + body for each page side. Kept inline so the multi-page path doesn't
// have to handle the sample-only widgets (image placeholders, etc.).
// ---------------------------------------------------------------------------

interface SamplePageProps {
  design: BookDesign
  side: 'verso' | 'recto'
  pageW: number
  previewH: number
  ptToPx: (pt: number) => number
}

function SamplePage({ design, side, pageW, previewH, ptToPx }: SamplePageProps) {
  const isVerso = side === 'verso'
  const isRecto = side === 'recto'
  const pageNumber = isVerso ? 2 : 3

  const chapterTitleWeight =
    design.chapterTitleStyle === 'bold' || design.chapterTitleStyle === 'bold-italic'
      ? 'bold'
      : 'normal'
  const chapterTitleFontStyle =
    design.chapterTitleStyle === 'italic' || design.chapterTitleStyle === 'bold-italic'
      ? 'italic'
      : 'normal'

  const pageNumLeftSide =
    design.pageNumberPosition === 'bottom-outside'
      ? isVerso
        ? 'left'
        : 'right'
      : 'center'

  const bodyStyle: React.CSSProperties = {
    fontSize: ptToPx(design.bodyFontSize),
    lineHeight: design.lineHeight,
    color: design.textColor,
    textAlign: design.textAlign as React.CSSProperties['textAlign'],
    fontFamily: 'serif',
  }

  const paragraphIndent = design.firstLineIndent ? ptToPx(design.firstLineIndent) : 0
  const paragraphSpacing = ptToPx(design.paragraphSpacing)
  const paragraphStyle: React.CSSProperties = {
    marginBottom: paragraphSpacing,
    textIndent: paragraphIndent || undefined,
  }

  return (
    <div
      className="relative bg-white shadow-md overflow-hidden"
      style={{
        width: pageW,
        height: previewH,
        borderRadius: isVerso ? '2px 0 0 2px' : '0 2px 2px 0',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: ptToPx(design.marginTop),
          bottom: ptToPx(design.marginBottom),
          left: ptToPx(design.marginLeft),
          right: ptToPx(design.marginRight),
          overflow: 'hidden',
        }}
      >
        {isRecto && (
          <>
            <div
              style={{
                fontSize: ptToPx(design.chapterTitleSize) * 0.75,
                fontWeight: chapterTitleWeight,
                fontStyle: chapterTitleFontStyle,
                color: design.headingColor,
                textAlign: design.chapterTitleAlign as React.CSSProperties['textAlign'],
                marginBottom: ptToPx(6),
                lineHeight: 1.2,
              }}
            >
              Chapter 1
            </div>
            <div
              style={{
                fontSize: ptToPx(design.sectionTitleSize) * 0.85,
                fontWeight: 600,
                color: design.headingColor,
                textAlign: design.chapterTitleAlign as React.CSSProperties['textAlign'],
                marginBottom: ptToPx(8),
              }}
            >
              The Beginning
            </div>
            {design.showChapterDivider && (
              <div
                style={{
                  borderTop: `1px solid ${design.accentColor}`,
                  marginBottom: ptToPx(8),
                }}
              />
            )}
          </>
        )}

        {isRecto &&
          (design.imageLayout === 'float_right' ||
            design.imageLayout === 'inline_right' ||
            design.imageLayout === 'float_left' ||
            design.imageLayout === 'inline_left' ||
            design.imageLayout === 'half_page') && (
            <div
              style={{
                float:
                  design.imageLayout === 'float_right' || design.imageLayout === 'inline_right'
                    ? 'right'
                    : 'left',
                width:
                  design.imageLayout === 'half_page'
                    ? '50%'
                    : `${design.imageWidthPercent}%`,
                height: ptToPx(60),
                backgroundColor: design.accentColor + '33',
                border: `1px solid ${design.accentColor}55`,
                borderRadius: 2,
                marginLeft:
                  design.imageLayout === 'float_right' || design.imageLayout === 'inline_right'
                    ? ptToPx(4)
                    : 0,
                marginRight:
                  design.imageLayout === 'float_left' || design.imageLayout === 'inline_left'
                    ? ptToPx(4)
                    : 0,
                marginBottom: ptToPx(4),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: ptToPx(7), color: design.accentColor, opacity: 0.8 }}>
                img
              </span>
            </div>
          )}
        {isRecto && design.imageLayout === 'full_page' && (
          <div
            style={{
              width: '100%',
              height: ptToPx(55),
              backgroundColor: design.accentColor + '33',
              border: `1px solid ${design.accentColor}55`,
              borderRadius: 2,
              marginBottom: ptToPx(4),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ fontSize: ptToPx(7), color: design.accentColor, opacity: 0.8 }}>
              img
            </span>
          </div>
        )}

        <div style={bodyStyle}>
          <p style={paragraphStyle}>
            Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor
            incididunt ut labore et dolore magna aliqua.
          </p>
          <p style={paragraphStyle}>
            Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi.
          </p>
          {isVerso && (
            <p style={paragraphStyle}>
              Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore.
            </p>
          )}
        </div>
      </div>

      {design.showPageNumbers && (
        <div
          style={{
            position: 'absolute',
            bottom: ptToPx(design.marginBottom) * 0.4,
            left:
              pageNumLeftSide === 'left'
                ? ptToPx(design.marginLeft)
                : pageNumLeftSide === 'center'
                  ? '50%'
                  : 'auto',
            right:
              pageNumLeftSide === 'right' ? ptToPx(design.marginRight) : 'auto',
            transform: pageNumLeftSide === 'center' ? 'translateX(-50%)' : undefined,
            fontSize: ptToPx(8),
            color: design.textColor,
            opacity: 0.6,
          }}
        >
          {pageNumber}
        </div>
      )}
    </div>
  )
}
