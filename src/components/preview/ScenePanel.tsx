"use client";

import { Loader2, ImageIcon } from "lucide-react";

interface SceneImage {
  id: string;
  prompt: string;
  style: string | null;
  url: string;
  chapter: { number: number; title: string } | null;
  subsection: { subsectionId: string; title: string } | null;
}

interface ScenePanelProps {
  images: SceneImage[];
  isLoading: boolean;
}

export default function ScenePanel({ images, isLoading }: ScenePanelProps) {
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

  // Group by chapter
  const grouped = new Map<string, { label: string; images: SceneImage[] }>();
  const uncategorized: SceneImage[] = [];

  for (const img of images) {
    if (img.chapter) {
      const key = `ch-${img.chapter.number}`;
      if (!grouped.has(key)) {
        grouped.set(key, { label: `Chapter ${img.chapter.number}: ${img.chapter.title}`, images: [] });
      }
      grouped.get(key)!.images.push(img);
    } else {
      uncategorized.push(img);
    }
  }

  return (
    <div className="p-3 space-y-4">
      {Array.from(grouped.entries()).map(([key, group]) => (
        <div key={key}>
          <h4 className="font-ui text-xs font-medium text-muted-foreground mb-2">{group.label}</h4>
          <div className="grid grid-cols-2 gap-2">
            {group.images.map((img) => (
              <div key={img.id} className="rounded-md overflow-hidden border border-[#d4c9b5]/40 bg-white/50 group">
                <img src={img.url} alt={img.prompt.slice(0, 50)} className="w-full aspect-[4/3] object-cover" loading="lazy" />
                {img.subsection && (
                  <p className="font-ui text-[10px] text-muted-foreground px-2 py-1 truncate">
                    {img.subsection.subsectionId} {img.subsection.title}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {uncategorized.length > 0 && (
        <div>
          <h4 className="font-ui text-xs font-medium text-muted-foreground mb-2">Other</h4>
          <div className="grid grid-cols-2 gap-2">
            {uncategorized.map((img) => (
              <div key={img.id} className="rounded-md overflow-hidden border border-[#d4c9b5]/40 bg-white/50">
                <img src={img.url} alt={img.prompt.slice(0, 50)} className="w-full aspect-[4/3] object-cover" loading="lazy" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
