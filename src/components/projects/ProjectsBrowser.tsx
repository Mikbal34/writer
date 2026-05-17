"use client";

/**
 * Client-side toolbar + grid for the Kitaplarım (My Books) home page.
 *
 * - Search filters cards by title (case-insensitive, also matches tagline).
 * - Status chips (Tümü / Aktif / Tamamlanan) flip the active section.
 * - The dashed "Yeni bir kitap başlat" card opens the shared
 *   NewProjectDialog via the trigger ref the dialog wires up itself.
 */

import { useMemo, useState, useCallback } from "react";
import { Search, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import ProjectCard, {
  type ProjectCardData,
} from "@/components/projects/ProjectCard";

interface CardRecord {
  data: ProjectCardData;
  status: string;
}

interface ProjectsBrowserProps {
  cards: CardRecord[];
  activeCount: number;
  doneCount: number;
}

type StatusFilter = "all" | "active" | "done";

export default function ProjectsBrowser({
  cards,
  activeCount,
  doneCount,
}: ProjectsBrowserProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cards.filter((c) => {
      if (statusFilter === "active" && c.status === "completed") return false;
      if (statusFilter === "done" && c.status !== "completed") return false;
      if (!q) return true;
      const hay = [c.data.title, c.data.tagline ?? "", c.data.stage]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [cards, search, statusFilter]);

  const showActive = statusFilter !== "done";
  const showDone = statusFilter !== "active";

  const activeFiltered = useMemo(
    () => filtered.filter((c) => c.status !== "completed"),
    [filtered],
  );
  const doneFiltered = useMemo(
    () => filtered.filter((c) => c.status === "completed"),
    [filtered],
  );

  const triggerNewProjectDialog = useCallback(() => {
    // NewProjectDialog renders a hidden trigger we can click. The hero's
    // dialog button has data-new-project-trigger set in this codebase so
    // the empty-slot card defers to it instead of mounting a second
    // copy of the dialog tree.
    const btn = document.querySelector<HTMLButtonElement>(
      "[data-new-project-trigger]",
    );
    btn?.click();
  }, []);

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-9 py-3.5 border-b border-sandy/60 bg-panel">
        <div className="relative flex-1 max-w-[320px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-muted pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Kitaplarımda ara..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-sandy bg-elevated font-body text-[13px] text-ink placeholder:text-ink-muted focus:outline-none focus:border-gold transition-colors"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <ToggleChip
            label="Tümü"
            count={cards.length}
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
          />
          <ToggleChip
            label="Aktif"
            count={activeCount}
            active={statusFilter === "active"}
            onClick={() => setStatusFilter("active")}
          />
          <ToggleChip
            label="Tamamlanan"
            count={doneCount}
            active={statusFilter === "done"}
            onClick={() => setStatusFilter("done")}
          />
        </div>
        <span className="flex-1" />
        <span className="font-ui text-xs text-ink-light italic">
          Son düzenleme
        </span>
      </div>

      {/* Grid */}
      <div className="px-9 pt-7 pb-11 space-y-10">
        {showActive && activeFiltered.length > 0 && (
          <section>
            <div className="mb-4">
              <SectionHeading
                title="Devam eden çalışmalar"
                count={activeFiltered.length}
              />
            </div>
            <div
              className="grid gap-5"
              style={{
                gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
              }}
            >
              {activeFiltered.map(({ data }) => (
                <ProjectCard key={data.id} project={data} />
              ))}
              <NewProjectPlaceholder onClick={triggerNewProjectDialog} />
            </div>
          </section>
        )}

        {showDone && doneFiltered.length > 0 && (
          <section>
            <div className="mb-4">
              <SectionHeading
                title="Bitmiş çalışmalar"
                count={doneFiltered.length}
              />
            </div>
            <div
              className="grid gap-5"
              style={{
                gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
              }}
            >
              {doneFiltered.map(({ data }) => (
                <ProjectCard key={data.id} project={data} />
              ))}
            </div>
          </section>
        )}

        {filtered.length === 0 && cards.length > 0 && (
          <div className="rounded-md border border-dashed border-sandy/70 bg-panel px-4 py-8 text-center font-body italic text-sm text-ink-muted">
            {search.trim()
              ? `"${search}" için eşleşen kitap yok.`
              : "Bu filtrede kitap yok."}
          </div>
        )}
      </div>
    </>
  );
}

function ToggleChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 border font-ui text-xs transition-colors",
        active
          ? "border-forest-deep bg-forest-deep text-gold-soft font-semibold"
          : "border-sandy bg-transparent text-ink-light hover:bg-elevated",
      )}
    >
      {label}
      <span className="opacity-65 tabular-nums text-[11px]">{count}</span>
    </button>
  );
}

function SectionHeading({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-baseline gap-3 pb-2 border-b-[1.5px] border-sandy">
      <h3 className="font-display italic font-medium text-[22px] leading-none text-forest-deep">
        {title}
      </h3>
      <span className="font-ui text-xs text-ink-muted">{count} kitap</span>
    </div>
  );
}

function NewProjectPlaceholder({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hidden lg:flex aspect-[380/230] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-sandy text-ink-light hover:border-gold hover:text-ink hover:bg-panel/40 transition-colors cursor-pointer"
    >
      <Plus className="h-5 w-5" />
      <div className="font-display italic text-base">Yeni bir kitap başlat</div>
      <div className="font-ui text-[11px] text-ink-muted">
        boş taslak, kütüphaneden veya bir nottan
      </div>
    </button>
  );
}
