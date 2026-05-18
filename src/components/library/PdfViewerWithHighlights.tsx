"use client";

/**
 * PDF viewer with text-selection highlighting.
 *
 * Drives pdfjs-dist directly (no react-pdf) so we own the render
 * lifecycle. The previous implementation went through react-pdf's
 * <Page>, which doesn't expose pdfjs's RenderTask.cancel() — a width
 * change during a parent animation would leave the old canvas paint
 * in flight while a new one started, stacking two canvases in the DOM.
 *
 * Here there is exactly one <canvas> element and one text-layer
 * container. Every page or width change cancels the in-flight render
 * task and text-layer build before kicking off the new one, so the
 * "same page rendered twice" symptom is impossible by construction.
 *
 * Features preserved verbatim from the prior react-pdf-based version:
 *   - text-selection → save highlight (window.getSelection + page-
 *     relative [0,1] rangeRects)
 *   - saved-highlights overlay (absolute %-positioned divs)
 *   - AI-quote gold overlay (chatQuote prop → anchor-phrase scan of
 *     text-layer spans, paint matching rects)
 *   - page navigation (prev/next/jump input, external targetPage)
 *   - error states + /pdf-status sidecar fetch (PdfErrorState)
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import * as pdfjs from "pdfjs-dist";
import type {
  PDFDocumentProxy,
  PDFDocumentLoadingTask,
  RenderTask,
} from "pdfjs-dist";
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
  /** When opened from a chat citation, the AI-quoted passage. The
   *  viewer searches the rendered text layer for an anchor phrase
   *  and paints a translucent gold overlay over the matching spans
   *  so the reader can see exactly which sentences were quoted. */
  chatQuote?: string | null;
  onHighlightsChanged?: () => void;
}

interface SelectionPopup {
  pageRects: RangeRect[];
  text: string;
  /** Anchor position for the floating action UI (absolute, in container px) */
  anchorX: number;
  anchorY: number;
}

type Status = "idle" | "loading-doc" | "loading-page" | "ready" | "error";

const isCancelled = (err: unknown): boolean =>
  !!err &&
  typeof err === "object" &&
  "name" in err &&
  (err as { name?: string }).name === "RenderingCancelledException";

export default function PdfViewerWithHighlights({
  entryId,
  volumeId,
  targetPage,
  chatQuote,
  onHighlightsChanged,
}: PdfViewerWithHighlightsProps) {
  const fileUrl = volumeId
    ? `/api/library/${entryId}/pdf?volume=${encodeURIComponent(volumeId)}`
    : `/api/library/${entryId}/pdf`;

  // ── DOM refs ────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const pageWrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);

  // ── pdfjs handle refs (not state — never re-render on change) ───
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const textLayerInstanceRef = useRef<{ cancel: () => void } | null>(null);
  // Monotonic counter — every render attempt bumps this and each async
  // stage checks `if (token !== renderTokenRef.current) return;` so a
  // superseded promise can never write into the DOM.
  const renderTokenRef = useRef(0);

  // ── State ───────────────────────────────────────────────────────
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorContext, setErrorContext] = useState<{
    status: string;
    hasFile: boolean;
    error: string | null;
  } | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  // 0 until the container is measured — Effect C refuses to render
  // before then, eliminating the "first render at wrong width" race.
  const [width, setWidth] = useState(0);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [selection, setSelection] = useState<SelectionPopup | null>(null);
  const [creating, setCreating] = useState(false);
  const [chatQuoteRects, setChatQuoteRects] = useState<RangeRect[] | null>(
    null,
  );
  // Bumped every time the text layer finishes rendering for the
  // current page. The chat-quote scan effect uses this as a trigger so
  // it knows when DOM spans are queryable.
  const [textLayerVersion, setTextLayerVersion] = useState(0);
  // Doc loaded flag — keeps Effect C off until Effect B has assigned
  // docRef.current and we know numPages.
  const [docReady, setDocReady] = useState(false);

  // ── Effect: width settle ────────────────────────────────────────
  // ResizeObserver still has 220ms settle; not a correctness gate
  // anymore (cancellation is) but cuts wasted work during animations.
  useEffect(() => {
    if (!containerRef.current) return;
    let timer: number | null = null;
    let last = 0;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.max(320, Math.min(900, e.contentRect.width));
        last = w;
        if (timer !== null) window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          setWidth(last);
          timer = null;
        }, 220);
      }
    });
    ro.observe(containerRef.current);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      ro.disconnect();
    };
  }, []);

  // ── Effect: load document when fileUrl changes ──────────────────
  useEffect(() => {
    let cancelled = false;
    setStatus("loading-doc");
    setErrorMsg(null);
    setDocReady(false);
    setNumPages(0);
    setPage((prev) => prev);
    // Tear down any prior doc — we are about to replace it.
    if (renderTaskRef.current) {
      try {
        renderTaskRef.current.cancel();
      } catch {
        /* ignore */
      }
      renderTaskRef.current = null;
    }
    if (textLayerInstanceRef.current) {
      try {
        textLayerInstanceRef.current.cancel();
      } catch {
        /* ignore */
      }
      textLayerInstanceRef.current = null;
    }
    if (loadingTaskRef.current) {
      loadingTaskRef.current.destroy().catch(() => {});
      loadingTaskRef.current = null;
    }
    if (docRef.current) {
      docRef.current.destroy().catch(() => {});
      docRef.current = null;
    }

    const task = pdfjs.getDocument({
      url: fileUrl,
      withCredentials: true,
      isEvalSupported: false,
    });
    loadingTaskRef.current = task;

    task.promise
      .then((doc) => {
        if (cancelled) {
          doc.destroy().catch(() => {});
          return;
        }
        docRef.current = doc;
        setNumPages(doc.numPages);
        setDocReady(true);
      })
      .catch((err: unknown) => {
        if (cancelled || isCancelled(err)) return;
        console.error("[pdfjs] Document load failed", {
          entryId,
          volumeId,
          fileUrl,
          err,
        });
        const e = err as { name?: string; message?: string } | undefined;
        setErrorMsg(
          e?.name
            ? `${e.name}: ${e.message ?? ""}`
            : e?.message ?? "load failed",
        );
        setStatus("error");
      });

    return () => {
      cancelled = true;
      if (loadingTaskRef.current === task) {
        task.destroy().catch(() => {});
        loadingTaskRef.current = null;
      }
    };
  }, [fileUrl, entryId, volumeId]);

  // ── Effect: render page when (doc, page, width) change ─────────
  // The whole point of the rewrite. Cancel any in-flight render task
  // and text-layer build before starting a new one. Token counter
  // makes async writes safe even if cancellation has latency.
  useEffect(() => {
    if (!docReady || width <= 0) return;
    const doc = docRef.current;
    if (!doc) return;
    const token = ++renderTokenRef.current;

    // Cancel anything in flight from a previous render.
    if (renderTaskRef.current) {
      try {
        renderTaskRef.current.cancel();
      } catch {
        /* ignore */
      }
      renderTaskRef.current = null;
    }
    if (textLayerInstanceRef.current) {
      try {
        textLayerInstanceRef.current.cancel();
      } catch {
        /* ignore */
      }
      textLayerInstanceRef.current = null;
    }
    if (textLayerRef.current) {
      textLayerRef.current.replaceChildren();
    }
    setChatQuoteRects(null);
    setStatus("loading-page");

    let unmounted = false;
    (async () => {
      try {
        const pageProxy = await doc.getPage(page);
        if (unmounted || token !== renderTokenRef.current) {
          pageProxy.cleanup();
          return;
        }
        const baseViewport = pageProxy.getViewport({ scale: 1 });
        const scale = width / baseViewport.width;
        const viewport = pageProxy.getViewport({ scale });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        const canvas = canvasRef.current;
        const textLayerContainer = textLayerRef.current;
        const pageWrap = pageWrapRef.current;
        if (!canvas || !textLayerContainer || !pageWrap) return;

        // Match canvas backing store to dpr but keep CSS size at the
        // viewport pixels — otherwise retina canvases are blurry.
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        textLayerContainer.style.width = `${viewport.width}px`;
        textLayerContainer.style.height = `${viewport.height}px`;
        pageWrap.style.width = `${viewport.width}px`;
        pageWrap.style.height = `${viewport.height}px`;

        const renderTask = pageProxy.render({
          canvas,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        renderTaskRef.current = renderTask;
        try {
          await renderTask.promise;
        } catch (err: unknown) {
          if (isCancelled(err)) return;
          throw err;
        }
        if (unmounted || token !== renderTokenRef.current) return;

        // Build text layer. pdfjs's TextLayer class produces span-
        // based DOM identical to what react-pdf was wrapping, so the
        // mouseup/selection math and findChatQuoteRects work unchanged.
        const textContentSource = pageProxy.streamTextContent({
          includeMarkedContent: false,
          disableNormalization: false,
        });
        const TextLayerCtor = (
          pdfjs as unknown as {
            TextLayer: new (params: {
              textContentSource: unknown;
              container: HTMLElement;
              viewport: unknown;
            }) => { render: () => Promise<unknown>; cancel: () => void };
          }
        ).TextLayer;
        const tl = new TextLayerCtor({
          textContentSource,
          container: textLayerContainer,
          viewport,
        });
        textLayerInstanceRef.current = tl;
        try {
          await tl.render();
        } catch (err: unknown) {
          if (isCancelled(err)) return;
          throw err;
        }
        if (unmounted || token !== renderTokenRef.current) return;

        setStatus("ready");
        setTextLayerVersion((v) => v + 1);
      } catch (err: unknown) {
        if (unmounted || token !== renderTokenRef.current) return;
        if (isCancelled(err)) return;
        console.error("[pdfjs] Page render failed", err);
        const e = err as { name?: string; message?: string } | undefined;
        setErrorMsg(
          e?.name
            ? `${e.name}: ${e.message ?? ""}`
            : e?.message ?? "render failed",
        );
        setStatus("error");
      }
    })();

    return () => {
      unmounted = true;
      // Token bump on next run handles late callbacks; cancelling
      // here just halts pdfjs work earlier.
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          /* ignore */
        }
      }
      if (textLayerInstanceRef.current) {
        try {
          textLayerInstanceRef.current.cancel();
        } catch {
          /* ignore */
        }
      }
    };
  }, [docReady, page, width]);

  // ── Effect: pdf-status sidecar on error ─────────────────────────
  // Same shape as the prior implementation: when load/render fails,
  // ask the server why so we can show "PDF işleniyor" vs "başarısız"
  // vs "yüklenmemiş" instead of a generic failure.
  useEffect(() => {
    if (status !== "error") {
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
  }, [status, entryId, volumeId]);

  // ── Effect: honour external page-jump prop ──────────────────────
  useEffect(() => {
    if (typeof targetPage === "number" && targetPage > 0) {
      setPage(targetPage);
    }
  }, [targetPage]);

  // ── Effect: load highlights for the entry ───────────────────────
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

  // ── Mouse-up → selection rect math (unchanged) ──────────────────
  function handleMouseUp() {
    if (!pageWrapRef.current) return;
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
    const pageRect = pageWrapRef.current.getBoundingClientRect();
    if (pageRect.width === 0 || pageRect.height === 0) return;

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
          x: r.right - pageRect.left,
          y: r.bottom - pageRect.top,
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

  // ── findChatQuoteRects: same algorithm, now queries textLayerRef ─
  const findChatQuoteRects = useCallback(
    (quote: string): RangeRect[] | null => {
      const textLayer = textLayerRef.current;
      const pageWrap = pageWrapRef.current;
      if (!textLayer || !pageWrap) return null;
      const norm = (s: string) =>
        s.toLowerCase().replace(/\s+/g, " ").trim();
      const normQuote = norm(quote);
      if (normQuote.length < 12) return null;
      const sentenceCut = normQuote.search(/[.!?؟]\s/);
      const anchorLen =
        sentenceCut > 12 && sentenceCut < 120
          ? sentenceCut
          : Math.min(80, normQuote.length);
      const anchor = normQuote.slice(0, anchorLen);

      const rawSpans = Array.from(
        textLayer.querySelectorAll("span"),
      ) as HTMLElement[];
      let combined = "";
      const spanOffsets: Array<{
        span: HTMLElement;
        start: number;
        end: number;
      }> = [];
      for (const s of rawSpans) {
        const txt = norm(s.textContent ?? "");
        if (!txt) continue;
        if (combined && !combined.endsWith(" ")) combined += " ";
        const start = combined.length;
        combined += txt;
        spanOffsets.push({ span: s, start, end: combined.length });
      }
      const idx = combined.indexOf(anchor);
      if (idx === -1) return null;
      const matchEnd = idx + anchor.length;

      const pageRect = pageWrap.getBoundingClientRect();
      if (pageRect.width === 0 || pageRect.height === 0) return null;
      const seen = new Set<string>();
      const rects: RangeRect[] = [];
      for (const { span, start, end } of spanOffsets) {
        if (end <= idx || start >= matchEnd) continue;
        const r = span.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const x = (r.left - pageRect.left) / pageRect.width;
        const y = (r.top - pageRect.top) / pageRect.height;
        const w = r.width / pageRect.width;
        const h = r.height / pageRect.height;
        if (x < 0 || y < 0 || x + w > 1.001 || y + h > 1.001) continue;
        const key = `${x.toFixed(3)}-${y.toFixed(3)}-${w.toFixed(3)}-${h.toFixed(3)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rects.push({ x, y, w, h });
      }
      return rects.length > 0 ? rects : null;
    },
    [],
  );

  // Once-per-quote guard for the ±2 neighbor jump below: if the chunk's
  // pageNumber is off-by-1/2 (very common — extraction pipeline page
  // counts don't always match the PDF's), we only auto-jump once when
  // the quote arrives. Subsequent manual nav stays under the user's
  // control.
  const neighborJumpRef = useRef<{ quote: string; tried: boolean }>({
    quote: "",
    tried: false,
  });

  // ── Effect: scan chat quote when text layer is ready or quote
  //    changes mid-life (clicking a different citation on same page) ─
  useEffect(() => {
    if (status !== "ready") return;
    if (!chatQuote) {
      setChatQuoteRects(null);
      return;
    }
    // Quote changed → allow a fresh neighbor search.
    if (neighborJumpRef.current.quote !== chatQuote) {
      neighborJumpRef.current = { quote: chatQuote, tried: false };
    }

    // First: try the current page (the chip's target page).
    const onPage = findChatQuoteRects(chatQuote);
    if (onPage) {
      setChatQuoteRects(onPage);
      return;
    }
    setChatQuoteRects(null);

    // Not on this page. If we already jumped for this quote, stop —
    // user is now in control of navigation, banner stays visible
    // either way.
    if (neighborJumpRef.current.tried) return;
    neighborJumpRef.current.tried = true;

    const doc = docRef.current;
    if (!doc) return;

    // Build the same anchor used by findChatQuoteRects so success
    // criteria are identical on the destination page.
    const norm = (s: string) =>
      s.toLowerCase().replace(/\s+/g, " ").trim();
    const normQuote = norm(chatQuote);
    if (normQuote.length < 12) return;
    const sentenceCut = normQuote.search(/[.!?؟]\s/);
    const anchorLen =
      sentenceCut > 12 && sentenceCut < 120
        ? sentenceCut
        : Math.min(80, normQuote.length);
    const anchor = normQuote.slice(0, anchorLen);

    // Interleave near→far so off-by-1 wins over off-by-2.
    const total = numPages || 0;
    const candidates = [page + 1, page - 1, page + 2, page - 2].filter(
      (p) => p >= 1 && p <= total && p !== page,
    );

    let cancelled = false;
    (async () => {
      for (const candidate of candidates) {
        if (cancelled) return;
        try {
          const p = await doc.getPage(candidate);
          const tc = await p.getTextContent({
            includeMarkedContent: false,
            disableNormalization: false,
          });
          const raw = (tc.items as Array<{ str?: string }>)
            .map((item) => item.str ?? "")
            .join(" ");
          const normRaw = norm(raw);
          p.cleanup();
          if (normRaw.indexOf(anchor) !== -1) {
            if (!cancelled) setPage(candidate);
            return;
          }
        } catch {
          /* skip this candidate */
        }
      }
      // No neighbor matches — banner stays, no gold rects.
    })();

    return () => {
      cancelled = true;
    };
  }, [chatQuote, textLayerVersion, status, findChatQuoteRects, page, numPages]);

  // ── Highlight save / delete ─────────────────────────────────────
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
      toast.success(
        opts.withNote
          ? "Highlight + not kaydedildi."
          : "Highlight kaydedildi.",
      );
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
  const isError = status === "error";
  const isLoadingDoc = status === "loading-doc";
  const isLoadingPage = status === "loading-page";

  return (
    <div ref={containerRef} className="w-full flex flex-col gap-2">
      {/* Inline CSS for the pdfjs text layer — picks the rules we need
          from pdfjs-dist/web/pdf_viewer.css without pulling in the
          whole stylesheet. Marked global via tailwind-friendly
          arbitrary selectors. */}
      <style jsx global>{`
        .pdf-text-layer {
          position: absolute;
          inset: 0;
          overflow: hidden;
          opacity: 1;
          line-height: 1;
          text-size-adjust: none;
          forced-color-adjust: none;
          transform-origin: 0 0;
          z-index: 2;
        }
        .pdf-text-layer span,
        .pdf-text-layer br {
          color: transparent;
          position: absolute;
          white-space: pre;
          cursor: text;
          transform-origin: 0% 0%;
        }
        .pdf-text-layer ::selection {
          background: rgba(0, 0, 255, 0.25);
        }
      `}</style>

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

      {/* PDF page area */}
      <div className="relative w-full bg-page/40 border border-sandy/50 rounded-sm flex justify-center overflow-hidden min-h-[200px]">
        {isError ? (
          <PdfErrorState
            entryId={entryId}
            context={errorContext}
            loadError={errorMsg}
          />
        ) : isLoadingDoc ? (
          <div className="flex items-center gap-2 py-10 text-ink-light font-ui text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            PDF yükleniyor...
          </div>
        ) : (
          <>
            {/* Small overlay spinner during page transitions. The
                canvas underneath still shows the previous page until
                the new render commits — one canvas, one swap, no
                blank flash. */}
            {isLoadingPage && (
              <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5 px-2 py-1 rounded-sm bg-white/85 backdrop-blur text-ink-light font-ui text-[11px] pointer-events-none">
                <Loader2 className="h-3 w-3 animate-spin" />
                Sayfa yükleniyor…
              </div>
            )}
            <div
              ref={pageWrapRef}
              className="relative inline-block"
              onMouseUp={handleMouseUp}
            >
              {/* One stable canvas, never replaced. pdfjs writes
                  pixels into this directly via canvasRef. */}
              <canvas
                ref={canvasRef}
                style={{
                  display: "block",
                  position: "relative",
                  zIndex: 0,
                }}
              />
              {/* AI-citation overlay — translucent gold rectangles
                  over the quoted passage. pointer-events:none so
                  selection still works through it. z-index between
                  canvas (0) and text layer (2). */}
              {chatQuoteRects?.map((r, i) => (
                <div
                  key={`chat-quote-${i}`}
                  style={{
                    position: "absolute",
                    left: `${r.x * 100}%`,
                    top: `${r.y * 100}%`,
                    width: `${r.w * 100}%`,
                    height: `${r.h * 100}%`,
                    backgroundColor: "rgb(212, 175, 55)",
                    opacity: 0.32,
                    pointerEvents: "none",
                    borderRadius: 1,
                    zIndex: 1,
                  }}
                />
              ))}
              {/* Saved highlights overlay. */}
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
                      zIndex: 1,
                    }}
                  />
                ));
              })}
              {/* Text layer — pdfjs's TextLayer class populates this
                  container with absolutely-positioned spans. Sits on
                  top so window.getSelection picks up its transparent
                  text rather than the canvas pixels. */}
              <div ref={textLayerRef} className="pdf-text-layer" />
              {/* Selection popup */}
              {selection && (
                <div
                  className="absolute z-20 flex items-center gap-1 rounded-sm border border-sandy bg-white shadow-md px-1.5 py-1"
                  style={{
                    left: Math.min(
                      Math.max(0, selection.anchorX),
                      Math.max(0, width - 200),
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
          </>
        )}
      </div>

      {/* Per-page highlight list */}
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
  loadError,
}: {
  entryId: string;
  context: {
    status: string;
    hasFile: boolean;
    error: string | null;
  } | null;
  loadError: string | null;
}) {
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

  return (
    <div className="flex flex-col items-center gap-2 py-10 px-6 text-center font-ui text-sm max-w-[440px]">
      <AlertTriangle className="h-5 w-5 text-ink-muted" />
      <div className="font-display italic text-[15px] text-ink">
        {hasFile ? "PDF okunamadı" : "Bu kaynak için PDF yüklenmemiş"}
      </div>
      <div className="text-[12.5px] text-ink-light">
        {hasFile
          ? "Dosya disk üzerinde ama açılamıyor. Yeniden yüklemeyi dene."
          : "Kaynak künyesi kütüphanende ama dosyası yok. Yüklediğinde sayfa numaralı atıflar burada gezinebilir hâle gelecek."}
      </div>
      {loadError && (
        <div className="mt-1 text-[10.5px] text-ink-muted font-mono break-all">
          {loadError}
        </div>
      )}
      <a
        href={`/library?entry=${entryId}`}
        className="mt-2 inline-flex items-center px-3 py-1.5 rounded-md bg-gold text-white font-semibold text-[12px] hover:bg-gold-hover transition-colors"
      >
        Kütüphanede aç & PDF yükle
      </a>
    </div>
  );
}
