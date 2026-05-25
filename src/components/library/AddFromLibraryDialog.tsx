"use client";

/**
 * "Kütüphaneden ekle" picker — bir klasör görüntülerken kullanıcı bu
 * dialog'u açar, mevcut kitaplardan istediklerini seçer ve klasöre
 * ekler. AddSourceDialog tasarım diliyle tutarlı (dark olive hero +
 * parchment body + forest/gold accent).
 */
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, X, FolderPlus, Sparkles, Search, Check } from "lucide-react";
import { toast } from "sonner";

interface PickerEntry {
  id: string;
  title: string;
  authorSurname: string;
  authorName: string | null;
  year: string | null;
  publisher: string | null;
}

interface AddFromLibraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collectionId: string;
  collectionName: string;
  /** Bumped by parent so counts refresh after add. */
  onAdded: () => void;
}

export default function AddFromLibraryDialog({
  open, onOpenChange, collectionId, collectionName, onAdded,
}: AddFromLibraryDialogProps) {
  const [entries, setEntries] = useState<PickerEntry[]>([]);
  const [memberOf, setMemberOf] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Dialog açılınca tüm entry'leri ve bu koleksiyonun mevcut üyelerini
  // çek. Mevcut üyeler işaretli ve disabled görünür (tekrar eklemenin
  // anlamı yok).
  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setSearch("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [allRes, colRes] = await Promise.all([
          fetch("/api/library?limit=500"),
          fetch(`/api/library?collectionId=${collectionId}&limit=500`),
        ]);
        const allData = await allRes.json();
        const colData = await colRes.json();
        if (cancelled) return;
        setEntries(
          (allData.entries ?? []).map((e: Record<string, unknown>) => ({
            id: e.id as string,
            title: (e.title as string) ?? "",
            authorSurname: (e.authorSurname as string) ?? "",
            authorName: (e.authorName as string) ?? null,
            year: (e.year as string) ?? null,
            publisher: (e.publisher as string) ?? null,
          })),
        );
        setMemberOf(
          new Set((colData.entries ?? []).map((e: { id: string }) => e.id)),
        );
      } catch {
        toast.error("Kitaplar yüklenemedi");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, collectionId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => {
      const hay = `${e.authorSurname} ${e.authorName ?? ""} ${e.title}`.toLowerCase();
      return hay.includes(q);
    });
  }, [entries, search]);

  function toggle(id: string) {
    if (memberOf.has(id)) return; // zaten üye
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function handleAdd() {
    if (selected.size === 0) {
      toast.error("Önce kitap seç");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/library/collections/${collectionId}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryIds: Array.from(selected) }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      toast.success(`${data.added} kitap "${collectionName}" klasörüne eklendi`);
      onAdded();
      onOpenChange(false);
    } catch {
      toast.error("Eklenemedi");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[820px] sm:max-w-[820px] w-[88vw] max-h-[86vh] p-0 gap-0 overflow-hidden border-0 bg-parchment flex flex-col"
      >
        {/* Hero */}
        <div
          className="px-6 pt-5 pb-5 text-gold-soft relative overflow-hidden flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #2a3d28 0%, #1a2818 100%)" }}
        >
          <div
            className="absolute -top-2 right-5 opacity-[0.14] font-serif italic leading-none pointer-events-none select-none"
            style={{ fontSize: 110, color: "var(--color-gold-soft)" }}
          >
            +
          </div>
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <div className="inline-flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.14em] font-semibold text-gold-soft/65 mb-1">
                <FolderPlus size={11} /> Kütüphaneden ekle
              </div>
              <h2 className="font-serif italic text-2xl font-medium text-white leading-tight m-0 truncate">
                {collectionName}
              </h2>
            </div>
            <button
              onClick={() => onOpenChange(false)}
              className="w-[30px] h-[30px] rounded-full bg-white/12 border-0 text-gold-soft flex items-center justify-center hover:bg-white/20 transition"
              aria-label="Kapat"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-[18px] pb-1">
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-muted pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Yazar veya başlıkta ara..."
              className="pl-9"
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-ink-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-[13px]">Yükleniyor...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-[13px] text-ink-muted italic">
              Eşleşen kitap yok.
            </div>
          ) : (
            <div className="space-y-0.5">
              {filtered.map((e) => {
                const isMember = memberOf.has(e.id);
                const isSelected = selected.has(e.id);
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => toggle(e.id)}
                    disabled={isMember}
                    className={[
                      "w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors",
                      isMember
                        ? "bg-forest/5 text-ink-muted cursor-not-allowed"
                        : isSelected
                          ? "bg-forest/10 ring-1 ring-forest/30"
                          : "hover:bg-forest/5",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "w-4 h-4 rounded-sm border flex items-center justify-center flex-shrink-0",
                        isMember
                          ? "bg-forest/30 border-forest/30"
                          : isSelected
                            ? "bg-forest border-forest"
                            : "border-ink-muted/40 bg-parchment",
                      ].join(" ")}
                    >
                      {(isMember || isSelected) && (
                        <Check className="h-3 w-3 text-white" />
                      )}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-ink truncate">
                        {e.authorSurname || "?"}{" "}
                        {e.authorName && (
                          <span className="text-ink-muted font-normal">
                            ({e.authorName})
                          </span>
                        )}
                      </div>
                      <div className="text-[11.5px] text-ink-muted truncate">
                        {e.title}
                        {e.year && <span className="ml-2 tabular-nums">· {e.year}</span>}
                      </div>
                    </div>
                    {isMember && (
                      <span className="text-[10.5px] text-forest tabular-nums flex-shrink-0">
                        ✓ zaten klasörde
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2.5 px-6 py-3.5 border-t border-ink-muted/15 bg-parchment-dark/30 flex-shrink-0">
          <span className="text-[11.5px] text-ink-muted inline-flex items-center gap-1.5">
            <Sparkles size={11} className="text-gold" />
            {selected.size > 0
              ? `${selected.size} kitap seçildi`
              : "Eklemek istediğin kitapları seç"}
          </span>
          <span className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={submitting || selected.size === 0}
            className="bg-forest hover:bg-forest/90 text-white gap-1"
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FolderPlus size={13} />
            )}
            Ekle
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
