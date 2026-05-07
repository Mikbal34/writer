"use client";

/**
 * Dialog the writing editor opens when the user wants to insert a
 * citation. Lists the project's bibliography (with PDF availability
 * status), takes a page number, and emits the selected attrs back to
 * the editor so it can drop a CitationMark node at the cursor.
 *
 * Verification of "is this citation actually correct" happens on the
 * dedicated /projects/[id]/citations page — the picker only inserts
 * the marker; it deliberately doesn't preview the source page here.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Search, Loader2, BookOpen, FileText, Circle } from "lucide-react";
import { toast } from "sonner";

interface BibEntry {
  id: string;
  authorSurname: string;
  authorName: string | null;
  title: string;
  year: string | null;
  libraryEntryId: string | null;
  libraryEntry?: { id: string; filePath: string | null; pdfStatus: string } | null;
}

interface CitationPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onPick: (attrs: {
    bibId: string;
    page: number | null;
    quote: string | null;
    label: string;
  }) => void;
}

function statusFor(b: BibEntry): "pdf" | "chunks" | "manual" {
  if (b.libraryEntry?.filePath) return "pdf";
  if (b.libraryEntryId) return "chunks";
  return "manual";
}

function shortLabel(b: BibEntry): string {
  const surname = b.authorSurname || "Unknown";
  const year = b.year ? `, ${b.year}` : "";
  return `${surname}${year}`;
}

export default function CitationPicker({
  open,
  onOpenChange,
  projectId,
  onPick,
}: CitationPickerProps) {
  const [entries, setEntries] = useState<BibEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<BibEntry | null>(null);
  const [page, setPage] = useState<string>("");
  const [quote, setQuote] = useState<string>("");

  useEffect(() => {
    if (!open) {
      setSelected(null);
      setPage("");
      setQuote("");
      setSearch("");
      return;
    }
    setLoading(true);
    fetch(`/api/bibliography?projectId=${projectId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("fetch failed"))))
      .then((data: BibEntry[]) => setEntries(data))
      .catch(() => toast.error("Bibliyografya yüklenemedi"))
      .finally(() => setLoading(false));
  }, [open, projectId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((b) => {
      const hay = [b.authorSurname, b.authorName, b.title, b.year]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [entries, search]);

  function handleInsert() {
    if (!selected) return;
    const pageNum = page.trim() ? parseInt(page.trim(), 10) : null;
    if (page.trim() && (!Number.isFinite(pageNum) || (pageNum as number) < 1)) {
      toast.error("Sayfa numarası geçersiz");
      return;
    }
    const surname = selected.authorSurname || "Unknown";
    const year = selected.year ? `, ${selected.year}` : "";
    const pageStr =
      pageNum !== null && pageNum !== undefined ? `, s. ${pageNum}` : "";
    const label = `(${surname}${year}${pageStr})`;
    onPick({
      bibId: selected.id,
      page: pageNum,
      quote: quote.trim() || null,
      label,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col bg-[#FAF7F0] border-[#d4c9b5]">
        <DialogHeader>
          <DialogTitle className="font-display text-[#2D1F0E]">
            Kaynak Ekle
          </DialogTitle>
        </DialogHeader>
        <div className="h-px bg-[#d4c9b5]/50" />

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#8a7a65]" />
          <input
            type="text"
            placeholder="Yazar / başlık / yıl ara..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-3 py-2.5 rounded-sm border border-[#d4c9b5]/60 bg-white font-body text-sm text-[#2D1F0E] placeholder:text-[#a89880] focus:outline-none focus:border-[#C9A84C]/60"
          />
        </div>

        {/* List */}
        <div className="flex-1 min-h-[180px] max-h-[300px] overflow-y-auto border border-[#d4c9b5]/40 rounded-sm bg-white">
          {loading ? (
            <div className="flex items-center justify-center py-10 gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-[#C9A84C]" />
              <span className="font-body text-sm text-[#8a7a65]">
                Yükleniyor...
              </span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-10 font-body text-sm text-[#8a7a65]">
              {entries.length === 0
                ? "Bu projenin bibliyografyası boş. Önce kaynak ekle."
                : "Eşleşen kaynak yok."}
            </div>
          ) : (
            <ul>
              {filtered.map((b) => {
                const isActive = selected?.id === b.id;
                const st = statusFor(b);
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(b)}
                      className={`w-full text-left px-3 py-2 flex items-start gap-2.5 border-b border-[#d4c9b5]/30 last:border-0 transition-colors ${
                        isActive
                          ? "bg-[#C9A84C]/10"
                          : "hover:bg-[#FAF7F0]/60"
                      }`}
                    >
                      <span
                        className="mt-0.5 shrink-0"
                        title={
                          st === "pdf"
                            ? "PDF dosyası mevcut"
                            : st === "chunks"
                              ? "Sadece çıkarılmış metin"
                              : "Sadece manuel künye"
                        }
                      >
                        {st === "pdf" ? (
                          <BookOpen className="h-3.5 w-3.5 text-[#2D8B4E]" />
                        ) : st === "chunks" ? (
                          <FileText className="h-3.5 w-3.5 text-[#C9A84C]" />
                        ) : (
                          <Circle className="h-3.5 w-3.5 text-[#a89880]" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-body text-sm text-[#2D1F0E] truncate">
                          {b.title}
                        </div>
                        <div className="font-ui text-xs text-[#6b5a45] truncate">
                          {shortLabel(b)}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Page + quote inputs */}
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            min="1"
            placeholder="Sayfa numarası"
            value={page}
            onChange={(e) => setPage(e.target.value)}
            disabled={!selected}
            className="px-3 py-2 rounded-sm border border-[#d4c9b5]/60 bg-white font-body text-sm text-[#2D1F0E] placeholder:text-[#a89880] focus:outline-none focus:border-[#C9A84C]/60 disabled:bg-[#FAF7F0]/40"
          />
          <input
            type="text"
            placeholder="Alıntı (opsiyonel, doğrulama için)"
            value={quote}
            onChange={(e) => setQuote(e.target.value)}
            disabled={!selected}
            className="px-3 py-2 rounded-sm border border-[#d4c9b5]/60 bg-white font-body text-sm text-[#2D1F0E] placeholder:text-[#a89880] focus:outline-none focus:border-[#C9A84C]/60 disabled:bg-[#FAF7F0]/40"
          />
        </div>

        {/* Action row */}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="px-3 py-1.5 rounded-sm border border-[#d4c9b5] font-ui text-xs text-[#5C4A32] hover:bg-[#FAF7F0]"
          >
            İptal
          </button>
          <button
            type="button"
            onClick={handleInsert}
            disabled={!selected}
            className="px-3 py-1.5 rounded-sm bg-[#2D1F0E] text-[#FAF7F0] font-ui text-xs hover:opacity-90 disabled:opacity-40"
          >
            Atıfı ekle
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
