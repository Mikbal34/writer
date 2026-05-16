"use client";

/**
 * Read-only list of an entry's highlights, grouped by page.
 *
 * Each highlight shows: a coloured swatch, the quoted text (line-
 * clamped to 3 lines), and a small "→ PDF" affordance that asks the
 * parent (EntryDetailPanel) to flip to the PDF tab on the right page.
 *
 * Used inside the right-pane detail panel; the heavy lifting (selection
 * UI, overlay rendering) lives in PdfViewerWithHighlights.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";

interface RangeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface HighlightRow {
  id: string;
  pageNumber: number;
  text: string;
  rangeRects: RangeRect[];
  color: string;
  noteId: string | null;
  createdAt: string;
}

interface HighlightsTabProps {
  entryId: string;
  /** Refresh trigger from parent (PDF tab signals a new highlight) */
  refreshKey?: number;
  /** Click-through to the PDF tab at a given page */
  onJumpToPage?: (page: number) => void;
}

export default function HighlightsTab({
  entryId,
  refreshKey,
  onJumpToPage,
}: HighlightsTabProps) {
  const [highlights, setHighlights] = useState<HighlightRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/library/entries/${entryId}/highlights`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { highlights: HighlightRow[] };
      setHighlights(data.highlights);
    } catch {
      toast.error("Highlight'lar yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, [entryId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const grouped = useMemo(() => {
    const groups = new Map<number, HighlightRow[]>();
    for (const h of highlights) {
      const arr = groups.get(h.pageNumber) ?? [];
      arr.push(h);
      groups.set(h.pageNumber, arr);
    }
    return [...groups.entries()].sort(([a], [b]) => a - b);
  }, [highlights]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-6 font-body text-xs text-ink-light">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Highlight'lar yükleniyor...
      </div>
    );
  }

  if (highlights.length === 0) {
    return (
      <div className="px-4 py-8 text-center font-body text-sm text-ink-light">
        Henüz highlight yok. PDF tabından metin seçip "Highlight" diyebilirsin.
      </div>
    );
  }

  return (
    <div className="px-4 py-4 space-y-4">
      {grouped.map(([pageNumber, items]) => (
        <section key={pageNumber}>
          <header className="flex items-center justify-between mb-1.5">
            <h3 className="font-ui text-[10px] uppercase tracking-widest text-ink-light">
              Sayfa {pageNumber} · {items.length} highlight
            </h3>
            {onJumpToPage && (
              <button
                type="button"
                onClick={() => onJumpToPage(pageNumber)}
                className="inline-flex items-center gap-1 font-ui text-[10px] text-ink-light hover:text-ink"
              >
                <ExternalLink className="h-3 w-3" />
                PDF'e git
              </button>
            )}
          </header>
          <ul className="space-y-1.5">
            {items.map((h) => (
              <li
                key={h.id}
                className="rounded-sm border border-sandy/60 bg-white/70 px-2 py-1.5 flex gap-2 items-start cursor-pointer hover:bg-white transition-colors"
                onClick={() => onJumpToPage?.(h.pageNumber)}
              >
                <div
                  className="w-2 h-3 rounded-sm shrink-0 mt-0.5"
                  style={{ backgroundColor: h.color, opacity: 0.7 }}
                />
                <p
                  dir="auto"
                  className="font-body text-xs text-ink flex-1 line-clamp-3"
                >
                  {h.text}
                </p>
                {h.noteId && (
                  <span className="font-ui text-[10px] text-gold-dark shrink-0">📝</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
