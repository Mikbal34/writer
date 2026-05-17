"use client";

/**
 * Reader panel for the split book-ask view. Wraps PdfViewerWithHighlights
 * in a parchment-toned card with a decorative title strip at the top.
 *
 * Navigation (page jump, prev/next) and highlight selection live inside
 * PdfViewerWithHighlights — the strip here is intentionally minimal so
 * the two surfaces don't compete.
 */

import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { ChevronLeft, Loader2 } from "lucide-react";

// pdfjs-dist runs Object.defineProperty against browser globals on import,
// so the viewer must skip SSR. Mirrors EntryDetailPanel's dynamic import.
const PdfViewerWithHighlights = dynamic(
  () => import("./PdfViewerWithHighlights"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-12 text-ink-light font-ui text-sm gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        PDF yükleniyor…
      </div>
    ),
  },
);

interface PdfReaderPanelProps {
  entryId: string;
  /** Book / chapter title rendered as the italic-serif eyebrow. */
  title: string;
  volumeId?: string | null;
  targetPage?: number | null;
  onHighlightsChanged?: () => void;
  /** Other pages cited in the current chat session from this entry —
   *  surfaced as jump-pills in the footer so the reader can hop
   *  between cited passages without scrolling. */
  cohortPages?: number[];
  /** Called when the user picks a cohort page or wants to track the
   *  viewer's own page navigation. Chat surface uses this to keep its
   *  activeSource.page in sync. */
  onJumpToPage?: (page: number) => void;
  /** When opening from a chat citation, the first ~280 chars of the
   *  quoted passage. Renders as a banner above the PDF body so the
   *  reader sees what the AI specifically grabbed. */
  chatQuote?: string | null;
}

export default function PdfReaderPanel({
  entryId,
  title,
  volumeId,
  targetPage,
  onHighlightsChanged,
  cohortPages,
  onJumpToPage,
  chatQuote,
}: PdfReaderPanelProps) {
  const router = useRouter();
  const cohort = (cohortPages ?? []).filter((p) => p !== targetPage);
  return (
    <div className="flex flex-col h-full rounded-2xl bg-elevated overflow-hidden">
      {/* Title strip — mock-spec: padding 12/18, paperSoft bg, sandy
          divider line below, italic serif title. Highlight + note
          affordances live inside PdfViewerWithHighlights, so the strip
          stays focused on identifying the source. */}
      <div className="flex items-center gap-2.5 px-[18px] py-3 border-b border-sandy bg-panel">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center justify-center h-7 w-7 -ml-1 rounded-sm text-ink-muted hover:bg-elevated hover:text-ink transition-colors"
          aria-label="Geri"
          title="Geri dön"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <div className="font-display italic text-sm text-ink-light truncate flex-1">
          {title}
        </div>
      </div>

      {/* Chat-quote banner — when opened from a citation chip, the AI's
          actual quoted passage shows above the PDF so the reader knows
          which paragraph to look for. Auto-dismisses on page change. */}
      {chatQuote && (
        <div
          className="px-[18px] py-2.5 border-b border-sandy bg-panel/80 flex gap-2.5"
          style={{ borderLeft: "3px solid var(--color-gold)" }}
        >
          <div className="font-ui text-[10px] uppercase tracking-[0.14em] text-gold-dark mt-0.5 shrink-0">
            AI alıntısı
          </div>
          <p className="font-display italic text-[12.5px] leading-relaxed text-ink line-clamp-3">
            “{chatQuote}”
          </p>
        </div>
      )}

      {/* Reader body — sandy paper field, mock spec rgb(216,203,171). */}
      <div className="flex-1 overflow-auto p-6" style={{ backgroundColor: "#d8cbab" }}>
        <PdfViewerWithHighlights
          entryId={entryId}
          volumeId={volumeId ?? null}
          targetPage={targetPage ?? null}
          chatQuote={chatQuote ?? null}
          onHighlightsChanged={onHighlightsChanged}
        />
      </div>

      {/* Footer — "Sohbette atıf yapılan diğer sayfalar". Only renders
          when the surrounding chat surface passes a cohort + jump
          handler; standalone consumers (legacy book-ask page) stay
          unchanged. */}
      {onJumpToPage && cohort.length > 0 && (
        <div className="px-[18px] py-2 border-t border-sandy bg-panel flex items-center gap-2 flex-wrap font-ui text-[11px] text-ink-muted">
          <span className="uppercase tracking-[0.12em] text-[10px]">
            Sohbette atıf yapılan diğer sayfalar
          </span>
          <div className="flex items-center gap-1 flex-wrap">
            {targetPage != null && (
              <span
                className="inline-flex items-center justify-center px-2 py-0.5 rounded-sm bg-gold text-white font-semibold text-[10.5px] tabular-nums"
                title="Şu anki sayfa"
              >
                {targetPage}
              </span>
            )}
            {cohort.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onJumpToPage(p)}
                className="inline-flex items-center justify-center px-2 py-0.5 rounded-sm border border-sandy bg-elevated hover:bg-panel hover:text-ink transition-colors text-[10.5px] tabular-nums"
                title={`Sayfa ${p}'a git`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
