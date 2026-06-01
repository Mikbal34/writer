"use client";

/**
 * Right-pane verification view for /projects/[id]/citations.
 *
 * Layout:
 *   ┌───────────────────────────────────────────────────────────────┐
 *   │ Verdict strip — bibliography + verification badge + context  │
 *   │   + matched snippet (when the verifier found something)       │
 *   ├───────────────────────────────────────────────────────────────┤
 *   │                                                                │
 *   │ PdfReaderPanel — same component the library chat uses, with   │
 *   │ chatQuote banner, page navigation, highlight overlay.         │
 *   │                                                                │
 *   └───────────────────────────────────────────────────────────────┘
 *
 * The previous version had a button to lazy-open the PDF; we now open
 * the PDF panel unconditionally whenever the citation actually points
 * at a library entry + page, so the reader sees the page immediately.
 */
import dynamic from "next/dynamic";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  FileText,
  XCircle,
} from "lucide-react";

const PdfReaderPanel = dynamic(
  () => import("@/components/library/PdfReaderPanel"),
  { ssr: false, loading: () => null },
);

export type CitationVerification = {
  status: "unverified" | "verified" | "suspected" | "failed";
  matchScore: number | null;
  matchMethod: string | null;
  matchedPage: number | null;
  userOverride: boolean;
  verifiedAt: string | null;
};

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
  verification: CitationVerification | null;
}

interface CitationVerifyPanelProps {
  citation: CitationRecord;
  /** All citations in the project — used to derive the cohort of other
   *  pages from the same source so the PDF reader's footer can offer
   *  jump pills to neighbouring citations. */
  allCitations: CitationRecord[];
}

function VerdictBadge({
  status,
  method,
  score,
}: {
  status: CitationVerification["status"];
  method: string | null;
  score: number | null;
}) {
  if (status === "verified") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-sm bg-forest-light/15 text-forest font-ui text-xs">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Doğrulandı
        {method && method !== "exact" && score !== null && (
          <span className="text-forest/70 font-ui text-[10px]">
            · {method} · {(score * 100).toFixed(0)}%
          </span>
        )}
      </span>
    );
  }
  if (status === "suspected") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-sm bg-gold/15 text-gold-dark font-ui text-xs">
        <AlertTriangle className="h-3.5 w-3.5" />
        Şüpheli
        {score !== null && (
          <span className="text-gold-dark/70 font-ui text-[10px]">
            · {(score * 100).toFixed(0)}%
          </span>
        )}
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-sm bg-red-50 text-red-700 font-ui text-xs">
        <XCircle className="h-3.5 w-3.5" />
        Uymuyor
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-sm bg-sandy/40 text-ink-light font-ui text-xs">
      <Circle className="h-3.5 w-3.5" />
      Bekliyor
    </span>
  );
}

export default function CitationVerifyPanel({
  citation,
  allCitations,
}: CitationVerifyPanelProps) {
  const bib = citation.bibliography;
  const entryId = bib?.libraryEntryId ?? null;
  const page = citation.page;
  const volumeId = citation.volumeId;
  const verification = citation.verification;

  const headerLabel = bib
    ? `${bib.authorSurname}${bib.year ? `, ${bib.year}` : ""}`
    : "Bilinmeyen kaynak";
  const headerTitle = bib?.title ?? citation.label;

  // Pages from the same library entry that also got cited in this
  // project — fed into PdfReaderPanel's footer jump pills.
  const cohortPages =
    entryId !== null
      ? Array.from(
          new Set(
            allCitations
              .filter(
                (c) =>
                  c.bibliography?.libraryEntryId === entryId &&
                  c.volumeId === volumeId &&
                  typeof c.page === "number",
              )
              .map((c) => c.page as number),
          ),
        )
      : [];

  const hasPdf = Boolean(entryId) && page !== null && bib?.hasPdf;

  return (
    <div className="h-full flex flex-col bg-page">
      {/* Verdict + context strip */}
      <div className="shrink-0 px-5 lg:px-7 py-4 border-b border-sandy/60 bg-elevated">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-ui text-[11px] text-ink-light mb-1 truncate">
              {citation.chapterNumber}. {citation.chapterTitle} · {citation.subsectionLabel}{" "}
              {citation.subsectionTitle}
            </div>
            <h2 className="font-display text-lg font-semibold text-ink leading-snug">
              {headerTitle}
            </h2>
            <p className="font-ui text-xs text-ink-light mt-0.5">
              {headerLabel}
              {citation.volumeNumber !== null && (
                <span className="text-ink-light"> · c. {citation.volumeNumber}</span>
              )}
              {page !== null && (
                <span className="text-ink-light"> · s. {page}</span>
              )}
              {verification?.matchedPage !== undefined &&
                verification?.matchedPage !== null &&
                verification.matchedPage !== page && (
                  <span className="text-gold-dark">
                    {" "}
                    · Kaynakta bulunan: s. {verification.matchedPage}
                  </span>
                )}
            </p>
          </div>
          <VerdictBadge
            status={verification?.status ?? "unverified"}
            method={verification?.matchMethod ?? null}
            score={verification?.matchScore ?? null}
          />
        </div>

        {citation.contextSnippet && (
          <div className="mt-3 flex items-start gap-2">
            <FileText className="h-3.5 w-3.5 text-ink-light shrink-0 mt-0.5" />
            <p className="font-body text-xs text-ink-light leading-relaxed">
              <span className="font-ui text-[10px] uppercase tracking-wider text-ink-muted mr-1.5">
                Yazıdaki bağlam:
              </span>
              {citation.contextSnippet}
            </p>
          </div>
        )}
      </div>

      {/* PDF panel — same component the library chat uses */}
      <div className="flex-1 min-h-0">
        {!entryId ? (
          <div className="h-full flex items-center justify-center px-5">
            <div className="max-w-md text-center flex flex-col items-center gap-2 text-ink-light">
              <AlertTriangle className="h-6 w-6 text-gold-dark" />
              <p className="font-body text-sm">
                Bu kaynak kütüphanedeki bir PDF&apos;e bağlı değil — sadece
                manuel künye girilmiş, içerik doğrulaması yapılamıyor.
              </p>
            </div>
          </div>
        ) : page === null ? (
          <div className="h-full flex items-center justify-center px-5">
            <div className="max-w-md text-center flex flex-col items-center gap-2 text-ink-light">
              <AlertTriangle className="h-6 w-6 text-gold-dark" />
              <p className="font-body text-sm">
                Bu atıfa sayfa numarası girilmemiş. Düzenlemek için yazma
                ekranına dön.
              </p>
            </div>
          </div>
        ) : !hasPdf ? (
          <div className="h-full flex items-center justify-center px-5">
            <div className="max-w-md text-center flex flex-col items-center gap-2 text-ink-light">
              <AlertTriangle className="h-6 w-6 text-gold-dark" />
              <p className="font-body text-sm">
                Bu kaynağın PDF&apos;i henüz yüklenmemiş; sadece metin
                karşılaştırması yapılabiliyor.
              </p>
            </div>
          </div>
        ) : (
          <PdfReaderPanel
            key={`${entryId}:${volumeId ?? "x"}:${page}`}
            entryId={entryId}
            volumeId={volumeId}
            title={headerTitle}
            targetPage={page}
            cohortPages={cohortPages}
            chatQuote={citation.quote}
          />
        )}
      </div>
    </div>
  );
}
