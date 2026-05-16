"use client";

/**
 * react-pdf wrapper that renders a single page of a LibraryEntry's
 * PDF, fed by the auth-scoped /api/library/[id]/pdf stream. Used by
 * the citation verify panel as the on-demand "show me the original"
 * view. Lazy import + dynamic so the heavy pdfjs worker only ships
 * when the user actually opens a verification.
 */
import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Loader2, AlertTriangle } from "lucide-react";

// Worker URL pinned to the version we install. react-pdf hosts the
// worker via unpkg by default, but we point to the bundled module
// to avoid an external CDN dependency.
if (typeof window !== "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
}

interface PdfPageViewerProps {
  entryId: string;
  page: number;
  volumeId?: string | null;
}

export default function PdfPageViewer({ entryId, page, volumeId }: PdfPageViewerProps) {
  const fileUrl = volumeId
    ? `/api/library/${entryId}/pdf?volume=${encodeURIComponent(volumeId)}`
    : `/api/library/${entryId}/pdf`;
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState<number>(640);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.max(280, Math.min(900, e.contentRect.width));
        setWidth(w);
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full bg-page/40 border border-sandy/50 rounded-sm p-3 flex justify-center"
    >
      {error ? (
        <div className="flex items-center gap-2 py-10 text-destructive font-ui text-sm">
          <AlertTriangle className="h-4 w-4" />
          PDF yüklenemedi
        </div>
      ) : (
        <Document
          file={fileUrl}
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
          <Page
            pageNumber={page}
            width={width}
            renderAnnotationLayer={false}
            renderTextLayer={false}
          />
        </Document>
      )}
    </div>
  );
}
