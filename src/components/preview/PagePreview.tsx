'use client'

/**
 * Reusable book-page preview. Renders one or two pages at the project's
 * configured pageSize (A4/A5/B5/…) with the BookDesign typography,
 * margins, and page-number placement applied. Used by:
 *
 *  - the Design page sidebar — with no contentHtml so we get the
 *    legacy lorem-ipsum spread (Chapter 1 / The Beginning + body)
 *  - the writing editor's Page-view preview — with contentHtml from
 *    `/api/projects/[id]/subsections/[subId]/preview` so the user sees
 *    their actual prose in book layout.
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
  /** 'single' = one recto page, 'spread' = verso + recto side by side */
  mode?: PagePreviewMode
  /**
   * Pre-rendered HTML for the body text. When omitted we fall back to
   * the legacy sample (Chapter 1 / lorem-ipsum) so the design page
   * still gets a meaningful preview without real content.
   */
  contentHtml?: string
  /** Width of a single page in CSS pixels. 110 fits the design sidebar; 380+ for the writing editor. */
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

  return (
    <div className={`flex flex-col items-center gap-2 ${className ?? ''}`}>
      <div
        className="flex shadow-md rounded-sm overflow-hidden"
        style={{ background: '#d4c9b5' }}
      >
        {mode === 'spread' ? (
          <>
            <PageInner
              design={design}
              side="verso"
              contentHtml={contentHtml}
              pageW={pageW}
              previewH={previewH}
              ptToPx={ptToPx}
            />
            <div style={{ width: 1, background: '#a89e8b' }} aria-hidden />
            <PageInner
              design={design}
              side="recto"
              contentHtml={contentHtml}
              pageW={pageW}
              previewH={previewH}
              ptToPx={ptToPx}
            />
          </>
        ) : (
          <PageInner
            design={design}
            side="recto"
            contentHtml={contentHtml}
            pageW={pageW}
            previewH={previewH}
            ptToPx={ptToPx}
          />
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

interface PageInnerProps {
  design: BookDesign
  side: 'verso' | 'recto'
  contentHtml?: string
  pageW: number
  previewH: number
  ptToPx: (pt: number) => number
}

function PageInner({ design, side, contentHtml, pageW, previewH, ptToPx }: PageInnerProps) {
  const isVerso = side === 'verso'
  const isRecto = side === 'recto'
  const pageNumber = isVerso ? 2 : 3
  const hasRealContent = !!contentHtml

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
          overflow: hasRealContent ? 'auto' : 'hidden',
        }}
      >
        {hasRealContent ? (
          isRecto ? (
            <PageBody
              html={contentHtml}
              bodyStyle={bodyStyle}
              paragraphIndent={paragraphIndent}
              paragraphSpacing={paragraphSpacing}
            />
          ) : (
            <FacingPagePlaceholder pageW={pageW} ptToPx={ptToPx} />
          )
        ) : (
          <SampleContent
            design={design}
            isRecto={isRecto}
            isVerso={isVerso}
            ptToPx={ptToPx}
            chapterTitleWeight={chapterTitleWeight}
            chapterTitleFontStyle={chapterTitleFontStyle}
            bodyStyle={bodyStyle}
            paragraphIndent={paragraphIndent}
            paragraphSpacing={paragraphSpacing}
          />
        )}
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

interface PageBodyProps {
  html: string
  bodyStyle: React.CSSProperties
  paragraphIndent: number
  paragraphSpacing: number
}

function PageBody({ html, bodyStyle, paragraphIndent, paragraphSpacing }: PageBodyProps) {
  // Scope paragraph-level indent + spacing via a unique class so we can
  // style the markdown HTML without forcing the editor's prose classes.
  const styleId = React.useId().replace(/[^\w]/g, '')
  const className = `pp-body-${styleId}`
  return (
    <>
      <style>
        {`.${className} p { margin-bottom: ${paragraphSpacing}px; ${
          paragraphIndent ? `text-indent: ${paragraphIndent}px;` : ''
        } }`}
        {`.${className} h2, .${className} h3 { font-weight: 600; margin-top: 0.5em; margin-bottom: 0.3em; line-height: 1.2; }`}
        {`.${className} h2 { font-size: 1.2em; }`}
        {`.${className} h3 { font-size: 1.05em; }`}
        {`.${className} em { font-style: italic; }`}
        {`.${className} strong { font-weight: 600; }`}
      </style>
      <div className={className} style={bodyStyle} dangerouslySetInnerHTML={{ __html: html }} />
    </>
  )
}

function FacingPagePlaceholder({ pageW, ptToPx }: { pageW: number; ptToPx: (pt: number) => number }) {
  // Subtle hint that the spread shows just one page of real content.
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.max(8, ptToPx(7)),
        color: 'rgba(0,0,0,0.3)',
        fontStyle: 'italic',
        textAlign: 'center',
        padding: pageW * 0.05,
      }}
    >
      ← previous page
    </div>
  )
}

interface SampleContentProps {
  design: BookDesign
  isRecto: boolean
  isVerso: boolean
  ptToPx: (pt: number) => number
  chapterTitleWeight: 'bold' | 'normal'
  chapterTitleFontStyle: 'italic' | 'normal'
  bodyStyle: React.CSSProperties
  paragraphIndent: number
  paragraphSpacing: number
}

function SampleContent({
  design,
  isRecto,
  isVerso,
  ptToPx,
  chapterTitleWeight,
  chapterTitleFontStyle,
  bodyStyle,
  paragraphIndent,
  paragraphSpacing,
}: SampleContentProps) {
  const paragraphStyle: React.CSSProperties = {
    marginBottom: paragraphSpacing,
    textIndent: paragraphIndent || undefined,
  }

  return (
    <>
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
    </>
  )
}
