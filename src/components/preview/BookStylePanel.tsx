"use client";

import { useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { BOOK_STYLES, detectBundleId } from "@/lib/book-styles";
import type { BookStyleBundle, BookDesign } from "@/lib/book-styles";
import type { CreativeStructuralSpec } from "@/lib/creative-specs";

interface BookStylePanelProps {
  projectId: string;
  currentArtStyle: string | null;
  currentDesign: Partial<BookDesign> | null;
  onApplied?: (bundle: BookStyleBundle) => void;
  /**
   * Compact variant renders a single-column list with smaller previews.
   * Useful when embedding in a narrow sidebar.
   */
  variant?: "default" | "compact";
}

// ---------------------------------------------------------------------------
// Page aspect ratios (mm) — mirrors LivePreview in design/page.tsx so a
// mini-mockup matches the trim size the user will actually print.
// ---------------------------------------------------------------------------
const PAGE_ASPECTS: Record<string, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
  "16x24cm": { w: 160, h: 240 },
  "17x24cm": { w: 170, h: 240 },
  "5x8": { w: 127, h: 203 },
  "5.5x8.5": { w: 140, h: 216 },
  "6x9": { w: 152, h: 229 },
  letter: { w: 216, h: 279 },
};

// ---------------------------------------------------------------------------
// Font-family resolution — our design.bodyFont values are friendly labels,
// not CSS stacks. Map them onto web-safe families.
// ---------------------------------------------------------------------------
function resolveFontFamily(label: string): string {
  if (label.toLowerCase().includes("sans")) {
    return "'Inter', 'Helvetica Neue', Arial, sans-serif";
  }
  return "'Crimson Pro', 'Georgia', 'Times New Roman', serif";
}

function resolveFontWeight(label: string): number {
  return /\bbold\b/i.test(label) ? 700 : 400;
}

function resolveFontStyle(label: string): "italic" | "normal" {
  return /italic/i.test(label) ? "italic" : "normal";
}

// Unicode glyphs for ornaments / scene breaks
function ornamentGlyph(kind: string, override: string | null | undefined): string {
  if (override) return override;
  switch (kind) {
    case "fleuron":
      return "❦";
    case "asterism":
      return "⁂";
    case "three-asterisks":
      return "* * *";
    case "dinkus":
      return "◆";
    case "thought-break":
      return "#";
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Mini page preview — renders a scaled mockup of one body page using
// the bundle's actual typography + structural choices.
// ---------------------------------------------------------------------------
function MiniPagePreview({
  design,
  structural,
  width,
}: {
  design: BookDesign;
  structural: CreativeStructuralSpec;
  width: number;
}) {
  const aspect = PAGE_ASPECTS[design.pageSize] ?? PAGE_ASPECTS.A4;
  const pageW = width;
  const pageH = (aspect.h / aspect.w) * pageW;

  // Scale pt margins into px relative to the mockup. Real page width in pt
  // is not known precisely without font metrics, so approximate: A4 width
  // (210mm) ≈ 595pt. Use pageW as the scale reference.
  const ptToPx = (pt: number) => (pt / 595) * pageW * 1.2;

  const bodyFamily = resolveFontFamily(design.bodyFont);
  const headingFamily = resolveFontFamily(design.headingFont);
  const bodyWeight = resolveFontWeight(design.bodyFont);
  const bodyStyle = resolveFontStyle(design.bodyFont);
  const headingWeight = resolveFontWeight(design.headingFont);

  // Heading font size scaled down aggressively for the mini view
  const headingPx = Math.max(9, Math.min(width / 9, design.chapterTitleSize * 0.4));
  const bodyPx = Math.max(4.5, design.bodyFontSize * 0.38);

  const showOrnamentAbove = structural.chapter.ornamentAbove !== "none";
  const showOrnamentBelow = structural.chapter.ornamentBelow !== "none";
  const isHorizontalRuleAbove = structural.chapter.ornamentAbove === "horizontal-rule";
  const isHorizontalRuleBelow = structural.chapter.ornamentBelow === "horizontal-rule";

  // Chapter number rendering
  const numberGlyph = (() => {
    switch (structural.chapter.numberStyle) {
      case "arabic":
        return "1";
      case "roman-upper":
        return "I";
      case "word-upper":
        return "ONE";
      case "word-title":
        return "One";
      case "chapter-arabic":
        return "Chapter 1";
      case "chapter-roman":
        return "Chapter I";
      case "none":
      default:
        return "";
    }
  })();
  const numberSizeScale = {
    small: 0.8,
    medium: 1.0,
    large: 1.35,
    huge: 1.9,
  }[structural.chapter.numberSize];

  // Sample chapter title — picks something generic that looks like prose.
  const chapterTitle = "Chapter Title";
  const titleDisplay =
    structural.chapter.titleCase === "uppercase"
      ? chapterTitle.toUpperCase()
      : chapterTitle;

  const align = structural.chapter.align;
  const sinkage = {
    none: 0,
    small: pageH * 0.04,
    medium: pageH * 0.1,
    large: pageH * 0.22,
  }[structural.chapter.sinkage];

  // Drop cap
  const dropCap = structural.dropCap.enabled;
  const dropCapSize = dropCap ? bodyPx * (structural.dropCap.lines || 3) * 0.85 : 0;

  const firstLine =
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.";
  const laterLines = [
    "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
    "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.",
    "Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
  ];

  // Chapter title typography
  const titleStyle = structural.chapter.titleCase;
  const titleTextTransform = titleStyle === "small-caps" ? "none" : undefined;
  const titleFontVariant = titleStyle === "small-caps" ? "small-caps" : undefined;

  // Ornament character for scene break decoration position (if above/below)
  const ornamentAboveGlyph = ornamentGlyph(structural.chapter.ornamentAbove, null);
  const ornamentBelowGlyph = ornamentGlyph(structural.chapter.ornamentBelow, null);

  const accentColor = design.accentColor;
  const headingColor = design.headingColor;
  const textColor = design.textColor;

  return (
    <div
      className="relative shadow-sm border border-black/10"
      style={{
        width: pageW,
        height: pageH,
        background: "#fffdfa",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          paddingTop: ptToPx(design.marginTop) + sinkage,
          paddingBottom: ptToPx(design.marginBottom),
          paddingLeft: ptToPx(design.marginLeft),
          paddingRight: ptToPx(design.marginRight),
          color: textColor,
          fontFamily: bodyFamily,
          fontSize: bodyPx,
          lineHeight: design.lineHeight,
          display: "flex",
          flexDirection: "column",
          gap: bodyPx * 0.35,
        }}
      >
        {/* Chapter opener block */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: align === "center" ? "center" : "flex-start",
            width: "100%",
            marginBottom: bodyPx * 0.8,
          }}
        >
          {showOrnamentAbove && (
            isHorizontalRuleAbove ? (
              <div
                style={{
                  width: "40%",
                  borderTop: `0.5px solid ${accentColor}`,
                  marginBottom: bodyPx * 0.6,
                }}
              />
            ) : (
              <div
                style={{
                  color: accentColor,
                  fontSize: headingPx * 0.6,
                  marginBottom: bodyPx * 0.3,
                }}
              >
                {ornamentAboveGlyph}
              </div>
            )
          )}

          {numberGlyph && (
            <div
              style={{
                color: headingColor,
                fontFamily: headingFamily,
                fontWeight: headingWeight,
                fontSize: headingPx * numberSizeScale,
                lineHeight: 1.1,
                marginBottom: bodyPx * 0.4,
              }}
            >
              {numberGlyph}
            </div>
          )}

          <div
            style={{
              color: headingColor,
              fontFamily: headingFamily,
              fontWeight: headingWeight,
              fontSize: headingPx,
              lineHeight: 1.15,
              textTransform: titleTextTransform,
              fontVariant: titleFontVariant,
              letterSpacing: titleStyle === "small-caps" ? "0.08em" : undefined,
              fontStyle: design.chapterTitleStyle.includes("italic") ? "italic" : undefined,
            }}
          >
            {titleDisplay}
          </div>

          {showOrnamentBelow && (
            isHorizontalRuleBelow ? (
              <div
                style={{
                  width: "40%",
                  borderTop: `0.5px solid ${accentColor}`,
                  marginTop: bodyPx * 0.6,
                }}
              />
            ) : (
              <div
                style={{
                  color: accentColor,
                  fontSize: headingPx * 0.5,
                  marginTop: bodyPx * 0.3,
                }}
              >
                {ornamentBelowGlyph}
              </div>
            )
          )}
        </div>

        {/* Body — first paragraph with drop cap if enabled */}
        <div
          style={{
            textAlign: design.textAlign as
              | "left"
              | "right"
              | "center"
              | "justify",
            fontStyle: bodyStyle,
            fontWeight: bodyWeight,
            display: "block",
          }}
        >
          {dropCap && (
            <span
              style={{
                float: "left",
                fontFamily: headingFamily,
                fontSize: dropCapSize,
                lineHeight: 0.85,
                marginRight: bodyPx * 0.4,
                marginTop: bodyPx * 0.1,
                color: headingColor,
                fontWeight: 700,
              }}
            >
              {firstLine[0]}
            </span>
          )}
          <span>{dropCap ? firstLine.slice(1) : firstLine}</span>
        </div>

        {laterLines.slice(0, 2).map((line, i) => (
          <div
            key={i}
            style={{
              textAlign: design.textAlign as
                | "left"
                | "right"
                | "center"
                | "justify",
              fontStyle: bodyStyle,
              fontWeight: bodyWeight,
              textIndent: ptToPx(design.firstLineIndent),
            }}
          >
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card + Panel
// ---------------------------------------------------------------------------
function BundleCard({
  bundle,
  selected,
  applying,
  onClick,
  compact,
}: {
  bundle: BookStyleBundle;
  selected: boolean;
  applying: boolean;
  onClick: () => void;
  compact: boolean;
}) {
  const previewWidth = compact ? 110 : 170;

  return (
    <button
      onClick={onClick}
      disabled={applying}
      className={`relative text-left rounded-md border overflow-hidden transition-colors disabled:opacity-50 flex ${
        compact ? "flex-row items-stretch" : "flex-col"
      } ${
        selected
          ? "border-forest/50 bg-forest/5 shadow-sm ring-1 ring-forest/20"
          : "border-[#d4c9b5] bg-white hover:border-[#c9bfad]"
      }`}
    >
      {/* Mini page preview */}
      <div
        className={`${
          compact
            ? "p-2 bg-[#faf7f0] flex items-center justify-center shrink-0"
            : "p-3 bg-[#faf7f0] flex items-center justify-center border-b border-[#e5ddc8]"
        }`}
      >
        <MiniPagePreview
          design={bundle.design}
          structural={bundle.structural}
          width={previewWidth}
        />
      </div>

      {/* Label + desc + traits */}
      <div className="flex-1 min-w-0 p-3">
        <div className="flex items-start justify-between gap-2 mb-1">
          <span className="font-ui text-xs font-semibold text-ink leading-tight">
            {bundle.label}
          </span>
          {applying ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-forest shrink-0" />
          ) : selected ? (
            <Check className="h-3.5 w-3.5 text-forest shrink-0" />
          ) : null}
        </div>

        <p className="font-body text-[10px] text-muted-foreground leading-snug line-clamp-2 mb-2">
          {bundle.desc}
        </p>

        <div className="flex flex-wrap gap-1">
          {bundle.traits.slice(0, compact ? 2 : 4).map((trait) => (
            <span
              key={trait}
              className="inline-flex items-center px-1.5 py-0.5 rounded-sm bg-[#e8dfd0]/60 text-[9px] font-ui text-ink-light leading-none"
            >
              {trait}
            </span>
          ))}
        </div>
      </div>
    </button>
  );
}

export default function BookStylePanel({
  projectId,
  currentArtStyle,
  currentDesign,
  onApplied,
  variant = "default",
}: BookStylePanelProps) {
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const selectedId = detectBundleId(currentArtStyle, currentDesign);
  const compact = variant === "compact";

  async function handleApply(bundle: BookStyleBundle) {
    if (applyingId) return;
    setApplyingId(bundle.id);

    try {
      // Merge artStyle into existing writingGuidelines rather than replacing
      // the whole object — other keys (e.g. AI research notes) must survive.
      const projRes = await fetch(`/api/projects/${projectId}`);
      const project = projRes.ok ? await projRes.json() : {};
      const existingGuidelines =
        (project.writingGuidelines as Record<string, unknown> | null) ?? {};

      const patchRes = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          writingGuidelines: {
            ...existingGuidelines,
            artStyle: bundle.artStyle,
            bookStyleId: bundle.id,
            creativeSpec: bundle.structural,
          },
          bookDesign: bundle.design,
        }),
      });

      if (!patchRes.ok) {
        const err = await patchRes.json().catch(() => ({}));
        throw new Error(err.error ?? "Stil uygulanamadı");
      }

      toast.success(`"${bundle.label}" stili uygulandı`);
      onApplied?.(bundle);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Bir hata oluştu";
      toast.error(msg);
    } finally {
      setApplyingId(null);
    }
  }

  const gridCols = compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2";

  return (
    <div className={compact ? "p-2 space-y-2" : "p-4 space-y-3"}>
      <div className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-forest" />
        <p className="font-ui text-xs text-muted-foreground">
          Kitap stilini seç — sanat stili, tipografi, sayfa düzeni ve yapısal
          detaylar (chapter opener, drop cap, scene break) birlikte uygulanır.
        </p>
      </div>

      <div className={`grid gap-3 ${gridCols}`}>
        {BOOK_STYLES.map((bundle) => (
          <BundleCard
            key={bundle.id}
            bundle={bundle}
            selected={selectedId === bundle.id}
            applying={applyingId === bundle.id}
            onClick={() => handleApply(bundle)}
            compact={compact}
          />
        ))}
      </div>

      {selectedId === null && (currentArtStyle || currentDesign) && (
        <p className="font-body text-[10px] text-muted-foreground italic pt-1">
          Şu an özel ayarların var — hazır stile dönmek için bir kart seç.
        </p>
      )}
    </div>
  );
}
