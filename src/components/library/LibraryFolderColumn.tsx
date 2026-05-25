"use client";

/**
 * Yeşil hero band'in HEMEN ALTINDA yer alan sol kolonda klasör listesi.
 * Açılır-kapanır (KLASÖRLER ▲/▼), durum localStorage'a kaydedilir.
 *
 * Layout (parent yerleştirir):
 *   ┌────────────┬─────────────────────────────────┐
 *   │ KLASÖRLER ▲│  Toolbar + tag chips + shelves  │
 *   │ 📁 Klasik14│                                 │
 *   │ 📁 Modern17│                                 │
 *   │ + Yeni     │                                 │
 *   └────────────┴─────────────────────────────────┘
 *
 * Her klasör satırı:
 *   - Folder ikonu + renk noktası + ad + count badge
 *   - Tıkla → o klasörü filtre olarak seç
 *   - Hover → 3-nokta menü (yeniden adlandır / sil)
 *   - Drag-drop hedefi (`application/x-library-entry` MIME)
 */
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import {
  Plus, Folder, MoreHorizontal, Trash2, Pencil, X,
  ChevronUp, ChevronDown, ChevronRight, Library, FolderPlus,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Collection, LibrarySelection } from "./FolderChips";

interface LibraryFolderColumnProps {
  selection: LibrarySelection;
  onSelectionChange: (s: LibrarySelection) => void;
  /** Bumped by parent after entry add/move so counts re-fetch. */
  refreshKey?: number;
  /** "Tümü" sayısı. */
  totalEntries: number;
}

const LS_KEY = "quilpen_folder_column_open";

export default function LibraryFolderColumn({
  selection,
  onSelectionChange,
  refreshKey = 0,
  totalEntries,
}: LibraryFolderColumnProps) {
  // Default açık. Tercihi localStorage'da tut.
  const [open, setOpen] = useState<boolean>(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(LS_KEY);
    if (stored === "0") setOpen(false);
    else if (stored === "1") setOpen(true);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LS_KEY, open ? "1" : "0");
  }, [open]);

  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  // createDraft: { parentId: string|null, name: string } — null = closed
  const [createDraft, setCreateDraft] = useState<{ parentId: string | null; name: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [hoverDropId, setHoverDropId] = useState<string | null>(null);
  // Expanded parent ids — controls child visibility
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const createInputRef = useRef<HTMLInputElement>(null);

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

  const childrenByParent = useMemo(() => {
    const map = new Map<string, Collection[]>();
    for (const c of collections) {
      if (!c.parentId) continue;
      const arr = map.get(c.parentId) ?? [];
      arr.push(c);
      map.set(c.parentId, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    }
    return map;
  }, [collections]);

  // ── Mutations ─────────────────────────────────────────────────────
  async function createCollection(name: string, parentId: string | null) {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const res = await fetch("/api/library/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, parentId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Oluşturulamadı");
      }
      toast.success(parentId ? "Alt klasör oluşturuldu" : "Klasör oluşturuldu");
      setCreateDraft(null);
      if (parentId) setExpandedIds((p) => new Set(p).add(parentId));
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
    <aside
      className={[
        "flex-shrink-0 border-r border-sandy/60 bg-panel/40 flex flex-col overflow-hidden transition-[width] duration-200",
        open ? "w-[220px]" : "w-[44px]",
      ].join(" ")}
    >
      {/* Header / collapse toggle */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={[
          "flex items-center gap-1.5 px-3 py-2.5 border-b border-sandy/40 text-forest hover:bg-forest/5 transition-colors",
          open ? "justify-between" : "justify-center",
        ].join(" ")}
        title={open ? "Klasörleri gizle" : "Klasörleri göster"}
      >
        {open && (
          <span className="text-[10.5px] tracking-[0.14em] uppercase font-semibold">
            Klasörler
          </span>
        )}
        {open ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <Folder className="h-4 w-4" />
        )}
      </button>

      {open && (
        <div className="flex-1 overflow-y-auto px-2 pt-2 pb-3 space-y-0.5">
          {/* "Tümü" sabit satırı */}
          <button
            type="button"
            onClick={() => onSelectionChange({ kind: "all" })}
            className={[
              "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12.5px] transition-colors text-left",
              selection.kind === "all"
                ? "bg-forest/10 text-ink font-semibold"
                : "text-ink-light hover:bg-forest/5",
            ].join(" ")}
          >
            <Library className="h-3.5 w-3.5 text-forest" />
            <span className="flex-1 truncate">Tüm Kütüphane</span>
            <span className="text-[11px] text-ink-muted tabular-nums">{totalEntries}</span>
          </button>

          {/* Klasör listesi (rekürsif) */}
          {loading ? (
            <div className="text-[11.5px] text-ink-muted italic px-2 py-3">Yükleniyor...</div>
          ) : topLevel.length === 0 && createDraft === null ? (
            <div className="text-[11.5px] text-ink-muted italic px-2 py-3 leading-tight">
              Henüz klasör yok. Aşağıdan yeni klasör oluştur.
            </div>
          ) : (
            <FolderTree
              folders={topLevel}
              childrenByParent={childrenByParent}
              depth={0}
              selection={selection}
              onSelectionChange={onSelectionChange}
              expandedIds={expandedIds}
              setExpandedIds={setExpandedIds}
              editingId={editingId}
              setEditingId={setEditingId}
              editingDraft={editingDraft}
              setEditingDraft={setEditingDraft}
              renameCollection={renameCollection}
              deleteCollection={deleteCollection}
              hoverDropId={hoverDropId}
              setHoverDropId={setHoverDropId}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onCreateChild={(parentId) => setCreateDraft({ parentId, name: "" })}
              createDraft={createDraft}
              setCreateDraft={setCreateDraft}
              createCollection={createCollection}
            />
          )}

          {/* Yeni TOP-LEVEL klasör oluşturma (root için) */}
          {createDraft !== null && createDraft.parentId === null ? (
            <div className="flex items-center gap-1.5 px-2 py-1.5 mt-1">
              <Folder className="h-3.5 w-3.5 text-gold-dark/50 flex-shrink-0" />
              <input
                ref={createInputRef}
                value={createDraft.name}
                autoFocus
                placeholder="Klasör adı..."
                onChange={(e) => setCreateDraft({ parentId: null, name: e.target.value })}
                onBlur={() => {
                  if (createDraft.name.trim()) createCollection(createDraft.name, null);
                  else setCreateDraft(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createCollection(createDraft.name, null);
                  else if (e.key === "Escape") setCreateDraft(null);
                }}
                className="flex-1 bg-elevated border border-forest/30 rounded px-1.5 py-0.5 text-[12px] outline-none focus:border-forest"
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
            createDraft === null && (
              <button
                type="button"
                onClick={() => setCreateDraft({ parentId: null, name: "" })}
                className="w-full flex items-center gap-2 px-2 py-1.5 mt-1 rounded-md text-[12px] text-ink-muted hover:text-ink hover:bg-forest/5 transition-colors text-left"
              >
                <Plus className="h-3.5 w-3.5" />
                Yeni klasör
              </button>
            )
          )}
        </div>
      )}

      {/* Kapalı durum: sadece + butonu (klasör eklemek için) */}
      {!open && (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setCreateDraft({ parentId: null, name: "" });
          }}
          className="mt-2 mx-auto p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-forest/5 transition-colors"
          title="Yeni klasör"
        >
          <Plus className="h-4 w-4" />
        </button>
      )}
    </aside>
  );
}

// ── Recursive folder tree ────────────────────────────────────────────
interface FolderTreeProps {
  folders: Collection[];
  childrenByParent: Map<string, Collection[]>;
  depth: number;
  selection: LibrarySelection;
  onSelectionChange: (s: LibrarySelection) => void;
  expandedIds: Set<string>;
  setExpandedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  editingId: string | null;
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>;
  editingDraft: string;
  setEditingDraft: React.Dispatch<React.SetStateAction<string>>;
  renameCollection: (id: string, name: string, original: string) => Promise<void>;
  deleteCollection: (c: Collection) => Promise<void>;
  hoverDropId: string | null;
  setHoverDropId: React.Dispatch<React.SetStateAction<string | null>>;
  onDragOver: (id: string, ev: React.DragEvent) => void;
  onDrop: (id: string, ev: React.DragEvent) => Promise<void>;
  onCreateChild: (parentId: string) => void;
  createDraft: { parentId: string | null; name: string } | null;
  setCreateDraft: React.Dispatch<React.SetStateAction<{ parentId: string | null; name: string } | null>>;
  createCollection: (name: string, parentId: string | null) => Promise<void>;
}

function FolderTree(p: FolderTreeProps) {
  return (
    <>
      {p.folders.map((c) => {
        const isActive =
          p.selection.kind === "collection" && p.selection.collectionId === c.id;
        const isHoverDrop = p.hoverDropId === c.id;
        const isEditing = p.editingId === c.id;
        const children = p.childrenByParent.get(c.id) ?? [];
        const hasChildren = children.length > 0;
        const isExpanded = p.expandedIds.has(c.id);
        const showCreateChildInput =
          p.createDraft !== null && p.createDraft.parentId === c.id;

        return (
          <div key={c.id}>
            <div
              onDragOver={(e) => p.onDragOver(c.id, e)}
              onDragLeave={() => p.setHoverDropId((id) => (id === c.id ? null : id))}
              onDrop={(e) => p.onDrop(c.id, e)}
              style={{ paddingLeft: 6 + p.depth * 18 }}
              className={[
                "group flex items-center gap-1 pr-1.5 py-1.5 rounded-md text-[12.5px] transition-colors relative",
                isActive
                  ? "bg-forest/10 text-ink font-semibold"
                  : "text-ink-light hover:bg-forest/5",
                isHoverDrop ? "ring-2 ring-gold bg-gold/10" : "",
              ].join(" ")}
            >
              {/* Vertical tree line for nested levels */}
              {p.depth > 0 && (
                <span
                  className="absolute top-0 bottom-0 w-px bg-sandy/70 pointer-events-none"
                  style={{ left: 6 + (p.depth - 1) * 18 + 7 }}
                />
              )}

              {/* Expand/collapse chevron — sadece çocuğu varsa görünür */}
              {hasChildren ? (
                <button
                  type="button"
                  onClick={() => {
                    p.setExpandedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(c.id)) next.delete(c.id);
                      else next.add(c.id);
                      return next;
                    });
                  }}
                  className="p-0.5 -ml-1 text-ink-muted hover:text-ink"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                </button>
              ) : (
                <span className="w-3 -ml-1" />
              )}

              {isEditing ? (
                <>
                  <Folder className="h-3.5 w-3.5 flex-shrink-0 text-gold-dark/70" />
                  <input
                    value={p.editingDraft}
                    autoFocus
                    onChange={(e) => p.setEditingDraft(e.target.value)}
                    onBlur={() => p.renameCollection(c.id, p.editingDraft, c.name)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") p.renameCollection(c.id, p.editingDraft, c.name);
                      else if (e.key === "Escape") p.setEditingId(null);
                    }}
                    className="flex-1 bg-elevated border border-forest/30 rounded px-1.5 py-0.5 text-[12px] outline-none focus:border-forest"
                  />
                </>
              ) : (
                <>
                  {/* Tıklanabilir asıl alan — sadece selection toggle eder */}
                  <button
                    type="button"
                    onClick={() => p.onSelectionChange({ kind: "collection", collectionId: c.id })}
                    className="flex-1 flex items-center gap-1.5 min-w-0 text-left cursor-pointer"
                  >
                    <Folder
                      className={[
                        "h-3.5 w-3.5 flex-shrink-0",
                        isActive ? "text-forest" : "text-gold-dark/70",
                      ].join(" ")}
                    />
                    {c.color && (
                      <span
                        className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                        style={{ background: c.color }}
                      />
                    )}
                    <span className="flex-1 truncate ml-0.5">{c.name}</span>
                    <span className="text-[11px] text-ink-muted tabular-nums">
                      {c.entryCount}
                    </span>
                  </button>
                  {/* Hızlı sub-folder ekleme butonu — sibling, row select etmez */}
                  <button
                    type="button"
                    onClick={() => {
                      p.onCreateChild(c.id);
                      p.setExpandedIds((prev) => new Set(prev).add(c.id));
                    }}
                    className="p-0.5 rounded text-ink-muted/60 hover:text-forest hover:bg-forest/10 transition-colors"
                    title="Alt klasör ekle"
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <button
                          type="button"
                          className="p-0.5 rounded text-ink-muted/60 hover:text-ink hover:bg-ink/10 transition-colors"
                          aria-label="Klasör menüsü"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      }
                    />
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => {
                          p.setEditingId(c.id);
                          p.setEditingDraft(c.name);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5 mr-2" />
                        Yeniden adlandır
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => p.deleteCollection(c)}
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

            {/* Inline alt klasör input — bu klasörün altına */}
            {showCreateChildInput && p.createDraft && (
              <div
                style={{ paddingLeft: 8 + (p.depth + 1) * 14 + 12 }}
                className="flex items-center gap-1.5 py-1.5 mt-0.5 pr-2"
              >
                <Folder className="h-3.5 w-3.5 text-gold-dark/50 flex-shrink-0" />
                <input
                  value={p.createDraft.name}
                  autoFocus
                  placeholder="Alt klasör adı..."
                  onChange={(e) =>
                    p.setCreateDraft({ parentId: c.id, name: e.target.value })
                  }
                  onBlur={() => {
                    if (p.createDraft?.name.trim())
                      p.createCollection(p.createDraft.name, c.id);
                    else p.setCreateDraft(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && p.createDraft)
                      p.createCollection(p.createDraft.name, c.id);
                    else if (e.key === "Escape") p.setCreateDraft(null);
                  }}
                  className="flex-1 bg-elevated border border-forest/30 rounded px-1.5 py-0.5 text-[12px] outline-none focus:border-forest"
                />
                <button
                  type="button"
                  onClick={() => p.setCreateDraft(null)}
                  className="p-0.5 rounded hover:bg-ink/10"
                >
                  <X className="h-3 w-3 text-ink-muted" />
                </button>
              </div>
            )}

            {/* Çocuk klasörler (rekürsif) */}
            {hasChildren && isExpanded && (
              <FolderTree {...p} folders={children} depth={p.depth + 1} />
            )}
          </div>
        );
      })}
    </>
  );
}
