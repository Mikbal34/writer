"use client";

/**
 * Horizontal folder filter row used at the top of the library page.
 *
 * Replaces the old 280px CollectionsSidebar. The row holds:
 *   - A pinned "Tüm Kütüphane" chip (default selection)
 *   - One chip per top-level user collection with live entry count
 *   - A `[＋ klasör]` trigger that swaps into an inline input
 *   - A `⋯` overflow menu per chip (rename / delete)
 *   - A trailing `💬 Bu klasöre sor` shortcut when a folder is active
 *
 * Drag-and-drop target: entry cards from LibraryEntryTable carry
 * `application/x-library-entry` (a JSON array of entry IDs); when a
 * chip receives a drop we POST `/api/library/collections/[id]/entries`
 * to add the entries to that collection.
 *
 * v1 ships a FLAT chip list (top-level collections only). The schema
 * already supports `parentId`; deeper hierarchy gets a "Klasörleri
 * yönet" modal in Phase 2.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  Plus,
  Folder,
  MoreHorizontal,
  Trash2,
  Pencil,
  MessageSquare,
  Library,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface Collection {
  id: string;
  parentId: string | null;
  name: string;
  color: string | null;
  sortOrder: number;
  entryCount: number;
  childCount: number;
}

export type LibrarySelection =
  | { kind: "all" }
  | { kind: "collection"; collectionId: string }
  | { kind: "tag"; tagId: string };

interface FolderChipsProps {
  selection: LibrarySelection;
  onSelectionChange: (s: LibrarySelection) => void;
  /** Bumped by the parent after any mutation that may change folder
   *  counts (drag-drop, entry create, etc.) so chips re-fetch. */
  refreshKey?: number;
  /** Total entry count, rendered on the "Tüm Kütüphane" chip. */
  totalEntries: number;
}

export default function FolderChips({
  selection,
  onSelectionChange,
  refreshKey = 0,
  totalEntries,
}: FolderChipsProps) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  // null = create mode hidden; string = current draft name.
  const [createDraft, setCreateDraft] = useState<string | null>(null);
  // Stores the chip id whose rename input is open, plus the in-flight name.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  // Track the chip the user is currently dragging an entry over so we
  // can render a stronger highlight on the drop target.
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

  // Flat first-pass: only top-level collections. Hierarchy lives in a
  // future "Manage collections" modal.
  const topLevel = useMemo(
    () =>
      collections
        .filter((c) => !c.parentId)
        .sort(
          (a, b) =>
            a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
        ),
    [collections],
  );

  // ── Mutations ───────────────────────────────────────────────────

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
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Yeniden adlandırılamadı");
      }
      toast.success("Yeniden adlandırıldı");
      setEditingId(null);
      await fetchCollections();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Yeniden adlandırılamadı",
      );
    }
  }

  async function deleteCollection(c: Collection) {
    if (
      !window.confirm(
        `"${c.name}" klasörü silinsin mi? İçindeki kitaplara dokunulmaz.`,
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/library/collections/${c.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      toast.success("Klasör silindi");
      if (
        selection.kind === "collection" &&
        selection.collectionId === c.id
      ) {
        onSelectionChange({ kind: "all" });
      }
      await fetchCollections();
    } catch {
      toast.error("Silinemedi");
    }
  }

  // ── Drag-drop ───────────────────────────────────────────────────

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
      const res = await fetch(
        `/api/library/collections/${collectionId}/entries`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entryIds }),
        },
      );
      if (!res.ok) throw new Error();
      const data = await res.json();
      toast.success(`${data.added} kaynak klasöre eklendi`);
      await fetchCollections();
    } catch {
      toast.error("Klasöre eklenemedi");
    }
  }

  // ── Render helpers ─────────────────────────────────────────────

  function startCreate() {
    setCreateDraft("");
    requestAnimationFrame(() => createInputRef.current?.focus());
  }

  function startRename(c: Collection) {
    setEditingId(c.id);
    setEditingDraft(c.name);
    requestAnimationFrame(() => editInputRef.current?.select());
  }

  // ── JSX ────────────────────────────────────────────────────────

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* All-library chip */}
      <button
        type="button"
        onClick={() => onSelectionChange({ kind: "all" })}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm font-ui text-xs transition-colors ${
          selection.kind === "all"
            ? "bg-ink text-paper"
            : "bg-page border border-gold/30 text-ink hover:bg-page/70"
        }`}
      >
        <Library className="h-3 w-3" />
        Tüm Kütüphane
        <span
          className={`tabular-nums ${
            selection.kind === "all"
              ? "text-paper/70"
              : "text-ink-light"
          }`}
        >
          {totalEntries}
        </span>
      </button>

      {/* Folder chips */}
      {!loading &&
        topLevel.map((c) => {
          const isSelected =
            selection.kind === "collection" && selection.collectionId === c.id;
          const isHover = hoverDropId === c.id;
          const isEditing = editingId === c.id;

          if (isEditing) {
            return (
              <input
                key={c.id}
                ref={editInputRef}
                value={editingDraft}
                onChange={(e) => setEditingDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    renameCollection(c.id, editingDraft, c.name);
                  }
                  if (e.key === "Escape") setEditingId(null);
                }}
                onBlur={() => renameCollection(c.id, editingDraft, c.name)}
                className="px-3 py-1.5 rounded-sm border border-gold/60 bg-white font-ui text-xs text-ink focus:outline-none focus:border-gold"
              />
            );
          }

          return (
            <button
              key={c.id}
              type="button"
              onClick={() =>
                onSelectionChange({ kind: "collection", collectionId: c.id })
              }
              onDragOver={(e) => onDragOver(c.id, e)}
              onDragLeave={() => setHoverDropId(null)}
              onDrop={(e) => onDrop(c.id, e)}
              className={`group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm font-ui text-xs transition-colors ${
                isSelected
                  ? "bg-ink text-paper"
                  : isHover
                    ? "bg-gold/30 border border-gold"
                    : "bg-page border border-gold/30 text-ink hover:bg-page/70"
              }`}
            >
              <Folder
                className={`h-3 w-3 ${
                  isSelected ? "text-paper" : "text-gold"
                }`}
              />
              {c.name}
              <span
                className={`tabular-nums ${
                  isSelected ? "text-paper/70" : "text-ink-light"
                }`}
              >
                {c.entryCount}
              </span>
              {/* Per-chip overflow menu — only mounted when chip is active
                  so chip rows stay light; rendered as portal so it can
                  escape the row's overflow context. */}
              {isSelected && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    onClick={(e) => e.stopPropagation()}
                    className="ml-1 -mr-1 text-paper/70 hover:text-paper transition-colors"
                    aria-label="Klasör seçenekleri"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-44 bg-page border-sandy"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        startRename(c);
                      }}
                      className="gap-2 text-xs text-ink"
                    >
                      <Pencil className="h-3 w-3" />
                      Yeniden adlandır
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        deleteCollection(c);
                      }}
                      className="gap-2 text-xs text-red-700 focus:text-red-700 focus:bg-red-50"
                    >
                      <Trash2 className="h-3 w-3" />
                      Sil
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </button>
          );
        })}

      {/* Create chip — turns into an inline input when active */}
      {createDraft === null ? (
        <button
          type="button"
          onClick={startCreate}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-sm font-ui text-xs text-ink-light border border-dashed border-sandy hover:border-gold hover:text-ink transition-colors"
        >
          <Plus className="h-3 w-3" />
          klasör
        </button>
      ) : (
        <input
          ref={createInputRef}
          value={createDraft}
          onChange={(e) => setCreateDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (createDraft.trim()) createCollection(createDraft);
            }
            if (e.key === "Escape") setCreateDraft(null);
          }}
          onBlur={() => {
            if (createDraft && createDraft.trim()) createCollection(createDraft);
            else setCreateDraft(null);
          }}
          placeholder="Klasör adı..."
          className="px-3 py-1.5 rounded-sm border border-gold/60 bg-white font-ui text-xs text-ink placeholder:text-ink-muted focus:outline-none focus:border-gold"
        />
      )}

      {/* "Ask this folder" affordance — only when a folder is active */}
      {selection.kind === "collection" && (
        <Link
          href={`/library/ask?collectionId=${selection.collectionId}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm font-ui text-xs text-ink-light hover:text-ink hover:bg-page transition-colors ml-auto"
        >
          <MessageSquare className="h-3 w-3" />
          Bu klasöre sor
        </Link>
      )}
    </div>
  );
}
