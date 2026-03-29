"use client";

import { useState } from "react";
import { Loader2, ImageIcon, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Patch helper
// ---------------------------------------------------------------------------

async function patchImage(
  projectId: string,
  imageId: string,
  payload: { chapterId?: string | null; sortOrder?: number }
): Promise<boolean> {
  const res = await fetch(
    `/api/projects/${projectId}/preview/images/${imageId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  return res.ok;
}

// ---------------------------------------------------------------------------
// Image card with hover overlay
// ---------------------------------------------------------------------------

function ImageCard({
  img,
  chapters,
  projectId,
  onUpdate,
  onDelete,
  onMoveUp,
  canMoveUp,
}: {
  img: SceneImage;
  chapters: ChapterInfo[];
  projectId: string;
  onUpdate: () => void;
  onDelete: (id: string) => void;
  onMoveUp: (id: string) => void;
  canMoveUp: boolean;
}) {
  const [chapterOpen, setChapterOpen] = useState(false);

  async function handleAssignChapter(chapterId: string | null) {
    setChapterOpen(false);
    const ok = await patchImage(projectId, img.id, { chapterId });
    if (ok) {
      toast.success(chapterId ? "Chapter assigned" : "Chapter removed");
      onUpdate();
    } else {
      toast.error("Failed to assign chapter");
    }
  }

  return (
    <div className="rounded-md overflow-hidden border border-[#d4c9b5]/40 bg-white/50 group relative">
      {/* Image */}
      <div className="relative">
        <img
          src={img.url}
          alt={img.prompt.slice(0, 50)}
          className="w-full aspect-[4/3] object-cover"
          loading="lazy"
        />

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors opacity-0 group-hover:opacity-100 flex flex-col justify-between p-1.5">
          {/* Top row: move up + delete */}
          <div className="flex items-start justify-between">
            {canMoveUp ? (
              <button
                onClick={() => onMoveUp(img.id)}
                className="p-1 bg-white/80 rounded text-[#5C4A32] hover:bg-white transition-colors"
                title="Move up"
              >
                <ChevronUp className="h-3 w-3" />
              </button>
            ) : (
              <div />
            )}
            <button
              onClick={() => onDelete(img.id)}
              className="p-1 bg-red-500/80 rounded text-white hover:bg-red-600 transition-colors"
              title="Delete image"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>

          {/* Bottom: chapter assignment */}
          <div className="relative">
            {chapterOpen ? (
              <div className="bg-white rounded border border-[#d4c9b5]/60 p-1 shadow-md max-h-32 overflow-y-auto">
                <button
                  onClick={() => handleAssignChapter(null)}
                  className="w-full text-left font-ui text-[10px] px-1.5 py-1 hover:bg-[#f5f0e8] rounded transition-colors"
                >
                  No chapter
                </button>
                {chapters.map((ch) => (
                  <button
                    key={ch.id}
                    onClick={() => handleAssignChapter(ch.id)}
                    className="w-full text-left font-ui text-[10px] px-1.5 py-1 hover:bg-[#f5f0e8] rounded truncate transition-colors"
                  >
                    Ch {ch.number}: {ch.title}
                  </button>
                ))}
              </div>
            ) : (
              <button
                onClick={() => setChapterOpen(true)}
                className="flex items-center gap-1 w-full bg-black/50 hover:bg-black/60 rounded px-1.5 py-1 transition-colors"
              >
                <span className="font-ui text-[10px] text-white truncate flex-1 text-left">
                  {img.chapter
                    ? `Ch ${img.chapter.number}: ${img.chapter.title}`
                    : "Unassigned"}
                </span>
                <ChevronDown className="h-3 w-3 text-white/80 shrink-0" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ScenePanel({
  images,
  chapters,
  projectId,
  isLoading,
  onUpdate,
}: ScenePanelProps) {
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

  async function handleDelete(imageId: string) {
    if (!confirm("Delete this image?")) return;
    try {
      const res = await fetch(
        `/api/projects/${projectId}/preview/images/${imageId}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        toast.success("Image deleted");
        onUpdate();
      } else {
        toast.error("Failed to delete");
      }
    } catch {
      toast.error("Failed to delete");
    }
  }

  async function handleMoveUp(imageId: string) {
    const sceneImgs = images
      .filter((img) => img.sortOrder >= 0)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const idx = sceneImgs.findIndex((img) => img.id === imageId);
    if (idx <= 0) return;

    const prev = sceneImgs[idx - 1];
    const current = sceneImgs[idx];

    try {
      await Promise.all([
        patchImage(projectId, current.id, { sortOrder: prev.sortOrder }),
        patchImage(projectId, prev.id, { sortOrder: current.sortOrder }),
      ]);
      onUpdate();
    } catch {
      toast.error("Failed to reorder");
    }
  }

  // Separate covers (sortOrder === -1) from scene images
  const coverImages = images.filter((img) => img.sortOrder === -1);
  const sceneImages = images
    .filter((img) => img.sortOrder >= 0)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  // Group scene images by chapter
  const grouped = new Map<string, { label: string; images: SceneImage[] }>();
  const uncategorized: SceneImage[] = [];

  for (const img of sceneImages) {
    if (img.chapter) {
      const key = `ch-${img.chapter.number}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          label: `Chapter ${img.chapter.number}: ${img.chapter.title}`,
          images: [],
        });
      }
      grouped.get(key)!.images.push(img);
    } else {
      uncategorized.push(img);
    }
  }

  function renderGrid(groupImages: SceneImage[]) {
    return (
      <div className="grid grid-cols-2 gap-2">
        {groupImages.map((img, idx) => (
          <ImageCard
            key={img.id}
            img={img}
            chapters={chapters}
            projectId={projectId}
            onUpdate={onUpdate}
            onDelete={handleDelete}
            onMoveUp={handleMoveUp}
            canMoveUp={idx > 0 || sceneImages.indexOf(img) > 0}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="p-3 space-y-4">
      {/* Book Cover section */}
      {coverImages.length > 0 && (
        <div>
          <h4 className="font-ui text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
            Book Cover
          </h4>
          <div className="grid grid-cols-2 gap-2">
            {coverImages.map((img) => (
              <div
                key={img.id}
                className="rounded-md overflow-hidden border-2 border-[#C9A84C]/50 bg-white/50 relative group"
              >
                <img
                  src={img.url}
                  alt="Book cover"
                  className="w-full aspect-[3/4] object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-start justify-end p-1.5 opacity-0 group-hover:opacity-100">
                  <button
                    onClick={() => handleDelete(img.id)}
                    className="p-1 bg-red-500/80 rounded text-white hover:bg-red-600 transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Chapter groups */}
      {Array.from(grouped.entries()).map(([key, group]) => (
        <div key={key}>
          <h4 className="font-ui text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
            {group.label}
          </h4>
          {renderGrid(group.images)}
        </div>
      ))}

      {/* Unassigned images */}
      {uncategorized.length > 0 && (
        <div>
          <h4 className="font-ui text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
            Unassigned
          </h4>
          {renderGrid(uncategorized)}
        </div>
      )}
    </div>
  );
}
