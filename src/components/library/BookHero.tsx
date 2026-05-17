"use client";

/**
 * Book hero card. Two layouts share data wiring:
 *
 * • variant="full" — V3 detail-panel hero. A dark forest gradient strip
 *   carries the book cover, title, author. Below it: action buttons,
 *   2-column stats grid, and the gold-bar "Son alıntılar" preview.
 *
 * • variant="compact" — chat-panel hero for the per-book split view.
 *   Drops the dark gradient and action buttons; spine + meta + stats
 *   only so the chat surface owns the affordances.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Pencil,
  MessageSquare,
  ExternalLink,
  FileText,
  Highlighter,
  MoreHorizontal,
  Copy,
  Trash2,
  Quote,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { LibraryEntryRow } from "./LibraryEntryTable";

interface CompactSpineProps {
  title: string;
  color: string;
  accent: string;
  spine: string;
}

/** Cream book-spine used by the compact variant only. */
function BookSpine({ title, color, accent, spine }: CompactSpineProps) {
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

const ENTRY_TYPE_COLORS: Record<
  string,
  { color: string; accent: string; spine: string }
> = {
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

interface BookHeroProps {
  entry: LibraryEntryRow;
  variant?: "full" | "compact";
  onEdit?: () => void;
  /** Optional callback fired after a successful destructive action
   *  (delete). Library page hooks this up to its fetchEntries refresh
   *  + close the detail panel. */
  onDeleted?: () => void;
  onJumpToPage?: (page: number) => void;
}

export default function BookHero({
  entry,
  variant = "full",
  onEdit,
  onJumpToPage,
  onDeleted,
}: BookHeroProps) {
  async function handleDelete() {
    if (!confirm(`"${entry.title}" silinsin mi? Bu işlem geri alınamaz.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/library/${entry.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Kaynak silindi");
      onDeleted?.();
    } catch {
      toast.error("Silinemedi");
    }
  }

  async function copyCitation() {
    const parts = [entry.authorSurname, entry.authorName ? `, ${entry.authorName}` : ""];
    const author = parts.filter(Boolean).join("");
    const citation = [
      author,
      entry.year ? `(${entry.year})` : "",
      entry.title,
    ]
      .filter(Boolean)
      .join(". ");
    try {
      await navigator.clipboard.writeText(citation);
      toast.success("Künye kopyalandı");
    } catch {
      toast.error("Kopyalama başarısız");
    }
  }

  async function copyDoi() {
    if (!entry.doi) return;
    try {
      await navigator.clipboard.writeText(entry.doi);
      toast.success("DOI kopyalandı");
    } catch {
      toast.error("Kopyalama başarısız");
    }
  }
  const color = ENTRY_TYPE_COLORS[entry.entryType] ?? ENTRY_TYPE_COLORS.kitap;
  const noteCount = entry._count?.notes ?? 0;
  const [recent, setRecent] = useState<RecentHighlight[]>([]);
  const [highlightCount, setHighlightCount] = useState<number | null>(null);
  const isCompact = variant === "compact";

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/library/entries/${entry.id}/highlights`);
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

  // ── Compact variant (chat panel hero) ─────────────────────────────
  // Same dark forest-deep gradient as the full variant, but trimmed to
  // a single horizontal strip with cover + title + author. No stats,
  // no action buttons — the surrounding chat surface owns those.
  if (isCompact) {
    return (
      <div
        className="relative px-5 py-4 text-gold-soft"
        style={{
          background:
            "linear-gradient(135deg, var(--color-forest-deep) 0%, #1a2818 100%)",
        }}
      >
        <div className="font-ui text-[10px] uppercase tracking-[0.14em] text-gold-soft/70 mb-2">
          Seçili Kaynak
        </div>
        <div className="flex items-end gap-3.5">
          <div
            className="w-[52px] h-[72px] rounded-[3px] shrink-0 flex items-center justify-center px-1.5"
            style={{
              background:
                "linear-gradient(135deg, var(--color-gold), var(--color-gold-dark))",
              boxShadow:
                "0 6px 12px rgba(0,0,0,0.3), inset -3px 0 0 rgba(0,0,0,0.18)",
            }}
          >
            <span
              dir="auto"
              className="font-display italic text-[10px] text-white text-center leading-tight line-clamp-4"
            >
              {entry.title}
            </span>
          </div>
          <div className="min-w-0">
            <h2
              dir="auto"
              className="font-display text-[17px] font-semibold leading-tight text-white line-clamp-2"
            >
              {entry.title}
            </h2>
            <div
              dir="auto"
              className="mt-1 font-display italic text-xs text-gold-soft"
            >
              {entry.authorSurname}
              {entry.authorName ? `, ${entry.authorName}` : ""}
            </div>
            {entry.year && (
              <div className="font-ui text-[11px] text-gold-soft/65 mt-0.5">
                {entry.year}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Full variant (right detail panel — V3 dark hero) ─────────────
  return (
    <div className="flex flex-col">
      {/* Dark hero */}
      <div
        className="relative px-5 pt-6 pb-7 overflow-hidden text-gold-soft"
        style={{
          background:
            "linear-gradient(135deg, var(--color-forest-deep) 0%, #1a2818 100%)",
        }}
      >
        <div className="font-ui text-[10px] uppercase tracking-[0.14em] text-gold-soft/70 mb-4">
          Seçili Kaynak
        </div>
        <div className="flex items-end gap-3.5">
          <div
            className="w-[70px] h-[96px] rounded-[3px] shrink-0 flex items-center justify-center px-2"
            style={{
              background:
                "linear-gradient(135deg, var(--color-gold), var(--color-gold-dark))",
              boxShadow:
                "0 6px 12px rgba(0,0,0,0.3), inset -3px 0 0 rgba(0,0,0,0.18)",
            }}
          >
            <span
              dir="auto"
              className="font-display italic text-[11px] text-white text-center leading-tight line-clamp-4"
            >
              {entry.title}
            </span>
          </div>
          <div className="min-w-0">
            <h2
              dir="auto"
              className="font-display text-[19px] font-semibold leading-tight text-white line-clamp-3"
            >
              {entry.title}
            </h2>
            <div
              dir="auto"
              className="mt-1.5 font-display italic text-xs text-gold-soft"
            >
              {entry.authorSurname}
              {entry.authorName ? `, ${entry.authorName}` : ""}
            </div>
            {entry.year && (
              <div className="font-ui text-[11px] text-gold-soft/65 mt-0.5">
                {entry.year}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Action row */}
      <div className="flex items-center gap-1.5 px-5 pt-4">
        <Link
          href={`/library/chat?entryId=${entry.id}`}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-gold text-white font-ui text-xs font-semibold hover:bg-gold-hover transition-colors"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Bu kitaba sor
        </Link>
        {entry.filePath && entry.fileType === "pdf" && (
          <a
            href={`/api/library/${entry.id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-sandy text-ink-light hover:bg-panel"
            title="PDF'i yeni sekmede aç"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-sandy text-ink-light hover:bg-panel"
          title="Künyeyi düzenle"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-sandy text-ink-light hover:bg-panel"
                title="Daha fazla"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={copyCitation}>
              <Copy className="h-3.5 w-3.5" />
              Künyeyi kopyala
            </DropdownMenuItem>
            {entry.doi && (
              <DropdownMenuItem onClick={copyDoi}>
                <Quote className="h-3.5 w-3.5" />
                DOI&apos;yi kopyala
              </DropdownMenuItem>
            )}
            {entry.openAccessUrl && (
              <DropdownMenuItem
                render={
                  <a
                    href={entry.openAccessUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cursor-pointer"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Açık erişim URL&apos;i
                  </a>
                }
              />
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={handleDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Sil
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* İstatistik */}
      <div className="px-5 pt-5">
        <div className="font-ui text-[10px] uppercase tracking-[0.16em] text-forest mb-2">
          İstatistik
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <StatCard
            icon={<FileText className="h-3.5 w-3.5" />}
            value={noteCount}
            label="not"
          />
          <StatCard
            icon={<Highlighter className="h-3.5 w-3.5" />}
            value={highlightCount ?? "—"}
            label="alıntı"
          />
        </div>
      </div>

      {/* Son alıntılar */}
      {recent.length > 0 && (
        <>
          <div className="px-5 pt-5 pb-2">
            <div className="font-ui text-[10px] uppercase tracking-[0.16em] text-forest">
              Son alıntılar
            </div>
          </div>
          <div className="px-5 pb-5 flex flex-col gap-2.5">
            {recent.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => onJumpToPage?.(h.pageNumber)}
                className="relative text-left px-3 py-2.5 pl-3.5 rounded-md bg-panel hover:bg-elevated transition-colors"
              >
                <span className="absolute left-0 top-2 bottom-2 w-[3px] bg-gold rounded-r-sm" />
                <span
                  dir="auto"
                  className="font-display italic text-[12.5px] leading-relaxed text-ink"
                >
                  &ldquo;{h.text}&rdquo;
                </span>
                <div className="mt-1.5 font-ui text-[10px] text-ink-muted tracking-wide">
                  s.{h.pageNumber}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Inline stat (compact) — used by the chat panel's BookHero.
function Stat({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number | string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("text-ink-light")}>{icon}</span>
      <span className="font-display text-base font-semibold text-ink tabular-nums leading-none">
        {value}
      </span>
      <span className="font-ui text-[10px] uppercase tracking-widest text-ink-light">
        {label}
      </span>
    </div>
  );
}

// Card stat (full) — V3 detail panel.
function StatCard({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number | string;
  label: string;
}) {
  return (
    <div className="bg-panel rounded-md px-3 py-2.5 flex flex-col gap-1">
      <span className="text-forest">{icon}</span>
      <span className="font-display text-[18px] font-semibold text-ink leading-none tabular-nums">
        {value}
      </span>
      <span className="font-ui text-[11px] text-ink-muted">{label}</span>
    </div>
  );
}
