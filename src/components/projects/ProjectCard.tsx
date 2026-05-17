"use client";

/**
 * V6 book-project card. Matches the v6-mybooks mock:
 *
 *   ┌──────────┬─────────────────────────────────────┐
 *   │          │ stage eyebrow                       │
 *   │  COVER   │ Big serif title                     │
 *   │ 110×158  │ italic tagline                      │
 *   │          │ Bölümler ●●●○○○ 3/6                 │
 *   │          │ 12,481 kelime              63%      │
 *   │          ├─────────────────────────────────────┤
 *   │          │ son dokunuş: 2 saat önce      [Aç] │
 *   └──────────┴─────────────────────────────────────┘
 *
 * Active projects get a rotated "AKTİF" ribbon top-right; completed
 * ones get a small "TAMAMLANDI" badge.
 */

import Link from "next/link";
import {
  Eye,
  MoreHorizontal,
  Feather,
  Pencil,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import DeleteProjectButton from "./DeleteProjectButton";

export interface ProjectCardData {
  id: string;
  title: string;
  /** Display label for the current writing stage — e.g. "Taslak · Bölüm 3"
   *  or "Tamamlandı". The page derives this from `status` + chapter
   *  position so the card stays presentational. */
  stage: string;
  /** Short italic line beneath the title — usually project description
   *  or the most recent chapter title. Optional. */
  tagline?: string | null;
  chaptersDone: number;
  chaptersTotal: number;
  words: number;
  /** Target word count, used for the percentage badge. When 0 the card
   *  falls back to the project's status-based progress. */
  wordsTarget?: number | null;
  /** Pre-formatted last-edit string (e.g. "dün, 23:14"). */
  lastEdit: string;
  /** Hex colour pair driving the book cover gradient. */
  coverColor: string;
  coverAccent: string;
  /** "active" -> AKTİF ribbon. "done" -> TAMAMLANDI badge. */
  flag?: "active" | "done" | null;
  /** Volume number within a series, displayed as a small badge at the
   *  top of the cover. */
  volumeNumber?: number | null;
  /** Fallback percentage when wordsTarget isn't set (status-based). */
  fallbackPct?: number;
}

interface ProjectCardProps {
  project: ProjectCardData;
}

export default function ProjectCard({ project }: ProjectCardProps) {
  const {
    id,
    title,
    stage,
    tagline,
    chaptersDone,
    chaptersTotal,
    words,
    wordsTarget,
    lastEdit,
    coverColor,
    coverAccent,
    flag,
    volumeNumber,
    fallbackPct = 0,
  } = project;

  const pct =
    wordsTarget && wordsTarget > 0
      ? Math.min(100, Math.round((words / wordsTarget) * 100))
      : fallbackPct;
  const isActive = flag === "active";
  const isDone = flag === "done";

  return (
    <article
      className={cn(
        "relative flex gap-4 rounded-xl p-4 transition-shadow",
        "bg-panel border",
        isActive ? "border-gold shadow-md shadow-gold/15" : "border-sandy/60",
        "overflow-hidden",
      )}
    >
      {/* Kebab — sits outside the link wrapper so clicks don't navigate */}
      <div className="absolute top-2 right-2 z-20">
        <DeleteProjectButton projectId={id} projectTitle={title} variant="icon" />
      </div>

      {/* Ribbons / status badges */}
      {isActive && (
        <div
          className="absolute -right-7 top-3 z-10 rotate-[35deg] px-7 py-0.5 font-ui text-[9px] font-semibold uppercase tracking-widest text-white pointer-events-none"
          style={{ background: "var(--color-gold)" }}
        >
          Aktif
        </div>
      )}
      {isDone && (
        <div
          className="absolute right-12 top-3 z-10 rounded-sm px-2 py-0.5 font-ui text-[9px] font-semibold uppercase tracking-wider text-white pointer-events-none"
          style={{ background: "var(--color-forest)" }}
        >
          Tamamlandı
        </div>
      )}

      <Link
        href={`/projects/${id}`}
        className="absolute inset-0 z-0"
        aria-label={`${title} projesine git`}
      />

      {/* Book cover */}
      <div
        className="relative z-10 flex shrink-0 flex-col rounded-[2px_4px_4px_2px] p-3.5"
        style={{
          width: 110,
          height: 158,
          background: `linear-gradient(135deg, ${coverColor}, ${coverAccent})`,
          boxShadow: [
            "0 8px 18px rgba(0,0,0,0.22)",
            "inset -4px 0 0 rgba(0,0,0,0.18)",
            "inset 4px 0 0 rgba(255,255,255,0.08)",
            "inset 0 1px 0 rgba(255,255,255,0.10)",
          ].join(", "),
        }}
      >
        {volumeNumber !== null && volumeNumber !== undefined && (
          <div
            className="absolute left-1.5 top-1.5 rounded-sm px-1 py-0.5 font-ui text-[9px] font-medium"
            style={{
              backgroundColor: "rgba(232,212,154,0.85)",
              color: "#1A0F05",
            }}
          >
            Cilt {volumeNumber}
          </div>
        )}
        <div
          className="mb-2 h-px"
          style={{ background: "rgba(255,255,255,0.25)" }}
        />
        <div
          className="flex-1 font-display text-[13px] italic font-semibold leading-snug"
          style={{ color: "rgba(255,255,255,0.92)" }}
        >
          {title}
        </div>
        <div
          className="font-ui text-[8px] uppercase tracking-[0.14em] mt-2"
          style={{ color: "rgba(255,255,255,0.55)" }}
        >
          quilpen
        </div>
        <div
          className="mt-1.5 h-px"
          style={{ background: "rgba(255,255,255,0.25)" }}
        />
      </div>

      {/* Right side meta */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <div
          className="font-ui text-[10px] uppercase tracking-[0.14em]"
          style={{ color: coverAccent }}
        >
          {stage}
        </div>
        <h3 className="mt-1 font-display text-[20px] font-semibold leading-tight text-ink line-clamp-2">
          {title}
        </h3>
        {tagline && (
          <p className="mt-1.5 font-display italic text-[12px] leading-snug text-ink-light line-clamp-2">
            {tagline}
          </p>
        )}

        {/* Chapter progress dots */}
        <div className="mt-3 flex items-center gap-2">
          <span className="font-display italic text-[11px] text-ink-muted shrink-0">
            Bölümler
          </span>
          <div className="flex flex-1 gap-1">
            {Array.from({ length: chaptersTotal || 1 }).map((_, i) => (
              <div
                key={i}
                className="h-1.5 flex-1 rounded-sm"
                style={{
                  background: i < chaptersDone ? coverAccent : "var(--color-sandy-soft)",
                }}
              />
            ))}
          </div>
          <span className="font-mono text-[11px] text-ink tabular-nums shrink-0">
            {chaptersDone}/{chaptersTotal}
          </span>
        </div>

        {/* Words + % */}
        <div className="mt-2 flex items-baseline gap-2">
          <span className="font-display text-[22px] font-semibold text-ink leading-none">
            {words.toLocaleString("tr-TR")}
          </span>
          <span className="font-ui text-xs text-ink-muted">kelime</span>
          <span className="ml-auto font-ui text-[11px] font-semibold tabular-nums" style={{ color: pct === 100 ? "var(--color-forest)" : coverAccent }}>
            {pct}%
          </span>
        </div>

        {/* Footer */}
        <div className="mt-auto pt-3 flex items-center gap-1.5 border-t border-sandy/60 font-ui text-[11px] text-ink-muted">
          <Feather className="h-3 w-3" />
          <span className="truncate">son dokunuş: {lastEdit}</span>
          <Link
            href={`/projects/${id}`}
            className="relative z-20 ml-auto inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-ink-light hover:bg-elevated hover:text-ink transition-colors"
          >
            <Eye className="h-3 w-3" />
            <span>Aç</span>
          </Link>
          {/* Kebab menu — sits above the card-wide click overlay via z-20
              so the dropdown trigger captures the click first. */}
          <div
            className="relative z-20"
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    title="Daha fazla"
                    className="inline-flex items-center justify-center h-6 w-6 rounded-sm text-ink-light hover:bg-elevated hover:text-ink transition-colors"
                  >
                    <MoreHorizontal className="h-3 w-3" />
                  </button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  render={
                    <Link
                      href={`/projects/${id}`}
                      className="cursor-pointer"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Projeye git
                    </Link>
                  }
                />
                <DropdownMenuItem
                  render={
                    <Link
                      href={`/projects/${id}/settings/academic`}
                      className="cursor-pointer"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Künyeyi düzenle
                    </Link>
                  }
                />
                <DropdownMenuItem
                  render={
                    <Link
                      href={`/projects/${id}/style`}
                      className="cursor-pointer"
                    >
                      <Settings className="h-3.5 w-3.5" />
                      Stil ayarları
                    </Link>
                  }
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </article>
  );
}
