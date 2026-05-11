"use client";

/**
 * Resolves a volumeHint suggestion: take a one-off stub entry and
 * fold it into a multi-volume entry — either an existing parent the
 * user picks, or a fresh one we create together.
 *
 * The dialog opens with two tabs: "Mevcut esere ekle" (default) and
 * "Yeni multi-volume eser". Fuzzy-prefilters the existing-entries
 * list with the parentWork hint so the right candidate floats to the
 * top.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Search, BookCopy, Plus, Library } from "lucide-react";
import { toast } from "sonner";

interface EntryOption {
  id: string;
  title: string;
  authorSurname: string;
  authorName: string | null;
  _count?: { volumes?: number };
}

interface PromoteVolumeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entryId: string;
  /** Haiku's detected parent-work title (empty for manual launches). */
  parentWork: string;
  /** Haiku's detected volume number (defaults to 1 for manual launches). */
  volumeNumber: number;
  volumeLabel: string | null;
  /** Excluded from the existing-parent picker. */
  onResolved: () => void;
}

type Mode = "existing" | "new";

function similarity(a: string, b: string): number {
  // Cheap normalised-substring score to sort the picker. We don't
  // need Levenshtein; same-prefix tokens are enough for academic
  // titles where Haiku and the parent title share a stem.
  const A = a.toLowerCase();
  const B = b.toLowerCase();
  if (A === B) return 1;
  if (A.includes(B) || B.includes(A)) return 0.8;
  const tokens = B.split(/\s+/).filter((t) => t.length > 2);
  if (tokens.length === 0) return 0;
  const hits = tokens.filter((t) => A.includes(t)).length;
  return hits / tokens.length;
}

export default function PromoteVolumeDialog({
  open,
  onOpenChange,
  entryId,
  parentWork,
  volumeNumber: initialVolumeNumber,
  volumeLabel: initialVolumeLabel,
  onResolved,
}: PromoteVolumeDialogProps) {
  const [mode, setMode] = useState<Mode>("existing");
  const [entries, setEntries] = useState<EntryOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedParentId, setSelectedParentId] = useState<string>("");
  const [newParentTitle, setNewParentTitle] = useState("");
  const [volumeNumber, setVolumeNumber] = useState<string>(
    String(initialVolumeNumber || 1),
  );
  const [label, setLabel] = useState<string>(initialVolumeLabel ?? "");
  const [submitting, setSubmitting] = useState(false);

  // Reset / fetch when reopened
  useEffect(() => {
    if (!open) {
      setSelectedParentId("");
      setNewParentTitle("");
      setSearch("");
      setMode("existing");
      return;
    }
    setVolumeNumber(String(initialVolumeNumber || 1));
    setLabel(initialVolumeLabel ?? "");
    setNewParentTitle(parentWork);

    setLoading(true);
    fetch("/api/library?limit=200")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("fetch failed"))))
      .then((data: { entries: EntryOption[] }) => {
        // Hide the entry being promoted from the parent picker.
        setEntries((data.entries ?? []).filter((e) => e.id !== entryId));
      })
      .catch(() => toast.error("Kütüphane yüklenemedi"))
      .finally(() => setLoading(false));
  }, [open, entryId, parentWork, initialVolumeNumber, initialVolumeLabel]);

  // Existing-parent picker: sort by Haiku-hint similarity first, then
  // by user-typed search. Surfaces the right candidate immediately.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const scored = entries.map((e) => ({
      e,
      score: Math.max(
        similarity(e.title, parentWork),
        q ? similarity(e.title, q) + similarity(e.authorSurname, q) : 0,
      ),
    }));
    if (q) {
      return scored
        .filter(({ e }) =>
          [e.title, e.authorSurname, e.authorName]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(q),
        )
        .sort((a, b) => b.score - a.score)
        .map(({ e }) => e);
    }
    return scored.sort((a, b) => b.score - a.score).map(({ e }) => e);
  }, [entries, search, parentWork]);

  async function handleSubmit() {
    const volNum = parseInt(volumeNumber, 10);
    if (!Number.isFinite(volNum) || volNum < 1) {
      toast.error("Cilt numarası geçersiz");
      return;
    }

    const body: Record<string, unknown> = {
      volumeNumber: volNum,
      label: label.trim() || null,
    };
    if (mode === "existing") {
      if (!selectedParentId) {
        toast.error("Ana eseri seç");
        return;
      }
      body.parentEntryId = selectedParentId;
    } else {
      const title = newParentTitle.trim();
      if (!title) {
        toast.error("Ana eser başlığı boş bırakılamaz");
        return;
      }
      body.newParentTitle = title;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/library/${entryId}/promote-to-volume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      toast.success(`Cilt ${volNum} olarak eklendi`);
      onOpenChange(false);
      onResolved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "İşlem başarısız");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col bg-[#FAF7F0] border-[#d4c9b5]">
        <DialogHeader>
          <DialogTitle className="font-display text-[#2D1F0E] flex items-center gap-2">
            <BookCopy className="h-4 w-4 text-[#C9A84C]" />
            Cilt olarak ekle
          </DialogTitle>
          <p className="font-body text-xs text-[#6b5a45]">
            {parentWork ? (
              <>
                <span className="text-[#8a5a1a] font-semibold">
                  &ldquo;{parentWork}&rdquo;
                </span>{" "}
                eserinin{" "}
                <span className="text-[#8a5a1a] font-semibold">
                  Cilt {initialVolumeNumber}
                </span>{" "}
                olarak tespit edildi.
              </>
            ) : (
              <>
                Bu kaynağı çok ciltli bir eserin parçası olarak işaretle.
                Mevcut bir ana esere ekleyebilir ya da yeni bir eser
                başlatabilirsin.
              </>
            )}
          </p>
        </DialogHeader>
        <div className="h-px bg-[#d4c9b5]/50" />

        {/* Mode tabs */}
        <div className="flex gap-1 p-0.5 bg-[#FAF7F0]/60 border border-[#d4c9b5]/40 rounded-sm">
          <button
            type="button"
            onClick={() => setMode("existing")}
            className={`flex-1 px-3 py-1.5 rounded-sm font-ui text-xs transition-colors ${
              mode === "existing"
                ? "bg-white text-[#2D1F0E] shadow-sm"
                : "text-[#8a7a65] hover:text-[#5C4A32]"
            }`}
          >
            <Library className="h-3 w-3 inline mr-1.5" />
            Mevcut esere ekle
          </button>
          <button
            type="button"
            onClick={() => setMode("new")}
            className={`flex-1 px-3 py-1.5 rounded-sm font-ui text-xs transition-colors ${
              mode === "new"
                ? "bg-white text-[#2D1F0E] shadow-sm"
                : "text-[#8a7a65] hover:text-[#5C4A32]"
            }`}
          >
            <Plus className="h-3 w-3 inline mr-1.5" />
            Yeni multi-volume eser
          </button>
        </div>

        {mode === "existing" ? (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#8a7a65]" />
              <input
                type="text"
                placeholder="Yazar / başlık ara..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-3 py-2.5 rounded-sm border border-[#d4c9b5]/60 bg-white font-body text-sm text-[#2D1F0E] placeholder:text-[#a89880] focus:outline-none focus:border-[#C9A84C]/60"
              />
            </div>

            <div className="flex-1 min-h-[180px] max-h-[260px] overflow-y-auto border border-[#d4c9b5]/40 rounded-sm bg-white">
              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-4 w-4 animate-spin text-[#C9A84C]" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex items-center justify-center py-10 font-body text-sm text-[#8a7a65]">
                  Eşleşen kaynak yok. &ldquo;Yeni multi-volume eser&rdquo; sekmesine geç.
                </div>
              ) : (
                <ul>
                  {filtered.map((e) => {
                    const isActive = selectedParentId === e.id;
                    return (
                      <li key={e.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedParentId(e.id)}
                          className={`w-full text-left px-3 py-2 flex items-center gap-2 border-b border-[#d4c9b5]/30 last:border-0 transition-colors ${
                            isActive ? "bg-[#C9A84C]/10" : "hover:bg-[#FAF7F0]/60"
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="font-body text-sm text-[#2D1F0E] truncate">
                              {e.title}
                            </div>
                            <div className="font-ui text-xs text-[#6b5a45] truncate">
                              {e.authorSurname}
                              {e.authorName ? `, ${e.authorName}` : ""}
                              {(e._count?.volumes ?? 0) > 0
                                ? ` · ${e._count?.volumes} cilt`
                                : ""}
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <label className="block font-ui text-[11px] uppercase tracking-widest text-[#8a7a65]">
              Ana eser başlığı
            </label>
            <input
              type="text"
              value={newParentTitle}
              onChange={(e) => setNewParentTitle(e.target.value)}
              placeholder="örn: et-Tahrir ve't-Tenvir"
              autoFocus
              className="w-full px-3 py-2 rounded-sm border border-[#d4c9b5]/60 bg-white font-body text-sm text-[#2D1F0E] placeholder:text-[#a89880] focus:outline-none focus:border-[#C9A84C]/60"
            />
            <p className="font-body text-[11px] text-[#a89a82]">
              Yazar bilgisi mevcut entry&apos;den (varsa) kopyalanır — sonra düzenleyebilirsin.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block font-ui text-[11px] uppercase tracking-widest text-[#8a7a65] mb-1">
              Cilt numarası
            </label>
            <input
              type="number"
              min="1"
              value={volumeNumber}
              onChange={(e) => setVolumeNumber(e.target.value)}
              className="w-full px-3 py-2 rounded-sm border border-[#d4c9b5]/60 bg-white font-body text-sm text-[#2D1F0E] focus:outline-none focus:border-[#C9A84C]/60"
            />
          </div>
          <div>
            <label className="block font-ui text-[11px] uppercase tracking-widest text-[#8a7a65] mb-1">
              Etiket (ops.)
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="örn: Bakara"
              className="w-full px-3 py-2 rounded-sm border border-[#d4c9b5]/60 bg-white font-body text-sm text-[#2D1F0E] placeholder:text-[#a89880] focus:outline-none focus:border-[#C9A84C]/60"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="px-3 py-1.5 rounded-sm border border-[#d4c9b5] font-ui text-xs text-[#5C4A32] hover:bg-[#FAF7F0]"
          >
            İptal
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={
              submitting ||
              (mode === "existing" && !selectedParentId) ||
              (mode === "new" && !newParentTitle.trim())
            }
            className="px-3 py-1.5 rounded-sm bg-[#2D1F0E] text-[#FAF7F0] font-ui text-xs hover:opacity-90 disabled:opacity-40 flex items-center gap-1.5"
          >
            {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
            Cilt olarak ekle
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
