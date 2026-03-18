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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import LibraryEntryTable, {
  type LibraryEntryRow,
} from "@/components/library/LibraryEntryTable";
import LibraryEntryForm from "@/components/library/LibraryEntryForm";
import BibtexImportDialog from "@/components/library/BibtexImportDialog";
import ZoteroSettingsCard from "@/components/library/ZoteroSettingsCard";

const ENTRY_TYPES = [
  { value: "", label: "Tümü" },
  { value: "kitap", label: "Kitap" },
  { value: "makale", label: "Makale" },
  { value: "nesir", label: "Nesir" },
  { value: "ceviri", label: "Çeviri" },
  { value: "tez", label: "Tez" },
  { value: "ansiklopedi", label: "Ansiklopedi" },
  { value: "web", label: "Web" },
];

export default function LibraryPage() {
  const [entries, setEntries] = useState<LibraryEntryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [entryTypeFilter, setEntryTypeFilter] = useState("");
  const [page, setPage] = useState(1);

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
      toast.error("Kütüphane yüklenemedi");
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
    if (!confirm("Bu kaynağı silmek istediğinize emin misiniz?")) return;
    try {
      const res = await fetch(`/api/library/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Kaynak silindi");
      fetchEntries();
    } catch {
      toast.error("Silme başarısız");
    }
  }

  function handleFormSave() {
    setShowEntryDialog(false);
    setEditingEntry(null);
    fetchEntries();
  }

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-background/95 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                <BookOpen className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="font-semibold text-foreground">Writer Agent</span>
            </Link>
            <Separator orientation="vertical" className="h-5" />
            <div className="flex items-center gap-1.5 text-foreground">
              <Library className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm">Kütüphanem</span>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Title + Actions */}
        <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Kütüphanem</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Tüm projelerinizde kullanabileceğiniz kişisel kaynak kütüphaneniz.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outline"
              onClick={() => setShowZoteroPanel(!showZoteroPanel)}
              className="gap-2 text-sm"
            >
              Zotero
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowBibtexDialog(true)}
              className="gap-2 text-sm"
            >
              <FileUp className="h-4 w-4" />
              BibTeX Aktar
            </Button>
            <Button
              onClick={() => {
                setEditingEntry(null);
                setShowEntryDialog(true);
              }}
              className="gap-2 text-sm"
            >
              <Plus className="h-4 w-4" />
              Yeni Ekle
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
          {/* Main content */}
          <div>
            {/* Filters */}
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Yazar veya başlık ara..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="pl-8 h-9 text-sm"
                />
              </div>
              <Select
                value={entryTypeFilter}
                onValueChange={(v) => { setEntryTypeFilter(v === "all" ? "" : (v ?? "")); setPage(1); }}
              >
                <SelectTrigger className="w-36 h-9 text-sm">
                  <SelectValue placeholder="Tür filtresi" />
                </SelectTrigger>
                <SelectContent>
                  {ENTRY_TYPES.map((t) => (
                    <SelectItem key={t.value || "all"} value={t.value || "all"}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground shrink-0">
                {total} kaynak
              </span>
            </div>

            {/* Table */}
            <Card>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="flex items-center justify-center py-12 gap-2">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    <span className="text-sm text-muted-foreground">Yükleniyor...</span>
                  </div>
                ) : (
                  <LibraryEntryTable
                    entries={entries}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                  />
                )}
              </CardContent>
            </Card>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-4">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Önceki
                </Button>
                <span className="text-xs text-muted-foreground">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Sonraki
                </Button>
              </div>
            )}
          </div>

          {/* Sidebar — Zotero */}
          {showZoteroPanel && (
            <div>
              <ZoteroSettingsCard onSynced={fetchEntries} />
            </div>
          )}
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingEntry ? "Kaynağı Düzenle" : "Yeni Kaynak Ekle"}
            </DialogTitle>
          </DialogHeader>
          <Separator className="my-3" />
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

      {/* BibTeX Import Dialog */}
      <BibtexImportDialog
        open={showBibtexDialog}
        onOpenChange={setShowBibtexDialog}
        onImported={fetchEntries}
      />
    </div>
  );
}
