"use client";

/**
 * V3-styled compact header for the right detail panel.
 *
 *   ┌─────────────────────────────────────────────┐
 *   │ ┌────┐                                       │
 *   │ │book│  Title (serif, 2-line clamp)         │
 *   │ │cov │  Yazar · Publisher · Yıl              │
 *   │ │er  │  [💬 Bu kitaba sor]  [✎]  [↗]       │
 *   │ └────┘                                       │
 *   │                                              │
 *   │ İstatistik                                   │
 *   │ 📝 14 not   📎 42 alıntı                    │
 *   │                                              │
 *   │ Son alıntılar                                │
 *   │ "Kalâm, akıl yürütülmüş söz..."  s.23 →    │
 *   └─────────────────────────────────────────────┘
 *
 * The "Bu kitaba sor" deep-link target is `/library/[id]/ask` — the
 * split-view "research lab" route. Until Phase 2 ships that route the
 * link falls back to `/library/chat?entryId=…` so the button stays
 * functional during the interim.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Pencil,
  MessageSquare,
  ExternalLink,
  FileText,
  Highlighter,
} from "lucide-react";
import type { LibraryEntryRow } from "./LibraryEntryTable";

interface BookSpineProps {
  title: string;
  color: string;
  accent: string;
  spine: string;
}

/** Cheap book-spine mockup matching the card view; 80×112 px tile. */
function BookSpine({ title, color, accent, spine }: BookSpineProps) {
  return (
    <div
      className="relative w-[80px] h-[112px] rounded-sm overflow-hidden shrink-0"
      style={{
        background: `linear-gradient(160deg, ${color} 0%, ${accent} 100%)`,
      }}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-2"
        style={{ background: `linear-gradient(to right, ${spine}, ${color})` }}
      />
      <div className="absolute inset-0 flex items-center justify-center px-2">
        <span
          className="font-display text-[10px] font-semibold leading-tight text-center line-clamp-4"
          style={{
            color: "rgba(250,247,240,0.92)",
            textShadow: "0 1px 2px rgba(0,0,0,0.4)",
          }}
        >
          {title}
        </span>
      </div>
    </div>
  );
}

const ENTRY_TYPE_COLORS: Record<string, { color: string; accent: string; spine: string }> = {
  kitap: { color: "#2D5016", accent: "#4a7a2e", spine: "#1e3a0e" },
  makale: { color: "#1E3A5C", accent: "#3a6a9c", spine: "#122840" },
  nesir: { color: "#5C3D1E", accent: "#8a6a3e", spine: "#3d2810" },
  ceviri: { color: "#3D1E5C", accent: "#6a3e8a", spine: "#2a1040" },
  tez: { color: "#5C1E2D", accent: "#8a3e4d", spine: "#40101e" },
  ansiklopedi: { color: "#3D3D1E", accent: "#6a6a3e", spine: "#2a2a10" },
  web: { color: "#1E5C5C", accent: "#3a8a8a", spine: "#104040" },
};

interface RecentHighlight {
  id: string;
  pageNumber: number;
  text: string;
}

interface EntryDetailHeaderProps {
  entry: LibraryEntryRow;
  onEdit: () => void;
  /** Click on a recent highlight → parent flips to PDF tab + jumps. */
  onJumpToPage: (page: number) => void;
}

export default function EntryDetailHeader({
  entry,
  onEdit,
  onJumpToPage,
}: EntryDetailHeaderProps) {
  const color =
    ENTRY_TYPE_COLORS[entry.entryType] ?? ENTRY_TYPE_COLORS.kitap;

  // Note + highlight counts arrive on the entry row via _count from
  // /api/library. Highlights themselves load via a small request so the
  // "Son alıntılar" strip stays accurate after pinning.
  const noteCount = entry._count?.notes ?? 0;
  const [recent, setRecent] = useState<RecentHighlight[]>([]);
  const [highlightCount, setHighlightCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(
          `/api/library/entries/${entry.id}/highlights`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          highlights: Array<{
            id: string;
            pageNumber: number;
            text: string;
            createdAt: string;
          }>;
        };
        if (cancelled) return;
        setHighlightCount(data.highlights.length);
        // Newest first — API returns ascending by page; we re-sort by
        // createdAt desc so "Son alıntılar" actually feels recent.
        const sorted = [...data.highlights].sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt),
        );
        setRecent(sorted.slice(0, 3));
      } catch {
        /* non-fatal */
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [entry.id, noteCount]);

  return (
    <div className="px-4 pt-4 pb-3 border-b border-[#d4c9b5]/60 space-y-3">
      <div className="flex items-start gap-3">
        <BookSpine
          title={entry.title}
          color={color.color}
          accent={color.accent}
          spine={color.spine}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <h2
            dir="auto"
            className="font-display text-base font-semibold text-ink leading-snug line-clamp-2"
          >
            {entry.title}
          </h2>
          <p
            dir="auto"
            className="font-body text-xs text-[#5C4A32] line-clamp-2"
          >
            {entry.authorSurname}
            {entry.authorName ? `, ${entry.authorName}` : ""}
            {entry.year ? ` · ${entry.year}` : ""}
          </p>
          <div className="flex items-center gap-1.5 pt-1">
            <Link
              href={`/library/${entry.id}/ask`}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm bg-[#C9A84C] text-[#1A0F05] font-ui text-[11px] font-semibold hover:bg-[#d4b85a] transition-colors"
            >
              <MessageSquare className="h-3 w-3" />
              Bu kitaba sor
            </Link>
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center justify-center h-6 w-6 rounded-sm border border-[#d4c9b5] text-[#5C4A32] hover:bg-white"
              title="Künyeyi düzenle"
            >
              <Pencil className="h-3 w-3" />
            </button>
            {entry.filePath && entry.fileType === "pdf" && (
              <a
                href={`/api/library/${entry.id}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center h-6 w-6 rounded-sm border border-[#d4c9b5] text-[#5C4A32] hover:bg-white"
                title="PDF'i yeni sekmede aç"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Stats strip */}
      <div className="flex items-center gap-4 px-1">
        <div className="flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 text-[#8a7a65]" />
          <span className="font-display text-base font-semibold text-ink tabular-nums leading-none">
            {noteCount}
          </span>
          <span className="font-ui text-[10px] uppercase tracking-widest text-[#8a7a65]">
            not
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Highlighter className="h-3.5 w-3.5 text-[#8a7a65]" />
          <span className="font-display text-base font-semibold text-ink tabular-nums leading-none">
            {highlightCount ?? "—"}
          </span>
          <span className="font-ui text-[10px] uppercase tracking-widest text-[#8a7a65]">
            alıntı
          </span>
        </div>
      </div>

      {/* Recent highlights — visible only when there are some */}
      {recent.length > 0 && (
        <div className="space-y-1">
          <div className="font-ui text-[10px] uppercase tracking-widest text-[#8a7a65] px-1">
            Son alıntılar
          </div>
          <ul className="space-y-1">
            {recent.map((h) => (
              <li
                key={h.id}
                className="px-2 py-1.5 rounded-sm bg-[#FAF7F0]/60 border border-[#d4c9b5]/40 cursor-pointer hover:bg-[#FAF7F0] transition-colors"
                onClick={() => onJumpToPage(h.pageNumber)}
              >
                <p
                  dir="auto"
                  className="font-body text-[11px] text-ink line-clamp-2 italic"
                >
                  &ldquo;{h.text}&rdquo;
                </p>
                <span className="font-ui text-[10px] text-[#8a7a65]">
                  s.{h.pageNumber}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
