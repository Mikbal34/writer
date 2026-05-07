"use client";

/**
 * Right-hand verification panel for the /projects/[id]/citations page.
 * Shows the bibliography header, the writer's surrounding context, the
 * extracted text from the cited page, and (on demand) the rendered
 * original PDF page. PDF render is lazy because pdfjs is heavy.
 */
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  Loader2,
  FileText,
  BookOpen,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";

const PdfPageViewer = dynamic(
  () => import("@/components/citations/PdfPageViewer"),
  { ssr: false, loading: () => null },
);

export interface CitationRecord {
  key: string;
  bibId: string;
  page: number | null;
  quote: string | null;
  label: string;
  contextSnippet: string;
  subsectionId: string;
  subsectionLabel: string;
  subsectionTitle: string;
  chapterTitle: string;
  chapterNumber: number;
  // Set when the citation targets a specific volume of a multi-volume
  // work; null for single-volume sources.
  volumeId: string | null;
  volumeNumber: number | null;
  bibliography: {
    id: string;
    authorSurname: string;
    authorName: string | null;
    title: string;
    year: string | null;
    libraryEntryId: string | null;
    hasPdf: boolean;
    hasChunks: boolean;
  } | null;
}

interface PageData {
  entry: {
    id: string;
    title: string;
    authorSurname: string;
    authorName: string | null;
    year: string | null;
    hasPdf: boolean;
  };
  pageNumber: number;
  content: string;
  chunkCount: number;
}

interface CitationVerifyPanelProps {
  citation: CitationRecord;
}

function highlightQuote(content: string, quote: string | null): React.ReactNode {
  if (!quote) return content;
  const idx = content.toLowerCase().indexOf(quote.toLowerCase());
  if (idx === -1) return content;
  return (
    <>
      {content.slice(0, idx)}
      <mark className="bg-[#C9A84C]/30 px-0.5 rounded-sm">
        {content.slice(idx, idx + quote.length)}
      </mark>
      {content.slice(idx + quote.length)}
    </>
  );
}

export default function CitationVerifyPanel({
  citation,
}: CitationVerifyPanelProps) {
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPdf, setShowPdf] = useState(false);

  const bib = citation.bibliography;
  const entryId = bib?.libraryEntryId ?? null;
  const page = citation.page;
  const volumeId = citation.volumeId;
  const volumeQuery = volumeId ? `?volume=${encodeURIComponent(volumeId)}` : "";

  useEffect(() => {
    setShowPdf(false);
    setData(null);
    setError(null);

    if (!entryId || !page) {
      return;
    }
    setLoading(true);
    fetch(`/api/library/${entryId}/page/${page}${volumeQuery}`)
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)),
      )
      .then((d: PageData) => setData(d))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [entryId, page, volumeQuery]);

  const headerLabel = bib
    ? `${bib.authorSurname}${bib.year ? `, ${bib.year}` : ""}`
    : "Bilinmeyen kaynak";

  const headerTitle = bib?.title ?? citation.label;

  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="max-w-3xl mx-auto px-6 py-6">
        {/* Header */}
        <div className="border-b border-[#d4c9b5]/50 pb-4 mb-4">
          <div className="font-ui text-xs text-[#8a7a65] mb-1">
            {citation.chapterNumber}. {citation.chapterTitle} · {citation.subsectionLabel}{" "}
            {citation.subsectionTitle}
          </div>
          <h2 className="font-display text-xl font-semibold text-[#2D1F0E]">
            {headerTitle}
          </h2>
          <p className="font-ui text-sm text-[#5C4A32] mt-1">
            {headerLabel}
            {citation.volumeNumber !== null && (
              <span className="text-[#6b5a45]"> · c. {citation.volumeNumber}</span>
            )}
            {page !== null && (
              <span className="text-[#6b5a45]"> · s. {page}</span>
            )}
          </p>
        </div>

        {/* Yazıdaki bağlam */}
        <section className="mb-5">
          <div className="flex items-center gap-1.5 mb-2">
            <FileText className="h-3.5 w-3.5 text-[#6b5a45]" />
            <h3 className="font-ui text-xs uppercase tracking-wider text-[#8a7a65]">
              Yazıdaki bağlam
            </h3>
          </div>
          <div className="font-body text-sm text-[#2D1F0E] leading-relaxed bg-[#FAF7F0]/60 border border-[#d4c9b5]/40 rounded-sm p-3">
            {citation.contextSnippet || (
              <span className="text-[#a89880] italic">
                (Bağlam çıkarılamadı)
              </span>
            )}
          </div>
        </section>

        {/* Kaynak metni */}
        <section className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <BookOpen className="h-3.5 w-3.5 text-[#6b5a45]" />
              <h3 className="font-ui text-xs uppercase tracking-wider text-[#8a7a65]">
                Kaynak metni {page ? `· s. ${page}` : ""}
              </h3>
            </div>
            {data?.entry.hasPdf && entryId && page && (
              <button
                type="button"
                onClick={() => setShowPdf((v) => !v)}
                className="flex items-center gap-1 font-ui text-xs px-2.5 py-1 rounded-sm border border-[#d4c9b5] bg-[#FAF7F0]/70 text-[#5C4A32] hover:bg-[#FAF7F0]"
              >
                <ExternalLink className="h-3 w-3" />
                {showPdf ? "PDF'i gizle" : "Orijinal PDF sayfasını aç"}
              </button>
            )}
          </div>

          {!entryId ? (
            <div className="flex items-center gap-2 p-3 rounded-sm bg-[#FAF7F0]/60 border border-[#d4c9b5]/40 text-[#8a7540] font-body text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Bu kaynak kütüphanedeki bir PDF'e bağlı değil — sadece manuel
              künye girilmiş, içerik doğrulaması yapılamaz.
            </div>
          ) : !page ? (
            <div className="flex items-center gap-2 p-3 rounded-sm bg-[#FAF7F0]/60 border border-[#d4c9b5]/40 text-[#8a7540] font-body text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Bu atıfa sayfa numarası girilmemiş — düzenlemek için yazma
              ekranına dön.
            </div>
          ) : loading ? (
            <div className="flex items-center gap-2 py-6 text-[#8a7a65] font-ui text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Sayfa metni yükleniyor...
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 p-3 rounded-sm bg-red-50 border border-red-200 text-red-800 font-body text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Yüklenemedi: {error}
            </div>
          ) : data && data.content ? (
            <div className="font-body text-sm text-[#2D1F0E] leading-relaxed bg-white border border-[#d4c9b5]/60 rounded-sm p-3 whitespace-pre-wrap">
              {highlightQuote(data.content, citation.quote)}
            </div>
          ) : (
            <div className="flex items-center gap-2 p-3 rounded-sm bg-[#FAF7F0]/60 border border-[#d4c9b5]/40 text-[#8a7540] font-body text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Bu sayfa için çıkarılmış metin yok. Çıkarma akışı henüz
              tamamlanmamış olabilir.
            </div>
          )}
        </section>

        {/* PDF render */}
        {showPdf && entryId && page && (
          <section>
            <div className="flex items-center gap-1.5 mb-2">
              <BookOpen className="h-3.5 w-3.5 text-[#6b5a45]" />
              <h3 className="font-ui text-xs uppercase tracking-wider text-[#8a7a65]">
                Orijinal sayfa
              </h3>
            </div>
            <PdfPageViewer entryId={entryId} page={page} volumeId={volumeId} />
          </section>
        )}
      </div>
    </div>
  );
}
