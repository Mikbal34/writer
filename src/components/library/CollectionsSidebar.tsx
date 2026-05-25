"use client";

/**
 * Zotero-tarzı dikey koleksiyon kenarı.
 *
 * "Tümü" + her top-level koleksiyon için satır. Her satır:
 *   - tıkla → o koleksiyona filtrele
 *   - drag-drop hedefi (entry'leri o koleksiyona ekle)
 *   - hover'da düzenle/sil dropdown
 *   - sayı badge
 *
 * Drag-drop için entry'ler `application/x-library-entry` MIME tipinde
 * cuid listesi olarak `dataTransfer`'a yazılır (LibraryEntryTable).
 * Buradaki onDrop bunu okur ve `/api/library/collections/[id]/entries`'e
 * POST eder.
 *
 * v1 sadece top-level koleksiyonları gösterir; alt-koleksiyon ağacı
 * v2'de gelir (schema parentId destekliyor).
 */
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import { Plus, Library, MoreHorizontal, Trash2, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Collection, LibrarySelection } from "./FolderChips";

interface CollectionsSidebarProps {
  selection: LibrarySelection;
  onSelectionChange: (s: LibrarySelection) => void;
  /** Bumped by the parent after any mutation (entry add/move) so
   *  counts re-fetch. */
  refreshKey?: number;
  /** "Tümü" satırının yanında gösterilen toplam. */
  totalEntries: number;
}

export default function CollectionsSidebar({
  selection,
  onSelectionChange,
  refreshKey = 0,
  totalEntries,
}: CollectionsSidebarProps) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDraft, setCreateDraft] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [hoverDropId, setHoverDropId] = useState<string | null>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  const fetchCollections = useCallback(async () => {
    try {
      const res = await fetch("/api/library/collections");
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { collections: Collection[] };
      setCollections(data.collections);
    } catch {
      toast.error("Klasörler yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCollections();
  }, [fetchCollections, refreshKey]);

  const topLevel = useMemo(
    () =>
      collections
        .filter((c) => !c.parentId)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [collections],
  );

  // ── Mutations ─────────────────────────────────────────────────────
  async function createCollection(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const res = await fetch("/api/library/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Oluşturulamadı");
      }
      toast.success("Klasör oluşturuldu");
      setCreateDraft(null);
      await fetchCollections();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Oluşturulamadı");
    }
  }

  async function renameCollection(id: string, name: string, original: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === original) {
      setEditingId(null);
      return;
    }
    try {
      const res = await fetch(`/api/library/collections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error();
      toast.success("Yeniden adlandırıldı");
      setEditingId(null);
      await fetchCollections();
    } catch {
      toast.error("Yeniden adlandırılamadı");
    }
  }

  async function deleteCollection(c: Collection) {
    if (!window.confirm(`"${c.name}" klasörü silinsin mi? İçindeki kitaplara dokunulmaz.`)) return;
    try {
      const res = await fetch(`/api/library/collections/${c.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Klasör silindi");
      if (selection.kind === "collection" && selection.collectionId === c.id) {
        onSelectionChange({ kind: "all" });
      }
      await fetchCollections();
    } catch {
      toast.error("Silinemedi");
    }
  }

  // ── Drag-drop ─────────────────────────────────────────────────────
  function onDragOver(collectionId: string, ev: React.DragEvent) {
    if (ev.dataTransfer.types.includes("application/x-library-entry")) {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "copy";
      setHoverDropId(collectionId);
    }
  }

  async function onDrop(collectionId: string, ev: React.DragEvent) {
    ev.preventDefault();
    setHoverDropId(null);
    const raw = ev.dataTransfer.getData("application/x-library-entry");
    if (!raw) return;
    let entryIds: string[] = [];
    try {
      entryIds = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(entryIds) || entryIds.length === 0) return;
    try {
      const res = await fetch(`/api/library/collections/${collectionId}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryIds }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      toast.success(`${data.added} kaynak klasöre eklendi`);
      await fetchCollections();
    } catch {
      toast.error("Klasöre eklenemedi");
    }
  }

  // ── Render ────────────────────────────────────────────────────────
  return (
    <aside className="w-[240px] flex-shrink-0 border-r border-sandy/60 bg-page flex flex-col overflow-hidden">
      <div className="px-3 pt-4 pb-2">
        <div className="text-[10.5px] tracking-[0.14em] uppercase font-semibold text-forest mb-2 px-1">
          Koleksiyonlar
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
        {/* "Tümü" sabit satırı */}
        <button
          type="button"
          onClick={() => onSelectionChange({ kind: "all" })}
          className={[
            "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] transition-colors text-left",
            selection.kind === "all"
              ? "bg-forest/10 text-ink font-semibold"
              : "text-ink-light hover:bg-forest/5",
          ].join(" ")}
        >
          <Library className="h-3.5 w-3.5 text-forest" />
          <span className="flex-1 truncate">Tüm Kütüphane</span>
          <span className="text-[11px] text-ink-muted tabular-nums">{totalEntries}</span>
        </button>

        {/* Koleksiyon listesi */}
        {loading ? (
          <div className="text-[11.5px] text-ink-muted italic px-2 py-3">Yükleniyor...</div>
        ) : topLevel.length === 0 ? (
          <div className="text-[11.5px] text-ink-muted italic px-2 py-3">
            Henüz klasör yok. Aşağıdan yeni klasör oluştur.
          </div>
        ) : (
          topLevel.map((c) => {
            const isActive =
              selection.kind === "collection" && selection.collectionId === c.id;
            const isHoverDrop = hoverDropId === c.id;
            const isEditing = editingId === c.id;

            return (
              <div
                key={c.id}
                onDragOver={(e) => onDragOver(c.id, e)}
                onDragLeave={() => setHoverDropId((id) => (id === c.id ? null : id))}
                onDrop={(e) => onDrop(c.id, e)}
                className={[
                  "group flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] transition-colors cursor-pointer",
                  isActive ? "bg-forest/10 text-ink font-semibold" : "text-ink-light hover:bg-forest/5",
                  isHoverDrop ? "ring-2 ring-gold bg-gold/10" : "",
                ].join(" ")}
                onClick={() => {
                  if (!isEditing) onSelectionChange({ kind: "collection", collectionId: c.id });
                }}
              >
                <span
                  className="h-2 w-2 rounded-full flex-shrink-0"
                  style={{ background: c.color || "var(--color-forest)" }}
                />
                {isEditing ? (
                  <input
                    ref={editInputRef}
                    value={editingDraft}
                    autoFocus
                    onChange={(e) => setEditingDraft(e.target.value)}
                    onBlur={() => renameCollection(c.id, editingDraft, c.name)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") renameCollection(c.id, editingDraft, c.name);
                      else if (e.key === "Escape") setEditingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 bg-elevated border border-forest/30 rounded px-1.5 py-0.5 text-[12.5px] outline-none focus:border-forest"
                  />
                ) : (
                  <>
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="text-[11px] text-ink-muted tabular-nums">
                      {c.entryCount}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <button
                            type="button"
                            onClick={(e) => e.stopPropagation()}
                            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-ink/10 transition-opacity"
                            aria-label="Klasör menüsü"
                          >
                            <MoreHorizontal className="h-3.5 w-3.5 text-ink-muted" />
                          </button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            setEditingId(c.id);
                            setEditingDraft(c.name);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5 mr-2" />
                          Yeniden adlandır
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => deleteCollection(c)}
                          className="text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-2" />
                          Sil
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
              </div>
            );
          })
        )}

        {/* Yeni klasör oluşturma */}
        {createDraft !== null ? (
          <div className="flex items-center gap-2 px-2 py-1.5 mt-1">
            <span className="h-2 w-2 rounded-full bg-forest/40 flex-shrink-0" />
            <input
              ref={createInputRef}
              value={createDraft}
              autoFocus
              placeholder="Klasör adı..."
              onChange={(e) => setCreateDraft(e.target.value)}
              onBlur={() => {
                if (createDraft.trim()) createCollection(createDraft);
                else setCreateDraft(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") createCollection(createDraft);
                else if (e.key === "Escape") setCreateDraft(null);
              }}
              className="flex-1 bg-elevated border border-forest/30 rounded px-1.5 py-0.5 text-[12.5px] outline-none focus:border-forest"
            />
            <button
              type="button"
              onClick={() => setCreateDraft(null)}
              className="p-0.5 rounded hover:bg-ink/10"
            >
              <X className="h-3 w-3 text-ink-muted" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreateDraft("")}
            className="w-full flex items-center gap-2 px-2 py-1.5 mt-1 rounded-md text-[12.5px] text-ink-muted hover:text-ink hover:bg-forest/5 transition-colors text-left"
          >
            <Plus className="h-3.5 w-3.5" />
            Yeni klasör
          </button>
        )}
      </div>

      <div className="px-3 py-2 border-t border-sandy/60 text-[10.5px] text-ink-muted italic leading-tight">
        Bir kaynağı sürükleyip bir klasörün üstüne bırak — eklemek için yeter.
      </div>
    </aside>
  );
}
