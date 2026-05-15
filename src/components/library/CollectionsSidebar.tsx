"use client";

/**
 * Left-pane folder + tag picker for the new three-pane library layout.
 *
 * - Fetches `/api/library/collections` once on mount, builds the tree
 *   client-side from `parentId`. Re-fetches after every mutation.
 * - Click → tells the parent to filter the middle list by the picked
 *   collection (or tag, or "All"). The parent owns the canonical
 *   selection state — this component is purely visual + dispatch.
 * - Right-click → context menu with Rename / New sub-folder / Color /
 *   Delete.
 * - Drag-and-drop: middle pane drops an entryId on a folder via the
 *   HTML5 dnd API ("application/x-library-entry" MIME). When a drop
 *   lands here we hit `POST /api/library/collections/[id]/entries`.
 *
 * Color tokens follow the project theme — ink #2D1F0E, gold #C9A84C,
 * border #d4c9b5, parchment #FAF7F0.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Plus,
  Library,
  Tag as TagIcon,
  MoreHorizontal,
  Pencil,
  Trash2,
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

export interface Tag {
  id: string;
  name: string;
  count?: number;
}

export type LibrarySelection =
  | { kind: "all" }
  | { kind: "collection"; collectionId: string }
  | { kind: "tag"; tagId: string };

interface CollectionsSidebarProps {
  /** Current filter selection (parent-owned). */
  selection: LibrarySelection;
  onSelectionChange: (s: LibrarySelection) => void;
  /** Tags for the chip list under the folder tree. */
  tags: Tag[];
  /** Bumped whenever the parent wants the sidebar to refetch (e.g. after
   *  adding an entry to a folder via drag-drop, the parent re-fetches
   *  and increments this). */
  refreshKey?: number;
}

// Internal: a tree row with depth + expanded state + children resolved.
interface TreeNode extends Collection {
  depth: number;
  children: TreeNode[];
}

function buildTree(rows: Collection[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const r of rows) byId.set(r.id, { ...r, depth: 0, children: [] });
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      const parent = byId.get(node.parentId)!;
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sort = (arr: TreeNode[]) => {
    arr.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    for (const n of arr) sort(n.children);
  };
  sort(roots);
  // Fix depths in case of detached subtrees from the BFS pass above.
  const fix = (n: TreeNode, d: number) => {
    n.depth = d;
    for (const c of n.children) fix(c, d + 1);
  };
  for (const r of roots) fix(r, 0);
  return roots;
}

export default function CollectionsSidebar({
  selection,
  onSelectionChange,
  tags,
  refreshKey = 0,
}: CollectionsSidebarProps) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [hoverDropId, setHoverDropId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
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
    fetchAll();
  }, [fetchAll, refreshKey]);

  const tree = useMemo(() => buildTree(collections), [collections]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createCollection(parentId: string | null) {
    const name = window.prompt(
      parentId ? "Yeni alt-klasör adı:" : "Yeni klasör adı:",
    );
    if (!name?.trim()) return;
    try {
      const res = await fetch("/api/library/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), parentId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Oluşturulamadı");
      }
      if (parentId) setExpanded((prev) => new Set(prev).add(parentId));
      toast.success("Klasör oluşturuldu");
      await fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Oluşturulamadı");
    }
  }

  async function renameCollection(c: Collection) {
    const name = window.prompt("Yeni ad:", c.name);
    if (!name?.trim() || name.trim() === c.name) return;
    try {
      const res = await fetch(`/api/library/collections/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) throw new Error();
      toast.success("Yeniden adlandırıldı");
      await fetchAll();
    } catch {
      toast.error("Yeniden adlandırılamadı");
    }
  }

  async function deleteCollection(c: Collection) {
    const ok = window.confirm(
      `"${c.name}" silinsin mi? Alt klasörleri de silinir. İçindeki kitaplara dokunulmaz.`,
    );
    if (!ok) return;
    try {
      const res = await fetch(`/api/library/collections/${c.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      toast.success("Klasör silindi");
      if (selection.kind === "collection" && selection.collectionId === c.id) {
        onSelectionChange({ kind: "all" });
      }
      await fetchAll();
    } catch {
      toast.error("Silinemedi");
    }
  }

  async function dropOnCollection(collectionId: string, ev: React.DragEvent) {
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
      await fetchAll();
    } catch {
      toast.error("Klasöre eklenemedi");
    }
  }

  function onDragOver(collectionId: string, ev: React.DragEvent) {
    if (ev.dataTransfer.types.includes("application/x-library-entry")) {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "copy";
      setHoverDropId(collectionId);
    }
  }

  function renderNode(node: TreeNode): React.ReactNode {
    const isExpanded = expanded.has(node.id);
    const isSelected =
      selection.kind === "collection" && selection.collectionId === node.id;
    const isDropHover = hoverDropId === node.id;
    return (
      <div key={node.id}>
        <div
          className={`group flex items-center gap-1 pr-2 py-1 rounded-sm cursor-pointer transition-colors ${
            isSelected
              ? "bg-[#C9A84C]/20 text-[#2D1F0E]"
              : isDropHover
                ? "bg-[#C9A84C]/30"
                : "hover:bg-[#FAF7F0]"
          }`}
          style={{ paddingLeft: 8 + node.depth * 14 }}
          onClick={() => onSelectionChange({ kind: "collection", collectionId: node.id })}
          onDragOver={(e) => onDragOver(node.id, e)}
          onDragLeave={() => setHoverDropId(null)}
          onDrop={(e) => dropOnCollection(node.id, e)}
        >
          {node.childCount > 0 ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(node.id);
              }}
              className="text-[#8a7a65] shrink-0"
              aria-label={isExpanded ? "Daralt" : "Genişlet"}
            >
              {isExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </button>
          ) : (
            <span className="w-3 shrink-0" />
          )}
          {isExpanded ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[#C9A84C]" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-[#C9A84C]/80" />
          )}
          <span className="font-body text-sm flex-1 truncate">{node.name}</span>
          {node.entryCount > 0 && (
            <span className="font-ui text-[10px] text-[#8a7a65] tabular-nums">
              {node.entryCount}
            </span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              onClick={(e) => e.stopPropagation()}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-[#8a7a65] hover:text-[#2D1F0E]"
              aria-label="Klasör menüsü"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-44 bg-[#FAF7F0] border-[#d4c9b5]"
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  renameCollection(node);
                }}
                className="gap-2 text-xs text-[#2D1F0E]"
              >
                <Pencil className="h-3 w-3" /> Yeniden adlandır
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  createCollection(node.id);
                }}
                className="gap-2 text-xs text-[#2D1F0E]"
              >
                <Plus className="h-3 w-3" /> Alt klasör
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  deleteCollection(node);
                }}
                className="gap-2 text-xs text-red-700 focus:text-red-700 focus:bg-red-50"
              >
                <Trash2 className="h-3 w-3" /> Sil
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {isExpanded && node.children.length > 0 && (
          <div>{node.children.map(renderNode)}</div>
        )}
      </div>
    );
  }

  return (
    <aside className="h-full w-[280px] shrink-0 border-r border-[#d4c9b5] bg-[#FAF7F0]/60 flex flex-col">
      {/* All-library pseudo row */}
      <div
        className={`px-3 py-2 cursor-pointer flex items-center gap-2 ${
          selection.kind === "all"
            ? "bg-[#C9A84C]/20"
            : "hover:bg-[#FAF7F0]"
        }`}
        onClick={() => onSelectionChange({ kind: "all" })}
      >
        <Library className="h-4 w-4 text-[#C9A84C]" />
        <span className="font-display text-sm font-semibold text-[#2D1F0E]">
          Tüm Kütüphane
        </span>
      </div>

      <div className="h-px bg-[#d4c9b5]/60" />

      {/* Folders */}
      <div className="px-2 py-2 flex items-center justify-between">
        <span className="font-ui text-[10px] uppercase tracking-widest text-[#8a7a65]">
          Klasörler
        </span>
        <button
          type="button"
          onClick={() => createCollection(null)}
          title="Yeni klasör"
          className="text-[#8a7a65] hover:text-[#2D1F0E]"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="px-1 flex-1 overflow-y-auto pb-2">
        {loading ? (
          <div className="px-3 py-2 font-body text-xs text-[#8a7a65]">
            Yükleniyor...
          </div>
        ) : tree.length === 0 ? (
          <div className="px-3 py-2 font-body text-xs text-[#8a7a65] italic">
            Henüz klasör yok. + ile oluştur.
          </div>
        ) : (
          tree.map(renderNode)
        )}
      </div>

      {/* Tags */}
      {tags.length > 0 && (
        <div className="border-t border-[#d4c9b5]/60 px-2 py-3">
          <div className="font-ui text-[10px] uppercase tracking-widest text-[#8a7a65] mb-2 px-1">
            Etiketler
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => {
              const isActive =
                selection.kind === "tag" && selection.tagId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() =>
                    onSelectionChange(
                      isActive
                        ? { kind: "all" }
                        : { kind: "tag", tagId: t.id },
                    )
                  }
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-sm font-ui text-[11px] transition-colors ${
                    isActive
                      ? "bg-[#2D1F0E] text-[#F5EDE0]"
                      : "bg-[#e8dfd0] text-[#5C4A32] hover:bg-[#d4c9b5]/70"
                  }`}
                >
                  <TagIcon className="h-2.5 w-2.5" />
                  {t.name}
                  {typeof t.count === "number" && t.count > 0 && (
                    <span className="opacity-70">{t.count}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}
