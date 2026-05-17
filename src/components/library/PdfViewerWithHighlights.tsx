"use client";

/**
 * PDF viewer with text-selection highlighting.
 *
 * Wraps react-pdf's <Page> with `renderTextLayer={true}` so the user
 * can select text. On mouseup we read window.getSelection(), measure
 * each Range's bounding rects relative to the page container, and
 * normalise to 0-1 page-relative units — that keeps overlays
 * zoom-independent.
 *
 * Saved highlights are rendered as absolutely-positioned yellow
 * rectangles inside the page container. The text-layer behind them
 * remains selectable so the user can re-quote.
 *
 * A small "Highlight" / "Highlight + Not" floating popup appears next
 * to the selection while text is selected.
 *
 * Page navigation is built-in: prev / next / jump. The viewer is
 * intentionally one-page-at-a-time — the citation flow shows a
 * specific page anyway, and pagination keeps memory predictable for
 * the 800+ page books in the corpus.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import {
  Loader2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Highlighter,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

if (typeof window !== "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
}

interface RangeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Highlight {
  id: string;
  pageNumber: number;
  text: string;
  rangeRects: RangeRect[];
  color: string;
  noteId: string | null;
}

interface PdfViewerWithHighlightsProps {
  entryId: string;
  volumeId?: string | null;
  /** External "go to page N" trigger (e.g. clicking a highlight in
   *  HighlightsTab). The viewer responds to the prop changing. */
  targetPage?: number | null;
  onHighlightsChanged?: () => void;
}

interface SelectionPopup {
  pageRects: RangeRect[];
  text: string;
  /** Anchor position for the floating action UI (absolute, in container px) */
  anchorX: number;
  anchorY: number;
}

export default function PdfViewerWithHighlights({
  entryId,
  volumeId,
  targetPage,
  onHighlightsChanged,
}: PdfViewerWithHighlightsProps) {
  const fileUrl = volumeId
    ? `/api/library/${entryId}/pdf?volume=${encodeURIComponent(volumeId)}`
    : `/api/library/${entryId}/pdf`;

  const [error, setError] = useState<string | null>(null);
  const [errorContext, setErrorContext] = useState<{
    status: string;
    hasFile: boolean;
    error: string | null;
  } | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [width, setWidth] = useState(640);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [selection, setSelection] = useState<SelectionPopup | null>(null);
  const [creating, setCreating] = useState(false);

  // When the PDF document fails to load (404, network, parse error), ask
  // the status sidecar why so we can show the user a meaningful message
  // ("PDF yüklenmemiş" vs "işleniyor" vs "başarısız") instead of a
  // generic "load failed".
  useEffect(() => {
    if (!error) {
      setErrorContext(null);
      return;
    }
    let cancelled = false;
    const statusUrl = volumeId
      ? `/api/library/${entryId}/pdf-status?volume=${encodeURIComponent(volumeId)}`
      : `/api/library/${entryId}/pdf-status`;
    fetch(statusUrl)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setErrorContext({
          status: typeof data.status === "string" ? data.status : "unknown",
          hasFile: Boolean(data.hasFile),
          error: typeof data.error === "string" ? data.error : null,
        });
      })
      .catch(() => {
        /* viewer keeps the generic error fallback */
      });
    return () => {
      cancelled = true;
    };
  }, [error, entryId, volumeId]);

  const containerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  // Honour external page jumps once per change.
  useEffect(() => {
    if (typeof targetPage === "number" && targetPage > 0) {
      setPage(targetPage);
    }
  }, [targetPage]);

  // Track container width for the responsive react-pdf Page.
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.max(320, Math.min(900, e.contentRect.width));
        setWidth(w);
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Load highlights for the current entry (all pages — small payload;
  // simpler than paginating, given users rarely have hundreds).
  const loadHighlights = useCallback(async () => {
    try {
      const res = await fetch(`/api/library/entries/${entryId}/highlights`);
      if (!res.ok) return;
      const data = (await res.json()) as { highlights: Highlight[] };
      setHighlights(data.highlights);
    } catch {
      /* non-fatal */
    }
  }, [entryId]);

  useEffect(() => {
    loadHighlights();
  }, [loadHighlights]);

  // Compute selection rects relative to the rendered page DOM. We grab
  // the page container's bounding box and divide; the SelectionPopup is
  // then anchored to the end of the selection so it doesn't cover what
  // the user just chose.
  function handleMouseUp() {
    if (!pageRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setSelection(null);
      return;
    }
    const text = sel.toString().trim();
    if (text.length < 3) {
      setSelection(null);
      return;
    }
    const pageRect = pageRef.current.getBoundingClientRect();
    if (pageRect.width === 0 || pageRect.height === 0) return;

    // Some browsers report duplicate rects for a single selection on
    // the same line; dedupe by stringifying.
    const seen = new Set<string>();
    const rects: RangeRect[] = [];
    let lastRectEnd: { x: number; y: number } | null = null;
    for (let i = 0; i < sel.rangeCount; i++) {
      const range = sel.getRangeAt(i);
      for (const r of Array.from(range.getClientRects())) {
        if (r.width === 0 || r.height === 0) continue;
        const x = (r.left - pageRect.left) / pageRect.width;
        const y = (r.top - pageRect.top) / pageRect.height;
        const w = r.width / pageRect.width;
        const h = r.height / pageRect.height;
        if (x < 0 || y < 0 || x + w > 1.001 || y + h > 1.001) continue;
        const key = `${x.toFixed(4)}-${y.toFixed(4)}-${w.toFixed(4)}-${h.toFixed(4)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rects.push({ x, y, w, h });
        lastRectEnd = {
          x: (r.right - pageRect.left),
          y: (r.bottom - pageRect.top),
        };
      }
    }
    if (rects.length === 0) {
      setSelection(null);
      return;
    }
    setSelection({
      pageRects: rects,
      text,
      anchorX: lastRectEnd?.x ?? rects[0].x * pageRect.width,
      anchorY: lastRectEnd?.y ?? rects[0].y * pageRect.height,
    });
  }

  async function saveHighlight(opts: { withNote: boolean }) {
    if (!selection) return;
    setCreating(true);
    try {
      const res = await fetch(
        `/api/library/entries/${entryId}/highlights`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pageNumber: page,
            text: selection.text,
            rangeRects: selection.pageRects,
            volumeId: volumeId ?? null,
            createNote: opts.withNote,
          }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Kaydedilemedi");
      }
      toast.success(opts.withNote ? "Highlight + not kaydedildi." : "Highlight kaydedildi.");
      window.getSelection()?.removeAllRanges();
      setSelection(null);
      await loadHighlights();
      onHighlightsChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kaydedilemedi");
    } finally {
      setCreating(false);
    }
  }

  async function deleteHighlight(id: string) {
    if (!window.confirm("Bu highlight silinsin mi?")) return;
    try {
      const res = await fetch(`/api/library/highlights/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      toast.success("Highlight silindi");
      await loadHighlights();
      onHighlightsChanged?.();
    } catch {
      toast.error("Silinemedi");
    }
  }

  const pageHighlights = highlights.filter((h) => h.pageNumber === page);

  return (
    <div ref={containerRef} className="w-full flex flex-col gap-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="flex items-center gap-1 px-2 py-1 rounded-sm font-ui text-xs text-ink-light hover:bg-page disabled:opacity-40"
          >
            <ChevronLeft className="h-3 w-3" />
          </button>
          <input
            type="number"
            min={1}
            max={numPages || undefined}
            value={page}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (Number.isFinite(n)) {
                setPage(Math.max(1, Math.min(numPages || n, n)));
              }
            }}
            className="w-14 text-center px-1 py-0.5 rounded-sm border border-sandy bg-white font-ui text-xs"
          />
          <span className="font-ui text-xs text-ink-light">
            / {numPages || "?"}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(numPages || p + 1, p + 1))}
            disabled={numPages > 0 && page >= numPages}
            className="flex items-center gap-1 px-2 py-1 rounded-sm font-ui text-xs text-ink-light hover:bg-page disabled:opacity-40"
          >
            <ChevronRight className="h-3 w-3" />
          </button>
        </div>
        <span className="font-ui text-[10px] text-ink-light">
          {pageHighlights.length} highlight
        </span>
      </div>

      {/* PDF page */}
      <div className="relative w-full bg-page/40 border border-sandy/50 rounded-sm flex justify-center overflow-hidden">
        {error ? (
          <PdfErrorState entryId={entryId} context={errorContext} />
        ) : (
          <Document
            file={fileUrl}
            onLoadSuccess={(d) => setNumPages(d.numPages)}
            onLoadError={(err) => setError(err?.message ?? "load failed")}
            loading={
              <div className="flex items-center gap-2 py-10 text-ink-light font-ui text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                PDF yükleniyor...
              </div>
            }
            error={
              <div className="flex items-center gap-2 py-10 text-destructive font-ui text-sm">
                <AlertTriangle className="h-4 w-4" />
                PDF yüklenemedi
              </div>
            }
          >
            <div
              ref={pageRef}
              className="relative inline-block"
              onMouseUp={handleMouseUp}
            >
              <Page
                pageNumber={page}
                width={width}
                renderAnnotationLayer={false}
                renderTextLayer
              />
              {/* Saved highlights overlay. Each rect is one absolutely-
                  positioned div sized in % so it auto-tracks page width. */}
              {pageHighlights.map((h) => {
                const rects = Array.isArray(h.rangeRects)
                  ? (h.rangeRects as RangeRect[])
                  : [];
                return rects.map((r, i) => (
                  <div
                    key={`${h.id}-${i}`}
                    title={h.text}
                    style={{
                      position: "absolute",
                      left: `${r.x * 100}%`,
                      top: `${r.y * 100}%`,
                      width: `${r.w * 100}%`,
                      height: `${r.h * 100}%`,
                      backgroundColor: h.color,
                      opacity: 0.35,
                      pointerEvents: "none",
                    }}
                  />
                ));
              })}
              {/* Selection popup */}
              {selection && (
                <div
                  className="absolute z-20 flex items-center gap-1 rounded-sm border border-sandy bg-white shadow-md px-1.5 py-1"
                  style={{
                    left: Math.min(
                      Math.max(0, selection.anchorX),
                      width - 200,
                    ),
                    top: Math.max(0, selection.anchorY + 6),
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => saveHighlight({ withNote: false })}
                    disabled={creating}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-gold/60 font-ui text-[10px] text-ink-light hover:bg-gold/80 disabled:opacity-50"
                  >
                    <Highlighter className="h-3 w-3" />
                    Highlight
                  </button>
                  <button
                    type="button"
                    onClick={() => saveHighlight({ withNote: true })}
                    disabled={creating}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-forest text-page font-ui text-[10px] hover:bg-forest/90 disabled:opacity-50"
                  >
                    <Pencil className="h-3 w-3" />
                    Highlight + Not
                  </button>
                </div>
              )}
            </div>
          </Document>
        )}
      </div>

      {/* Per-page highlight list — small handle to delete saved marks
          without rebuilding the floating popup. */}
      {pageHighlights.length > 0 && (
        <div className="space-y-1 px-1 pt-1">
          {pageHighlights.map((h) => (
            <div
              key={h.id}
              className="group flex items-start gap-2 px-2 py-1 rounded-sm hover:bg-page border border-transparent"
            >
              <div
                className="w-2 h-2 rounded-sm shrink-0 mt-1.5"
                style={{ backgroundColor: h.color, opacity: 0.7 }}
              />
              <span className="flex-1 font-body text-xs text-ink line-clamp-2">
                {h.text}
              </span>
              <button
                type="button"
                onClick={() => deleteHighlight(h.id)}
                className="opacity-0 group-hover:opacity-100 text-ink-muted hover:text-red-600 transition-opacity"
                aria-label="Highlight'ı sil"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PdfErrorState({
  entryId,
  context,
}: {
  entryId: string;
  context: {
    status: string;
    hasFile: boolean;
    error: string | null;
  } | null;
}) {
  // No context yet → show a soft loading hint while the status fetch
  // resolves so the panel doesn't flash a wrong message.
  if (!context) {
    return (
      <div className="flex items-center gap-2 py-10 text-ink-light font-ui text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        PDF durumu kontrol ediliyor…
      </div>
    );
  }

  const { status, hasFile, error } = context;
  const inProgress =
    status === "pending" ||
    status === "downloading" ||
    status === "extracting" ||
    status === "embedding";

  if (inProgress) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 px-6 text-center text-ink-light font-ui text-sm max-w-[420px]">
        <Loader2 className="h-5 w-5 animate-spin text-gold" />
        <div className="font-display italic text-[15px] text-ink">
          PDF işleniyor…
        </div>
        <div className="text-[12.5px]">
          Sunucu bu kaynağın PDF&apos;ini hazırlıyor ({status}). Birkaç dakika
          sonra tekrar dener misin?
        </div>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="flex flex-col items-center gap-2 py-10 px-6 text-center font-ui text-sm max-w-[440px]">
        <AlertTriangle className="h-5 w-5 text-destructive" />
        <div className="font-display italic text-[15px] text-ink">
          PDF işleme başarısız oldu
        </div>
        <div className="text-[12.5px] text-ink-light">
          {error ?? "Beklenmedik bir hata oluştu."}
        </div>
        <a
          href={`/library?entry=${entryId}`}
          className="mt-2 inline-flex items-center px-3 py-1.5 rounded-md bg-gold text-white font-semibold text-[12px] hover:bg-gold-hover transition-colors"
        >
          Yeniden yükle
        </a>
      </div>
    );
  }

  // status === "none" / "ready" but no file / unknown → most common case:
  // user added the bibliographic entry but never uploaded a PDF.
  return (
    <div className="flex flex-col items-center gap-2 py-10 px-6 text-center font-ui text-sm max-w-[440px]">
      <AlertTriangle className="h-5 w-5 text-ink-muted" />
      <div className="font-display italic text-[15px] text-ink">
        {hasFile
          ? "PDF okunamadı"
          : "Bu kaynak için PDF yüklenmemiş"}
      </div>
      <div className="text-[12.5px] text-ink-light">
        {hasFile
          ? "Dosya disk üzerinde ama açılamıyor. Yeniden yüklemeyi dene."
          : "Kaynak künyesi kütüphanende ama dosyası yok. Yüklediğinde sayfa numaralı atıflar burada gezinebilir hâle gelecek."}
      </div>
      <a
        href={`/library?entry=${entryId}`}
        className="mt-2 inline-flex items-center px-3 py-1.5 rounded-md bg-gold text-white font-semibold text-[12px] hover:bg-gold-hover transition-colors"
      >
        Kütüphanede aç & PDF yükle
      </a>
    </div>
  );
}
