"use client";

/**
 * Library — V3 layout (decade shelf + folder chips).
 *
 * Layout structure:
 *
 *   ┌──── global sidebar (WorkspaceShell) ────┬──── main scroll panel ────┬──── detail (380px, conditional) ────┐
 *   │  My Books / Library / ... / Account     │  Hero (title + sort)      │  EntryDetailHeader + tabs           │
 *   │                                          │  Drop zone + search       │                                     │
 *   │                                          │  Folder chips (+ create)  │                                     │
 *   │                                          │  Decade-grouped list      │                                     │
 *   └──────────────────────────────────────────┴───────────────────────────┴─────────────────────────────────────┘
 *
 * The old 280-px inner CollectionsSidebar is gone — its responsibilities
 * are split between FolderChips (selection + drag target + inline
 * create/rename/delete) and a Phase-2 ManageCollectionsDialog (deep
 * hierarchy / drag-to-reorder).
 *
 * Detail panel opens on row click; ESC or its own × closes it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Library,
  Plus,
  FileUp,
  Search,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  ArrowDownUp,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import LibraryEntryForm from "@/components/library/LibraryEntryForm";
import BibtexImportDialog from "@/components/library/BibtexImportDialog";
import { AddSourceDialog } from "@/components/library/AddSourceDialog";
import { ProcessingBanner } from "@/components/library/ProcessingBanner";
import ZoteroSettingsCard from "@/components/library/ZoteroSettingsCard";
import VolumeHintBanner from "@/components/library/VolumeHintBanner";
import FolderChips, {
  type LibrarySelection,
} from "@/components/library/FolderChips";
import DecadeShelfList from "@/components/library/DecadeShelfList";
import EntryDetailPanel from "@/components/library/EntryDetailPanel";
import type { LibraryEntryRow } from "@/components/library/LibraryEntryTable";
import WorkspaceShell from "@/components/shared/WorkspaceShell";

export default function LibraryPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<LibraryEntryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  // Sidebar/chip state
  const [selection, setSelection] = useState<LibrarySelection>({ kind: "all" });
  const [sidebarKey, setSidebarKey] = useState(0);

  // Right panel state
  const [selectedEntry, setSelectedEntry] = useState<LibraryEntryRow | null>(null);

  // User-level stats (filled by /api/library/stats so the hero
  // numbers don't shift when the user paginates). Refreshed in tandem
  // with entries via the same sidebarKey + fetchEntries cycle.
  const [stats, setStats] = useState<{
    total: number;
    booksAndArticles: number;
    notedSources: number;
    highlightsTotal: number;
  } | null>(null);

  // Sort state — mirrors the API's accepted keys.
  type SortKey =
    | "updated_desc"
    | "year_desc"
    | "year_asc"
    | "title_asc"
    | "author_asc";
  const [sort, setSort] = useState<SortKey>("updated_desc");
  const SORT_LABELS: Record<SortKey, string> = {
    updated_desc: "Son düzenleme",
    year_desc: "Yıl ↓ (yeni)",
    year_asc: "Yıl ↑ (eski)",
    title_asc: "Başlık (A→Z)",
    author_asc: "Yazar (A→Z)",
  };

  // Selected folder's display name (for hero h1 + breadcrumb).
  const [selectionLabel, setSelectionLabel] = useState<string>("Tüm Kütüphane");

  // Dialogs
  const [showEntryDialog, setShowEntryDialog] = useState(false);
  const [showAddSource, setShowAddSource] = useState(false);
  // Bumped on every upload to force an immediate ProcessingBanner refetch
  // (vs waiting up to 20s for the next poll).
  const [bannerRefresh, setBannerRefresh] = useState(0);
  const [editingEntry, setEditingEntry] = useState<LibraryEntryRow | null>(null);
  const [showBibtexDialog, setShowBibtexDialog] = useState(false);
  const [showZoteroPanel, setShowZoteroPanel] = useState(false);

  const fetchEntries = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!opts.silent) setIsLoading(true);
      try {
        const params = new URLSearchParams({ page: String(page), limit: "200" });
        if (search) params.set("search", search);
        if (sort) params.set("sort", sort);
        if (selection.kind === "collection") {
          params.set("collectionId", selection.collectionId);
        } else if (selection.kind === "tag") {
          params.set("tagId", selection.tagId);
        }

        const res = await fetch(`/api/library?${params}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        setEntries(data.entries ?? []);
        setTotal(data.total ?? 0);
      } catch {
        if (!opts.silent) toast.error("Kütüphane yüklenemedi");
      } finally {
        if (!opts.silent) setIsLoading(false);
      }
    },
    [page, search, sort, selection],
  );

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // Pull the user-level stats once on mount and re-pull after any
  // mutation that the page triggers (sidebar refresh ticks the key,
  // which the chips also use to invalidate their own state).
  useEffect(() => {
    fetch("/api/library/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setStats({
          total: data.total ?? 0,
          booksAndArticles: data.booksAndArticles ?? 0,
          notedSources: data.notedSources ?? 0,
          highlightsTotal: data.highlightsTotal ?? 0,
        });
      })
      .catch(() => undefined);
  }, [sidebarKey]);

  // Auto-refresh while any entry is still processing.
  useEffect(() => {
    const IN_PROGRESS = new Set(["pending", "downloading", "extracting", "embedding"]);
    const anyInProgress = entries.some((e) => IN_PROGRESS.has(e.pdfStatus ?? ""));
    if (!anyInProgress) return;
    const timer = setInterval(() => {
      fetchEntries({ silent: true });
    }, 3000);
    return () => clearInterval(timer);
  }, [entries, fetchEntries]);

  // Debounce search
  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Reset to page 1 whenever the sidebar selection changes.
  useEffect(() => {
    setPage(1);
  }, [selection]);

  // Resolve the active selection's display label. For collections we
  // hit the collections endpoint once and cache the result by id; the
  // tags endpoint feeds the toolbar chip strip + label resolution.
  const [collectionLabelById, setCollectionLabelById] = useState<Record<string, string>>({});
  const [tags, setTags] = useState<Array<{ id: string; name: string; count: number }>>([]);
  useEffect(() => {
    fetch("/api/library/collections")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.collections) return;
        const map: Record<string, string> = {};
        for (const c of data.collections as Array<{ id: string; name: string }>) {
          map[c.id] = c.name;
        }
        setCollectionLabelById(map);
      })
      .catch(() => undefined);
    fetch("/api/library/tags")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!Array.isArray(data)) return;
        setTags(
          (
            data as Array<{
              id: string;
              name: string;
              _count: { entries: number };
            }>
          ).map((t) => ({ id: t.id, name: t.name, count: t._count.entries })),
        );
      })
      .catch(() => undefined);
  }, [sidebarKey]);

  const tagLabelById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of tags) m[t.id] = t.name;
    return m;
  }, [tags]);

  useEffect(() => {
    if (selection.kind === "all") setSelectionLabel("Tüm Kütüphane");
    else if (selection.kind === "collection") {
      setSelectionLabel(collectionLabelById[selection.collectionId] ?? "Klasör");
    } else if (selection.kind === "tag") {
      setSelectionLabel(tagLabelById[selection.tagId] ?? "Etiket");
    }
  }, [selection, collectionLabelById, tagLabelById]);

  function handleEdit(entry: LibraryEntryRow) {
    setEditingEntry(entry);
    setShowEntryDialog(true);
  }

  function handleSelect(entry: LibraryEntryRow) {
    setSelectedEntry(entry);
  }

  async function handleDelete(id: string) {
    if (!confirm("Bu kaynak silinsin mi?")) return;
    try {
      const res = await fetch(`/api/library/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Kaynak silindi");
      if (selectedEntry?.id === id) setSelectedEntry(null);
      fetchEntries();
    } catch {
      toast.error("Silinemedi");
    }
  }

  function handleFormSave() {
    setShowEntryDialog(false);
    setEditingEntry(null);
    fetchEntries();
  }

  // When entries reload, sync the open detail panel's row so badges
  // (note count, collection count, pdf status) refresh too.
  useEffect(() => {
    if (!selectedEntry) return;
    const fresh = entries.find((e) => e.id === selectedEntry.id);
    if (fresh) setSelectedEntry(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  // Whole-library ask: routes to /library/chat preserving any active
  // collection/tag scope so the chat opens already-narrowed.
  function askEntireScope() {
    if (selection.kind === "collection") {
      router.push(`/library/chat?collectionId=${selection.collectionId}`);
    } else if (selection.kind === "tag") {
      router.push(`/library/chat?tagId=${selection.tagId}`);
    } else {
      router.push("/library/chat");
    }
  }

  const totalPages = Math.ceil(total / 200);

  // Derived: subtitle line under the H1. Tells the user what scope
  // they're looking at without forcing them to read the chip row.
  const subtitle = useMemo(() => {
    if (selection.kind === "all") {
      return "Eklediğin tüm kitaplar, makaleler ve tezler. Bir kitaba tıkla — notların, alıntıların ve PDF açılır.";
    }
    if (selection.kind === "collection") {
      return `${selectionLabel} klasöründeki kaynaklar.`;
    }
    return "Etiket altındaki kaynaklar.";
  }, [selection, selectionLabel]);

  return (
    <WorkspaceShell fullHeight bareMain>
      {/* Inner shelf + detail panel sit directly inside the workspace
          gutter (no extra padding) so they height-match the rail. The
          14px gap between them is the only inter-card separation. */}
      <div className="flex flex-1 min-h-0 gap-3.5">
        {/* === MAIN SCROLLABLE PANEL === */}
        <div className="flex-1 min-w-0 overflow-y-auto rounded-2xl bg-elevated">
          {/* === Dark forest hero band (v3.3 match) === */}
          <section
            className="relative overflow-hidden px-11 pt-8 pb-7 text-gold-soft"
            style={{
              background:
                "linear-gradient(135deg, var(--color-forest-deep) 0%, #1a2818 100%)",
            }}
          >
            {/* Decorative ornament */}
            <div
              aria-hidden
              className="pointer-events-none absolute right-8 top-3 select-none"
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                fontSize: 150,
                lineHeight: 1,
                color: "var(--color-gold-soft)",
                opacity: 0.14,
              }}
            >
              ℘
            </div>

            <div className="font-ui inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-gold-soft/65 mb-1.5">
              <Library className="h-3 w-3" />
              {selection.kind === "all"
                ? "Arşivin"
                : selection.kind === "collection"
                  ? "Klasör"
                  : "Etiket"}
            </div>
            <h1 className="font-display italic font-medium text-[42px] leading-none tracking-tight text-white">
              {selectionLabel}
            </h1>
            <p className="mt-2.5 font-body text-sm leading-relaxed text-gold-soft/85 max-w-[580px]">
              {subtitle}
            </p>

            {/* Stats + action buttons — user-level from /api/library/stats
                so the numbers stay correct when the entry list paginates. */}
            <div className="mt-6 flex items-end gap-9 flex-wrap">
              <LibStat num={String(stats?.total ?? total)} label="kaynak" />
              <LibStatDivider />
              <LibStat
                num={String(stats?.booksAndArticles ?? "—")}
                label="kitap & makale"
              />
              <LibStatDivider />
              <LibStat
                num={String(stats?.notedSources ?? "—")}
                label="notlu"
              />
              <LibStatDivider />
              <LibStat
                num={String(stats?.highlightsTotal ?? "—")}
                label="alıntı"
              />
              <span className="flex-1" />
              <div className="self-end flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowBibtexDialog(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md font-ui text-xs text-gold-soft hover:bg-white/10 transition-colors"
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(232,212,154,0.25)",
                  }}
                >
                  <FileUp className="h-3.5 w-3.5" />
                  BibTeX
                </button>
                <button
                  type="button"
                  onClick={() => setShowZoteroPanel(!showZoteroPanel)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md font-ui text-xs text-gold-soft hover:bg-white/10 transition-colors"
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(232,212,154,0.25)",
                  }}
                >
                  Zotero
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddSource(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-gold text-white font-ui text-[13px] font-semibold hover:bg-gold-hover transition-colors shadow-[0_4px_12px_rgba(0,0,0,0.25)]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Kaynak ekle
                </button>
              </div>
            </div>
          </section>


          <ProcessingBanner refreshKey={bannerRefresh} />

          {/* === Toolbar: search with embedded ask CTA + folder chips + sort === */}
          <div className="flex items-center gap-2.5 px-9 py-3 border-b border-sandy/60 bg-panel flex-wrap">
            <div className="relative flex-1 min-w-[280px] max-w-[460px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-muted pointer-events-none" />
              <input
                type="text"
                placeholder="Yazar, başlık veya alıntıda ara..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full pl-9 pr-[155px] py-2 rounded-lg border border-sandy bg-elevated font-body text-[13px] text-ink placeholder:text-ink-muted focus:outline-none focus:border-gold transition-colors"
              />
              <button
                type="button"
                onClick={askEntireScope}
                className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-forest-deep text-gold-soft font-ui text-[11.5px] font-medium hover:bg-forest transition-colors"
                title="Bu kapsama sor"
              >
                <Sparkles className="h-3 w-3" />
                {selection.kind === "all"
                  ? "Kütüphaneye sor"
                  : "Bu kapsama sor"}
              </button>
            </div>
            <span className="w-px h-4 bg-sandy/70 hidden lg:block" />
            {/* Folder chips inline. FolderChips renders the active pill +
                all top-level folder chips + create input — for v3.3 we
                surface them in the toolbar instead of below the hero. */}
            <div className="flex-1 min-w-0">
              <FolderChips
                selection={selection}
                onSelectionChange={setSelection}
                refreshKey={sidebarKey}
                totalEntries={total}
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-sm text-ink-light hover:text-ink hover:bg-elevated transition-colors font-ui text-xs"
                    title="Sıralama"
                  >
                    <ArrowDownUp className="h-3 w-3" />
                    {SORT_LABELS[sort]}
                  </button>
                }
              />
              <DropdownMenuContent align="end">
                {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                  <DropdownMenuItem
                    key={key}
                    onClick={() => {
                      setSort(key);
                      setPage(1);
                    }}
                  >
                    {sort === key && <ArrowDownUp className="h-3.5 w-3.5 text-gold" />}
                    {SORT_LABELS[key]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Tag chip strip — surfaces user tags so the tag scope flow
              has a real entry point (not just deep links). */}
          {tags.length > 0 && (
            <div className="flex items-center gap-1.5 px-9 py-2 border-b border-sandy/40 bg-panel/60 flex-wrap font-ui text-xs">
              <span className="text-[10px] uppercase tracking-[0.16em] text-ink-muted mr-1">
                Etiketler
              </span>
              {tags.map((t) => {
                const active =
                  selection.kind === "tag" && selection.tagId === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() =>
                      setSelection(
                        active
                          ? { kind: "all" }
                          : { kind: "tag", tagId: t.id },
                      )
                    }
                    className={
                      active
                        ? "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-gold bg-gold/15 text-gold-dark"
                        : "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-sandy bg-elevated text-ink-light hover:bg-panel transition-colors"
                    }
                  >
                    <span>#{t.name}</span>
                    <span className="opacity-65 tabular-nums text-[11px]">
                      {t.count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* === Body: shelf list === */}
          <div className="px-9 pt-4 pb-9">
            <div className="mt-1">
              <VolumeHintBanner entries={entries} onChanged={fetchEntries} />
            </div>

            {/* Decade shelves */}
            <div className="mt-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-12 gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-forest" />
                <span className="font-body text-sm text-ink-light">
                  Yükleniyor...
                </span>
              </div>
            ) : entries.length === 0 ? (
              <div className="rounded-sm border border-dashed border-sandy bg-page/40 px-6 py-12 text-center">
                <p className="font-body text-sm text-ink-light mb-2">
                  Bu kapsamda henüz kaynak yok.
                </p>
                <p className="font-ui text-xs text-ink-muted">
                  Üstteki <strong>+ Kaynak ekle</strong> ile başla, ya da PDF
                  sürükle.
                </p>
              </div>
            ) : (
              <DecadeShelfList
                entries={entries}
                onSelect={handleSelect}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onPdfAttached={() => fetchEntries()}
              />
            )}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-5">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="flex items-center gap-1 font-ui text-xs px-3 py-1.5 rounded-sm border border-sandy bg-page/80 text-ink-light hover:bg-page disabled:opacity-40 transition-colors"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Önceki
                </button>
                <span className="font-ui text-xs text-ink-light">
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="flex items-center gap-1 font-ui text-xs px-3 py-1.5 rounded-sm border border-sandy bg-page/80 text-ink-light hover:bg-page disabled:opacity-40 transition-colors"
                >
                  Sonraki
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* === RIGHT — Detail panel === */}
        {selectedEntry && (
          <EntryDetailPanel
            entry={selectedEntry}
            onEdit={() => handleEdit(selectedEntry)}
            onClose={() => setSelectedEntry(null)}
            onMutate={() => {
              fetchEntries({ silent: true });
              setSidebarKey((k) => k + 1);
            }}
          />
        )}
      </div>

      {/* New unified add-source modal — 2 tabs (Dosya & Künye, ISBN/DOI) */}
      <AddSourceDialog
        open={showAddSource}
        onOpenChange={setShowAddSource}
        onAdded={() => { fetchEntries(); setBannerRefresh((n) => n + 1) }}
      />

      {/* Entry Form Dialog (edit-existing — kept until new modal also covers editing) */}
      <Dialog
        open={showEntryDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowEntryDialog(false);
            setEditingEntry(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-page border-sandy">
          <DialogHeader>
            <DialogTitle className="font-display text-ink">
              {editingEntry ? "Kaynağı düzenle" : "Yeni kaynak ekle"}
            </DialogTitle>
          </DialogHeader>
          <div className="h-px bg-sandy/50 my-3" />
          <LibraryEntryForm
            entryId={editingEntry?.id}
            initialData={
              editingEntry
                ? {
                    entryType: editingEntry.entryType as "kitap",
                    authorSurname: editingEntry.authorSurname,
                    authorName: editingEntry.authorName ?? "",
                    title: editingEntry.title,
                    year: editingEntry.year ?? "",
                  }
                : undefined
            }
            onSave={handleFormSave}
            onCancel={() => {
              setShowEntryDialog(false);
              setEditingEntry(null);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* BibTeX import */}
      <BibtexImportDialog
        open={showBibtexDialog}
        onOpenChange={(open) => setShowBibtexDialog(open)}
        onImported={() => fetchEntries()}
      />

      {/* Zotero Dialog */}
      <Dialog open={showZoteroPanel} onOpenChange={setShowZoteroPanel}>
        <DialogContent className="max-w-sm bg-page border-sandy">
          <DialogHeader>
            <DialogTitle className="font-display text-ink">
              Zotero
            </DialogTitle>
          </DialogHeader>
          <div className="h-px bg-sandy/50 my-3" />
          <ZoteroSettingsCard onSynced={fetchEntries} />
        </DialogContent>
      </Dialog>
    </WorkspaceShell>
  );
}

// ── v3.3 hero stats helpers ──────────────────────────────────────

function LibStat({ num, label }: { num: string; label: string }) {
  return (
    <div>
      <div className="font-display font-medium text-[36px] leading-none tracking-tight text-white">
        {num}
      </div>
      <div className="mt-1 font-ui text-[11px] uppercase tracking-[0.1em] text-gold-soft/70">
        {label}
      </div>
    </div>
  );
}

function LibStatDivider() {
  return (
    <span
      aria-hidden
      className="w-px h-9 self-center"
      style={{ background: "rgba(232,212,154,0.25)" }}
    />
  );
}
