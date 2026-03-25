"use client";

import { useState } from "react";
import { Loader2, ImageIcon, GripVertical, Trash2, ChevronDown } from "lucide-react";
import { toast } from "sonner";

interface SceneImage {
  id: string;
  prompt: string;
  style: string | null;
  url: string;
  sortOrder: number;
  chapter: { number: number; title: string } | null;
  subsection: { subsectionId: string; title: string } | null;
}

interface ChapterInfo {
  id: string;
  number: number;
  title: string;
}

interface ScenePanelProps {
  images: SceneImage[];
  chapters: ChapterInfo[];
  projectId: string;
  isLoading: boolean;
  onUpdate: () => void;
}

export default function ScenePanel({ images, chapters, projectId, isLoading, onUpdate }: ScenePanelProps) {
  const [assigningId, setAssigningId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        <span className="font-body text-sm">Loading images...</span>
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <ImageIcon className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p className="font-body text-sm">No illustrations yet.</p>
        <p className="font-body text-xs mt-1 opacity-70">
          Ask the AI to generate scenes for your chapters.
        </p>
      </div>
    );
  }

  async function handleAssignChapter(imageId: string, chapterId: string | null) {
    try {
      const res = await fetch(`/api/projects/${projectId}/preview/images/${imageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterId }),
      });
      if (res.ok) {
        toast.success("Image assigned");
        onUpdate();
      }
    } catch {
      toast.error("Failed to assign image");
    }
    setAssigningId(null);
  }

  async function handleDelete(imageId: string) {
    if (!confirm("Delete this image?")) return;
    try {
      await fetch(`/api/projects/${projectId}/preview/images/${imageId}`, { method: "DELETE" });
      toast.success("Image deleted");
      onUpdate();
    } catch {
      toast.error("Failed to delete");
    }
  }

  async function handleMoveUp(imageId: string, currentOrder: number) {
    const prev = images.find((img) => img.sortOrder === currentOrder - 1);
    if (!prev) return;
    try {
      await fetch(`/api/projects/${projectId}/preview/images/${imageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: currentOrder - 1 }),
      });
      await fetch(`/api/projects/${projectId}/preview/images/${prev.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: currentOrder }),
      });
      onUpdate();
    } catch { /* ignore */ }
  }

  // Separate cover from scene images
  const coverImages = images.filter((img) => img.sortOrder === -1);
  const sceneImages = images.filter((img) => img.sortOrder >= 0);

  // Group by chapter
  const grouped = new Map<string, { label: string; chapterId: string; images: SceneImage[] }>();
  const uncategorized: SceneImage[] = [];

  for (const img of sceneImages) {
    if (img.chapter) {
      const key = `ch-${img.chapter.number}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          label: `Chapter ${img.chapter.number}: ${img.chapter.title}`,
          chapterId: key,
          images: [],
        });
      }
      grouped.get(key)!.images.push(img);
    } else {
      uncategorized.push(img);
    }
  }

  function renderImageCard(img: SceneImage) {
    return (
      <div key={img.id} className="rounded-md overflow-hidden border border-[#d4c9b5]/40 bg-white/50 group relative">
        <img src={img.url} alt={img.prompt.slice(0, 50)} className="w-full aspect-[4/3] object-cover" loading="lazy" />

        {/* Overlay controls */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-start justify-between p-1.5 opacity-0 group-hover:opacity-100">
          <button
            onClick={() => handleMoveUp(img.id, img.sortOrder)}
            className="p-1 bg-white/80 rounded text-xs"
            title="Move up"
          >
            <GripVertical className="h-3 w-3" />
          </button>
          <button
            onClick={() => handleDelete(img.id)}
            className="p-1 bg-red-500/80 rounded text-white"
            title="Delete"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>

        {/* Chapter assignment */}
        <div className="px-2 py-1.5 border-t border-[#d4c9b5]/30">
          {assigningId === img.id ? (
            <div className="space-y-1">
              <button
                onClick={() => handleAssignChapter(img.id, null)}
                className="w-full text-left font-ui text-[10px] px-1.5 py-1 hover:bg-muted/50 rounded"
              >
                No chapter
              </button>
              {chapters.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => handleAssignChapter(img.id, ch.id)}
                  className="w-full text-left font-ui text-[10px] px-1.5 py-1 hover:bg-muted/50 rounded truncate"
                >
                  Ch {ch.number}: {ch.title}
                </button>
              ))}
            </div>
          ) : (
            <button
              onClick={() => setAssigningId(img.id)}
              className="flex items-center gap-1 w-full"
            >
              <span className="font-ui text-[10px] text-muted-foreground truncate flex-1 text-left">
                {img.chapter ? `Ch ${img.chapter.number}: ${img.chapter.title}` : "Unassigned"}
              </span>
              <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-4">
      {/* Cover */}
      {coverImages.length > 0 && (
        <div>
          <h4 className="font-ui text-xs font-medium text-muted-foreground mb-2">Book Cover</h4>
          <div className="grid grid-cols-2 gap-2">
            {coverImages.map((img) => (
              <div key={img.id} className="rounded-md overflow-hidden border-2 border-[#C9A84C]/50 bg-white/50 relative group">
                <img src={img.url} alt="Book cover" className="w-full aspect-[3/4] object-cover" loading="lazy" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-start justify-end p-1.5 opacity-0 group-hover:opacity-100">
                  <button onClick={() => handleDelete(img.id)} className="p-1 bg-red-500/80 rounded text-white" title="Delete">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Grouped by chapter */}
      {Array.from(grouped.entries()).map(([key, group]) => (
        <div key={key}>
          <h4 className="font-ui text-xs font-medium text-muted-foreground mb-2">{group.label}</h4>
          <div className="grid grid-cols-2 gap-2">
            {group.images.map(renderImageCard)}
          </div>
        </div>
      ))}

      {/* Unassigned */}
      {uncategorized.length > 0 && (
        <div>
          <h4 className="font-ui text-xs font-medium text-muted-foreground mb-2">Unassigned</h4>
          <div className="grid grid-cols-2 gap-2">
            {uncategorized.map(renderImageCard)}
          </div>
        </div>
      )}
    </div>
  );
}
