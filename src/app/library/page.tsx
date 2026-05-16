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
  MessageSquare,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import LibraryEntryForm from "@/components/library/LibraryEntryForm";
import BibtexImportDialog from "@/components/library/BibtexImportDialog";
import ZoteroSettingsCard from "@/components/library/ZoteroSettingsCard";
import PdfDropZone from "@/components/library/PdfDropZone";
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

  // Selected folder's display name (for hero h1 + breadcrumb).
  const [selectionLabel, setSelectionLabel] = useState<string>("Tüm Kütüphane");

  // Dialogs
  const [showEntryDialog, setShowEntryDialog] = useState(false);
  const [editingEntry, setEditingEntry] = useState<LibraryEntryRow | null>(null);
  const [showBibtexDialog, setShowBibtexDialog] = useState(false);
  const [showZoteroPanel, setShowZoteroPanel] = useState(false);

  const fetchEntries = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!opts.silent) setIsLoading(true);
      try {
        const params = new URLSearchParams({ page: String(page), limit: "200" });
        if (search) params.set("search", search);
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
    [page, search, selection],
  );

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

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
  // hit the collections endpoint once and cache the result by id.
  const [collectionLabelById, setCollectionLabelById] = useState<Record<string, string>>({});
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
  }, [sidebarKey]);

  useEffect(() => {
    if (selection.kind === "all") setSelectionLabel("Tüm Kütüphane");
    else if (selection.kind === "collection") {
      setSelectionLabel(collectionLabelById[selection.collectionId] ?? "Klasör");
    } else if (selection.kind === "tag") {
      setSelectionLabel("Etiket");
    }
  }, [selection, collectionLabelById]);

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

  // Whole-library ask: routes to /library/ask preserving any active
  // collection/tag scope so the chat opens already-narrowed.
  function askEntireScope() {
    if (selection.kind === "collection") {
      router.push(`/library/ask?collectionId=${selection.collectionId}`);
    } else if (selection.kind === "tag") {
      router.push(`/library/ask?tagId=${selection.tagId}`);
    } else {
      router.push("/library/ask");
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
    <WorkspaceShell>
      <div className="flex flex-1 min-h-0 h-[calc(100vh-3.5rem)]">
        {/* === MAIN SCROLLABLE PANEL === */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-6 py-6 space-y-5">
            {/* Hero — eyebrow, H1, sort/import/add */}
            <header className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 font-ui text-[10px] uppercase tracking-widest text-ink-light mb-1">
                  <Library className="h-3 w-3" />
                  Kütüphane · {total} kaynak
                </div>
                <h1 className="font-display text-2xl font-semibold text-ink leading-tight">
                  {selectionLabel}
                </h1>
                <p className="font-body text-sm text-ink-light mt-1 max-w-2xl">
                  {subtitle}
                </p>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={askEntireScope}
                  className="flex items-center gap-1.5 font-ui text-[11px] px-2.5 py-1.5 rounded-sm border border-sandy bg-page/70 text-ink-light hover:bg-page transition-colors"
                  title="Bu kapsama sor"
                >
                  <MessageSquare className="h-3 w-3" />
                  {selection.kind === "all"
                    ? "Kütüphaneye sor"
                    : "Bu kapsama sor"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowBibtexDialog(true)}
                  className="flex items-center gap-1.5 font-ui text-[11px] px-2.5 py-1.5 rounded-sm border border-sandy bg-page/70 text-ink-light hover:bg-page transition-colors"
                >
                  <FileUp className="h-3 w-3" />
                  BibTeX
                </button>
                <button
                  type="button"
                  onClick={() => setShowZoteroPanel(!showZoteroPanel)}
                  className="font-ui text-[11px] px-2.5 py-1.5 rounded-sm border border-sandy bg-page/70 text-ink-light hover:bg-page transition-colors"
                >
                  Zotero
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingEntry(null);
                    setShowEntryDialog(true);
                  }}
                  className="flex items-center gap-1.5 font-ui text-[11px] px-2.5 py-1.5 rounded-sm bg-forest text-page hover:bg-forest/90 transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  Kaynak ekle
                </button>
              </div>
            </header>

            {/* Drop zone + search row */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[260px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-light" />
                <input
                  type="text"
                  placeholder="Yazar veya başlıkta ara..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="w-full pl-10 pr-3 py-2 rounded-sm border border-sandy/60 bg-page font-body text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-gold/50 transition-colors"
                />
              </div>
              {/* Inline drop affordance, smaller than the old hero
                  panel; main "+ Kaynak ekle" button is the primary CTA. */}
              <details className="rounded-sm border border-sandy/60 bg-page px-3 py-2 cursor-pointer">
                <summary className="font-ui text-xs text-ink-light list-none flex items-center gap-1.5">
                  <FileUp className="h-3 w-3" />
                  PDF sürükle
                </summary>
                <div className="pt-2">
                  <PdfDropZone onUploaded={fetchEntries} />
                </div>
              </details>
            </div>

            {/* Folder chips row */}
            <FolderChips
              selection={selection}
              onSelectionChange={setSelection}
              refreshKey={sidebarKey}
              totalEntries={total}
            />

            <VolumeHintBanner entries={entries} onChanged={fetchEntries} />

            {/* Decade shelves */}
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

      {/* Entry Form Dialog */}
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
