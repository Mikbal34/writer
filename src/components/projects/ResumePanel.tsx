"use client";

/**
 * Right rail for the My Books page. Shows where the user last left off
 * (the most recently updated project + a "Buradan devam et" deep link),
 * plus a light activity strip. Per-paragraph snippet content isn't
 * stored yet, so the panel falls back to project title + chapter tally.
 */

import Link from "next/link";
import { Feather } from "lucide-react";

export interface ResumePanelProject {
  id: string;
  title: string;
  /** Sub-text — usually "Bölüm 3 · 4.2 başlık" or the most-recent
   *  chapter title. The page composes this. */
  context: string;
  /** Optional truncated paragraph from the last-edited subsection.
   *  When set, it replaces the project-title placeholder in the card. */
  preview?: string | null;
  totalWords: number;
  lastEdit: string;
}

export interface WeeklyStreakDay {
  label: string;
  intensity: number;
  date: string;
}

interface ResumePanelProps {
  resume: ResumePanelProject | null;
  /** Aggregated per-week metrics. All optional — rendered only if set. */
  weeklyStats?: {
    wordsWritten?: number;
    activeDays?: { done: number; total: number };
    longestSessionMins?: number;
    assistantCalls?: number;
    streakDays?: WeeklyStreakDay[];
  } | null;
}

export default function ResumePanel({ resume, weeklyStats }: ResumePanelProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pt-5 pb-3.5 border-b border-sandy/60">
        <div className="font-ui text-[10px] uppercase tracking-[0.16em] text-forest mb-1">
          Kaldığın yer
        </div>
        <h3 className="font-display italic text-[18px] font-semibold leading-tight text-ink">
          Yazmaya devam et
        </h3>
      </div>

      {/* Snippet card */}
      {resume ? (
        <div className="px-4 pt-3.5">
          <div className="rounded-lg border border-sandy/60 bg-panel p-3.5">
            <div className="font-mono text-[10px] text-ink-muted mb-1.5 truncate">
              {resume.context}
            </div>
            {resume.preview ? (
              <div className="font-display italic text-[13.5px] leading-relaxed text-ink line-clamp-3">
                &ldquo;{resume.preview}&rdquo;
                <span
                  aria-hidden
                  className="inline-block w-[1.5px] h-4 align-middle ml-0.5 bg-forest animate-pulse"
                />
              </div>
            ) : (
              <div className="font-display italic text-[13.5px] leading-relaxed text-ink-light line-clamp-3">
                {resume.title}
              </div>
            )}
            <div className="mt-2.5 flex items-center gap-2 font-ui text-[11px] text-ink-muted">
              <span>{resume.totalWords.toLocaleString("tr-TR")} kelime</span>
              <span className="h-[3px] w-[3px] rounded-full bg-ink-muted" />
              <span>{resume.lastEdit}</span>
            </div>
          </div>
          <Link
            href={`/projects/${resume.id}`}
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-md bg-gold px-3 py-2 font-ui text-xs font-semibold text-white hover:bg-gold-hover transition-colors"
          >
            <Feather className="h-3.5 w-3.5" />
            Buradan devam et
          </Link>
        </div>
      ) : (
        <div className="px-5 py-6 text-center font-display italic text-[13px] text-ink-muted">
          Henüz bir kitaba başlamadın.
        </div>
      )}

      {/* Weekly activity */}
      {weeklyStats && (
        <>
          <div className="px-5 pt-5 pb-2">
            <div className="font-ui text-[10px] uppercase tracking-[0.16em] text-forest">
              Bu hafta
            </div>
          </div>
          <div className="px-5">
            {weeklyStats.wordsWritten !== undefined && (
              <ActivityRow
                label="Toplam yazılan"
                value={weeklyStats.wordsWritten.toLocaleString("tr-TR")}
                unit="kelime"
              />
            )}
            {weeklyStats.activeDays && (
              <ActivityRow
                label="Aktif gün"
                value={`${weeklyStats.activeDays.done}/${weeklyStats.activeDays.total}`}
              />
            )}
            {weeklyStats.longestSessionMins !== undefined && (
              <ActivityRow
                label="En uzun seri"
                value={String(weeklyStats.longestSessionMins)}
                unit="dk"
              />
            )}
            {weeklyStats.assistantCalls !== undefined && (
              <ActivityRow
                label="Yardımcı çağrısı"
                value={String(weeklyStats.assistantCalls)}
                unit="kez"
              />
            )}
          </div>
        </>
      )}

      {/* Writing streak — real, from WritingSession counts. Intensities
          normalise per-day session count against the busiest day in the
          window so the strip stays legible regardless of volume. */}
      {weeklyStats?.streakDays && weeklyStats.streakDays.length > 0 && (
        <div className="px-5 pt-5 pb-5 mt-auto">
          <div className="font-ui text-[10px] uppercase tracking-[0.16em] text-forest mb-2.5">
            Yazma serisi
          </div>
          <StreakBars days={weeklyStats.streakDays} />
          <div className="mt-2 font-display italic text-[11px] text-ink-muted">
            {streakTagline(weeklyStats.streakDays)}
          </div>
        </div>
      )}
    </div>
  );
}

function StreakBars({ days }: { days: WeeklyStreakDay[] }) {
  const max = Math.max(1, ...days.map((d) => d.intensity));
  const todayKey = new Date().toISOString().slice(0, 10);
  return (
    <div className="flex gap-1">
      {days.map((d, i) => {
        const norm = d.intensity / max;
        const isToday = d.date === todayKey;
        return (
          <div
            key={`${d.date}-${i}`}
            title={`${d.date} · ${d.intensity} oturum`}
            className="flex h-9 flex-1 items-end justify-center rounded-sm pb-1 font-ui text-[9px] font-semibold"
            style={{
              background: `rgba(58,82,56,${0.12 + norm * 0.7})`,
              color:
                isToday
                  ? "var(--color-gold-soft)"
                  : "rgba(255,255,255,0.7)",
              outline: isToday ? "1px solid var(--color-gold)" : "none",
            }}
          >
            {d.label}
          </div>
        );
      })}
    </div>
  );
}

function streakTagline(days: WeeklyStreakDay[]): string {
  const totalSessions = days.reduce((acc, d) => acc + d.intensity, 0);
  const todayKey = new Date().toISOString().slice(0, 10);
  const today = days.find((d) => d.date === todayKey);
  if (totalSessions === 0) return "Bu hafta yazıma başlamadın.";
  if (today && today.intensity > 0)
    return `Bugün ${today.intensity} oturum — devam et.`;
  return "Bugün henüz yazmadın — sıra sende.";
}

function ActivityRow({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="flex items-baseline justify-between border-b border-sandy/60 py-1.5 font-ui text-[12.5px] text-ink-light">
      <span>{label}</span>
      <span>
        <span className="font-display text-[16px] font-semibold text-ink tabular-nums">
          {value}
        </span>
        {unit && (
          <span className="ml-1 font-ui text-[11px] text-ink-muted">{unit}</span>
        )}
      </span>
    </div>
  );
}
