"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  BookOpen,
  Library,
  Plus,
  FileUp,
  Search,
  Loader2,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Filter,
  LayoutGrid,
  List,
  Feather,
  Sparkles,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import LibraryEntryTable, {
  type LibraryEntryRow,
} from "@/components/library/LibraryEntryTable";
import LibraryEntryForm from "@/components/library/LibraryEntryForm";
import BibtexImportDialog from "@/components/library/BibtexImportDialog";
import ZoteroSettingsCard from "@/components/library/ZoteroSettingsCard";
import { Ornament } from "@/components/shared/BookElements";
import { FadeUp, FadeIn } from "@/components/shared/Animations";

const TEXTURE_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310419663027387604/L3DyhJpdXQXWDPUTXv57iD/book-texture-bg-hJmgUJE5GQFpbmBrLLMri5.webp";

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

  // Dialogs
  const [showEntryDialog, setShowEntryDialog] = useState(false);
  const [editingEntry, setEditingEntry] = useState<LibraryEntryRow | null>(null);
  const [showBibtexDialog, setShowBibtexDialog] = useState(false);
  const [showZoteroPanel, setShowZoteroPanel] = useState(false);

  const fetchEntries = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (search) params.set("search", search);
      if (entryTypeFilter) params.set("entryType", entryTypeFilter);

      const res = await fetch(`/api/library?${params}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setEntries(data.entries ?? []);
      setTotal(data.total ?? 0);
    } catch {
      toast.error("Failed to load library");
    } finally {
      setIsLoading(false);
    }
  }, [page, search, entryTypeFilter]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // Debounce search
  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  function handleEdit(entry: LibraryEntryRow) {
    setEditingEntry(entry);
    setShowEntryDialog(true);
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this source?")) return;
    try {
      const res = await fetch(`/api/library/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Source deleted");
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

  const totalPages = Math.ceil(total / 50);

  return (
    <div
      className="min-h-screen"
      style={{
        backgroundImage: `url(${TEXTURE_URL})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundAttachment: "fixed",
      }}
    >
      {/* Navbar */}
      <nav className="bg-[#1A0F05]/95 backdrop-blur-md border-b border-[#C9A84C]/20 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <img src="/images/quilpen-logo-horizontal.png" alt="Quilpen" className="h-20 animate-logo-in" style={{ filter: "brightness(0) invert(1)" }} />
          </Link>

          <div className="flex items-center gap-1">
            <Link
              href="/style"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm font-ui text-xs text-[#c9bfad] hover:text-[#F5EDE0] transition-colors"
            >
              <Feather className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Writing Twin</span>
            </Link>
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="flex items-center gap-1.5 font-ui text-xs text-[#c9bfad] hover:text-[#F5EDE0] transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-10">
        {/* Back link */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 font-ui text-xs text-[#8a7a65] hover:text-[#2D1F0E] transition-colors mb-6"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Back to My Books
        </Link>

        {/* Page header */}
        <FadeUp className="mb-8 text-center">
          <div className="flex items-center justify-center gap-3 mb-3">
            <div className="h-px flex-1 max-w-[80px] bg-gradient-to-r from-transparent to-[#C9A84C]/60" />
            <Library className="h-5 w-5 text-[#C9A84C]" />
            <div className="h-px flex-1 max-w-[80px] bg-gradient-to-l from-transparent to-[#C9A84C]/60" />
          </div>
          <h1 className="font-display text-3xl font-bold text-[#2D1F0E] tracking-tight">
            My Library
          </h1>
          <p className="font-body text-sm text-[#6b5a45] mt-1.5">
            Your personal source library available across all projects.
          </p>
        </FadeUp>

        {/* Action buttons */}
        <FadeIn delay={0.2} className="flex items-center justify-between gap-3 flex-wrap mb-6">
          <span className="font-ui text-xs text-[#8a7a65]">{total} sources</span>
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setShowZoteroPanel(!showZoteroPanel)}
              className="font-ui text-xs px-3 py-2 rounded-sm border border-[#d4c9b5] bg-[#FAF7F0]/80 text-[#5C4A32] hover:bg-[#FAF7F0] transition-colors"
            >
              Zotero
            </button>
            <button
              type="button"
              onClick={() => setShowBibtexDialog(true)}
              className="flex items-center gap-1.5 font-ui text-xs px-3 py-2 rounded-sm border border-[#d4c9b5] bg-[#FAF7F0]/80 text-[#5C4A32] hover:bg-[#FAF7F0] transition-colors"
            >
              <FileUp className="h-3.5 w-3.5" />
              Import BibTeX
            </button>
            <Link
              href="/library/literature-search"
              className="flex items-center gap-1.5 font-ui text-xs px-3 py-2 rounded-sm border border-[#C9A84C]/30 bg-[#C9A84C]/10 text-[#8a7540] hover:bg-[#C9A84C]/20 transition-colors"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Literatür Tara
            </Link>
            <button
              type="button"
              onClick={() => {
                setEditingEntry(null);
                setShowEntryDialog(true);
              }}
              className="flex items-center gap-1.5 font-ui text-xs px-3 py-2 rounded-sm border border-[#C9A84C]/30 bg-[#2D1F0E] text-[#C9A84C] hover:bg-[#3a2910] transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add New
            </button>
          </div>
        </FadeIn>

        {/* Filter bar */}
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#8a7a65]" />
            <input
              type="text"
              placeholder="Search by author or title..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full pl-10 pr-3 py-2.5 rounded-sm border border-[#d4c9b5]/60 bg-[#FAF7F0] font-body text-sm text-[#2D1F0E] placeholder:text-[#a89880] focus:outline-none focus:border-[#C9A84C]/50 focus:ring-0 transition-colors"
            />
          </div>

          {/* Type filter */}
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
              <option value="all">Filter by type</option>
              {ENTRY_TYPES.filter((t) => t.value).map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* View mode toggle */}
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

          {/* Count */}
          <span className="font-ui text-sm text-[#5C4A32]">{total} sources</span>
        </div>

        {/* Ornament divider */}
        <Ornament className="w-32 mx-auto text-[#c9bfad] mb-5" />

        {/* Content */}
        <div className={viewMode === "list" ? "border border-[#d4c9b5]/50 rounded-sm bg-[#FAF7F0]/80 overflow-hidden" : ""}>
          {isLoading ? (
            <div className="flex items-center justify-center py-12 gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-[#2C5F2E]" />
              <span className="font-body text-sm text-[#8a7a65]">Loading...</span>
            </div>
          ) : (
            <LibraryEntryTable
              entries={entries}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onPdfAttached={fetchEntries}
              viewMode={viewMode}
            />
          )}
        </div>

        {/* Pagination */}
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

        {/* Page number */}
        <div className="text-center py-4 mt-4">
          <span className="font-display text-xs text-[#a89880] italic">— ix —</span>
        </div>

      </main>

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
              {editingEntry ? "Edit Source" : "Add New Source"}
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

      {/* Zotero Dialog */}
      <Dialog open={showZoteroPanel} onOpenChange={setShowZoteroPanel}>
        <DialogContent className="max-w-sm bg-[#FAF7F0] border-[#d4c9b5]">
          <DialogHeader>
            <DialogTitle className="font-display text-[#2D1F0E]">
              Zotero Connection
            </DialogTitle>
          </DialogHeader>
          <div className="h-px bg-[#d4c9b5]/50 my-1" />
          <ZoteroSettingsCard onSynced={() => { fetchEntries(); setShowZoteroPanel(false); }} />
        </DialogContent>
      </Dialog>

      {/* BibTeX Import Dialog */}
      <BibtexImportDialog
        open={showBibtexDialog}
        onOpenChange={setShowBibtexDialog}
        onImported={fetchEntries}
      />
    </div>
  );
}
