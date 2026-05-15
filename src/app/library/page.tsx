"use client";

/**
 * Library — three-pane research workbench.
 *
 *   ┌──────────┬─────────────────────────┬──────────────────┐
 *   │ Folders  │  Entry list (search /   │  Selected entry  │
 *   │ + tags   │  filter / drop / table) │  detail panel    │
 *   │ (280px)  │  (flex)                 │  (420px)         │
 *   └──────────┴─────────────────────────┴──────────────────┘
 *
 * Sidebar lets the user organise into hierarchical folders + use tags;
 * clicking a row opens the right pane with notes/highlights/PDF tabs.
 * The middle list keeps all the existing drop-zone, search, BibTeX and
 * Zotero affordances — only its layout container changed.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Library,
  Plus,
  FileUp,
  Search,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Filter,
  LayoutGrid,
  List,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import LibraryEntryTable, {
  type LibraryEntryRow,
} from "@/components/library/LibraryEntryTable";
import LibraryEntryForm from "@/components/library/LibraryEntryForm";
import BibtexImportDialog from "@/components/library/BibtexImportDialog";
import ZoteroSettingsCard from "@/components/library/ZoteroSettingsCard";
import PdfDropZone from "@/components/library/PdfDropZone";
import VolumeHintBanner from "@/components/library/VolumeHintBanner";
import CollectionsSidebar, {
  type LibrarySelection,
  type Tag as SidebarTag,
} from "@/components/library/CollectionsSidebar";
import EntryDetailPanel from "@/components/library/EntryDetailPanel";
import { FadeIn } from "@/components/shared/Animations";
import WorkspaceShell from "@/components/shared/WorkspaceShell";

const ENTRY_TYPES = [
  { value: "", label: "All" },
  { value: "kitap", label: "Book" },
  { value: "makale", label: "Article" },
  { value: "nesir", label: "Prose" },
  { value: "ceviri", label: "Translation" },
  { value: "tez", label: "Thesis" },
  { value: "ansiklopedi", label: "Encyclopedia" },
  { value: "web", label: "Web" },
];

export default function LibraryPage() {
  const [entries, setEntries] = useState<LibraryEntryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [entryTypeFilter, setEntryTypeFilter] = useState("");
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<"list" | "card">("list");

  // Sidebar state
  const [selection, setSelection] = useState<LibrarySelection>({ kind: "all" });
  const [tags, setTags] = useState<SidebarTag[]>([]);
  const [sidebarKey, setSidebarKey] = useState(0);

  // Right panel state
  const [selectedEntry, setSelectedEntry] = useState<LibraryEntryRow | null>(null);

  // Dialogs
  const [showEntryDialog, setShowEntryDialog] = useState(false);
  const [editingEntry, setEditingEntry] = useState<LibraryEntryRow | null>(null);
  const [showBibtexDialog, setShowBibtexDialog] = useState(false);
  const [showZoteroPanel, setShowZoteroPanel] = useState(false);

  const fetchEntries = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!opts.silent) setIsLoading(true);
      try {
        const params = new URLSearchParams({ page: String(page), limit: "50" });
        if (search) params.set("search", search);
        if (entryTypeFilter) params.set("entryType", entryTypeFilter);
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
        if (!opts.silent) toast.error("Failed to load library");
      } finally {
        if (!opts.silent) setIsLoading(false);
      }
    },
    [page, search, entryTypeFilter, selection],
  );

  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch("/api/library/tags");
      if (!res.ok) return;
      const data = await res.json();
      // /api/library/tags returns a plain array of LibraryTag rows
      // (with _count.entries). Normalise to the shape the sidebar
      // expects.
      const list = (Array.isArray(data) ? data : []) as Array<{
        id: string;
        name: string;
        _count?: { entries?: number };
      }>;
      setTags(
        list.map((t) => ({
          id: t.id,
          name: t.name,
          count: t._count?.entries ?? 0,
        })),
      );
    } catch {
      /* tags non-fatal */
    }
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  // Auto-refresh while any entry is still processing. Polls quietly
  // (no loading spinner flash) and stops as soon as all visible
  // entries reach a terminal state (ready / failed / none).
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

  function handleEdit(entry: LibraryEntryRow) {
    setEditingEntry(entry);
    setShowEntryDialog(true);
  }

  function handleSelect(entry: LibraryEntryRow) {
    setSelectedEntry(entry);
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this source?")) return;
    try {
      const res = await fetch(`/api/library/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Source deleted");
      if (selectedEntry?.id === id) setSelectedEntry(null);
      fetchEntries();
    } catch {
      toast.error("Delete failed");
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
  }, [entries, selectedEntry]);

  const totalPages = Math.ceil(total / 50);

  return (
    <WorkspaceShell>
      <div className="flex flex-1 min-h-0 h-[calc(100vh-3.5rem)]">
        {/* === LEFT — Folders + tags === */}
        <CollectionsSidebar
          selection={selection}
          onSelectionChange={(s) => {
            setSelection(s);
          }}
          tags={tags}
          refreshKey={sidebarKey}
        />

        {/* === MIDDLE — Entry list === */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-6 py-6">
            <FadeIn className="flex items-center justify-between gap-3 flex-wrap mb-4">
              <div className="flex items-center gap-2">
                <Library className="h-4 w-4 text-[#C9A84C]" />
                <h1 className="font-display text-lg font-semibold text-[#2D1F0E]">
                  {selection.kind === "all"
                    ? "Tüm Kütüphane"
                    : selection.kind === "collection"
                      ? "Klasör"
                      : "Etiket"}
                </h1>
                <span className="font-ui text-xs text-[#8a7a65]">
                  {total} kaynak
                </span>
              </div>

              <div className="flex gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    setEditingEntry(null);
                    setShowEntryDialog(true);
                  }}
                  className="flex items-center gap-1.5 font-ui text-[11px] px-2.5 py-1.5 rounded-sm border border-[#d4c9b5] bg-[#FAF7F0]/70 text-[#5C4A32] hover:bg-[#FAF7F0] transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  Manuel Ekle
                </button>
                <button
                  type="button"
                  onClick={() => setShowBibtexDialog(true)}
                  className="flex items-center gap-1.5 font-ui text-[11px] px-2.5 py-1.5 rounded-sm border border-[#d4c9b5] bg-[#FAF7F0]/70 text-[#5C4A32] hover:bg-[#FAF7F0] transition-colors"
                >
                  <FileUp className="h-3 w-3" />
                  BibTeX
                </button>
                <button
                  type="button"
                  onClick={() => setShowZoteroPanel(!showZoteroPanel)}
                  className="font-ui text-[11px] px-2.5 py-1.5 rounded-sm border border-[#d4c9b5] bg-[#FAF7F0]/70 text-[#5C4A32] hover:bg-[#FAF7F0] transition-colors"
                >
                  Zotero
                </button>
              </div>
            </FadeIn>

            {/* Drop zone — drag PDFs to auto-extract bibliography */}
            <PdfDropZone onUploaded={fetchEntries} />

            {/* Filter bar */}
            <div className="flex items-center gap-3 mt-4 mb-4 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#8a7a65]" />
                <input
                  type="text"
                  placeholder="Yazar veya başlıkta ara..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="w-full pl-10 pr-3 py-2 rounded-sm border border-[#d4c9b5]/60 bg-[#FAF7F0] font-body text-sm text-[#2D1F0E] placeholder:text-[#a89880] focus:outline-none focus:border-[#C9A84C]/50 transition-colors"
                />
              </div>

              <div className="flex items-center gap-2 px-3 py-2 rounded-sm border border-[#d4c9b5]/60 bg-[#FAF7F0]">
                <Filter className="h-3.5 w-3.5 text-[#8a7a65]" />
                <select
                  value={entryTypeFilter}
                  onChange={(e) => {
                    const v = e.target.value;
                    setEntryTypeFilter(v === "all" ? "" : v);
                    setPage(1);
                  }}
                  className="font-ui text-sm text-[#2D1F0E] bg-transparent focus:outline-none cursor-pointer pr-1"
                >
                  <option value="all">Tür</option>
                  {ENTRY_TYPES.filter((t) => t.value).map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center rounded-sm border border-[#d4c9b5]/60 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setViewMode("card")}
                  className={`flex items-center gap-1.5 px-3 py-2 font-ui text-xs transition-colors ${
                    viewMode === "card"
                      ? "bg-[#FAF7F0] text-[#2D1F0E]"
                      : "bg-transparent text-[#8a7a65] hover:text-[#5C4A32] hover:bg-[#FAF7F0]/50"
                  }`}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  Card
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("list")}
                  className={`flex items-center gap-1.5 px-3 py-2 font-ui text-xs transition-colors ${
                    viewMode === "list"
                      ? "bg-[#2D1F0E] text-[#F5EDE0]"
                      : "bg-transparent text-[#8a7a65] hover:text-[#5C4A32] hover:bg-[#FAF7F0]/50"
                  }`}
                >
                  <List className="h-3.5 w-3.5" />
                  List
                </button>
              </div>
            </div>

            <VolumeHintBanner entries={entries} onChanged={fetchEntries} />

            <div
              className={
                viewMode === "list"
                  ? "border border-[#d4c9b5]/50 rounded-sm bg-[#FAF7F0]/80 overflow-hidden"
                  : ""
              }
            >
              {isLoading ? (
                <div className="flex items-center justify-center py-12 gap-2">
                  <Loader2 className="h-5 w-5 animate-spin text-[#2C5F2E]" />
                  <span className="font-body text-sm text-[#8a7a65]">
                    Yükleniyor...
                  </span>
                </div>
              ) : (
                <LibraryEntryTable
                  entries={entries}
                  onSelect={handleSelect}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onPdfAttached={() => fetchEntries()}
                  viewMode={viewMode}
                />
              )}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-5">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="flex items-center gap-1 font-ui text-xs px-3 py-1.5 rounded-sm border border-[#d4c9b5] bg-[#FAF7F0]/80 text-[#5C4A32] hover:bg-[#FAF7F0] disabled:opacity-40 transition-colors"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Previous
                </button>
                <span className="font-ui text-xs text-[#8a7a65]">
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="flex items-center gap-1 font-ui text-xs px-3 py-1.5 rounded-sm border border-[#d4c9b5] bg-[#FAF7F0]/80 text-[#5C4A32] hover:bg-[#FAF7F0] disabled:opacity-40 transition-colors"
                >
                  Next
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-[#FAF7F0] border-[#d4c9b5]">
          <DialogHeader>
            <DialogTitle className="font-display text-[#2D1F0E]">
              {editingEntry ? "Kaynağı düzenle" : "Yeni kaynak ekle"}
            </DialogTitle>
          </DialogHeader>
          <div className="h-px bg-[#d4c9b5]/50 my-3" />
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
        <DialogContent className="max-w-sm bg-[#FAF7F0] border-[#d4c9b5]">
          <DialogHeader>
            <DialogTitle className="font-display text-[#2D1F0E]">
              Zotero
            </DialogTitle>
          </DialogHeader>
          <div className="h-px bg-[#d4c9b5]/50 my-3" />
          <ZoteroSettingsCard onSynced={fetchEntries} />
        </DialogContent>
      </Dialog>
    </WorkspaceShell>
  );
}
