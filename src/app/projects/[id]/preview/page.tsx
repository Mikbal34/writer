"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { BookOpen, Users, ImageIcon, Palette } from "lucide-react";
import PreviewChat from "@/components/preview/PreviewChat";
import CharacterPanel from "@/components/preview/CharacterPanel";
import ScenePanel from "@/components/preview/ScenePanel";
import StylePanel from "@/components/preview/StylePanel";
import BookPopup from "@/components/preview/BookPopup";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Tab = "characters" | "scenes" | "style";

interface Character {
  id: string;
  name: string;
  description: string | null;
  visualTraits: string | null;
  referenceData: string | null;
}

interface SceneImage {
  id: string;
  prompt: string;
  style: string | null;
  url: string;
  chapter: { number: number; title: string } | null;
  subsection: { subsectionId: string; title: string } | null;
}

export default function PreviewPage() {
  const params = useParams();
  const projectId = params.id as string;

  const [activeTab, setActiveTab] = useState<Tab>("characters");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [images, setImages] = useState<SceneImage[]>([]);
  const [artStyle, setArtStyle] = useState<string | null>(null);
  const [isLoadingChars, setIsLoadingChars] = useState(true);
  const [isLoadingImages, setIsLoadingImages] = useState(true);
  const [bookOpen, setBookOpen] = useState(false);

  const fetchCharacters = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/preview/characters`);
      if (res.ok) {
        const data = await res.json();
        setCharacters(data);
      }
    } catch {
      // ignore
    } finally {
      setIsLoadingChars(false);
    }
  }, [projectId]);

  const fetchImages = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/preview/images`);
      if (res.ok) {
        const data = await res.json();
        setImages(data);
      }
    } catch {
      // ignore
    } finally {
      setIsLoadingImages(false);
    }
  }, [projectId]);

  const fetchProject = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (res.ok) {
        const data = await res.json();
        const guidelines = data.writingGuidelines as Record<string, unknown> | null;
        if (guidelines?.artStyle) setArtStyle(guidelines.artStyle as string);
      }
    } catch {
      // ignore
    }
  }, [projectId]);

  useEffect(() => {
    fetchCharacters();
    fetchImages();
    fetchProject();
  }, [fetchCharacters, fetchImages, fetchProject]);

  function handleUpdate() {
    fetchCharacters();
    fetchImages();
    fetchProject();
  }

  function handleStyleSelect(style: string) {
    setArtStyle(style);
    toast.info(`Art style set to "${style}". Use the chat to apply it.`);
  }

  // Build book pages for popup
  const bookPages: Array<{
    type: "chapter-cover" | "content" | "image";
    chapterTitle?: string;
    chapterNumber?: number;
    text?: string;
    imageUrl?: string;
    imageCaption?: string;
  }> = [];

  // Group images by chapter for book view
  const imagesByChapter = new Map<number, SceneImage[]>();
  const unlinkedImages: SceneImage[] = [];
  for (const img of images) {
    if (img.chapter) {
      const num = img.chapter.number;
      if (!imagesByChapter.has(num)) imagesByChapter.set(num, []);
      imagesByChapter.get(num)!.push(img);
    } else {
      unlinkedImages.push(img);
    }
  }

  // Build book from chapter-linked images
  for (const [chNum, chImages] of Array.from(imagesByChapter.entries()).sort((a, b) => a[0] - b[0])) {
    const firstImg = chImages[0];
    bookPages.push({
      type: "chapter-cover",
      chapterNumber: chNum,
      chapterTitle: firstImg?.chapter?.title ?? `Chapter ${chNum}`,
    });
    for (const img of chImages) {
      bookPages.push({
        type: "image",
        imageUrl: img.url,
        imageCaption: img.subsection ? `${img.subsection.subsectionId} ${img.subsection.title}` : undefined,
      });
    }
  }

  // Add unlinked images as a gallery
  if (unlinkedImages.length > 0) {
    bookPages.push({
      type: "chapter-cover",
      chapterNumber: 0,
      chapterTitle: "Illustrations",
    });
    for (const img of unlinkedImages) {
      bookPages.push({
        type: "image",
        imageUrl: img.url,
        imageCaption: img.prompt.slice(0, 80),
      });
    }
  }

  const tabs: { key: Tab; label: string; icon: typeof Users }[] = [
    { key: "characters", label: "Characters", icon: Users },
    { key: "scenes", label: "Scenes", icon: ImageIcon },
    { key: "style", label: "Style", icon: Palette },
  ];

  return (
    <div className="flex flex-col lg:flex-row h-full">
      {/* Left: Chat */}
      <div className="lg:w-[40%] lg:min-w-[320px] lg:max-w-[500px] border-r border-[#d4c9b5]/40 flex flex-col h-full">
        <PreviewChat projectId={projectId} onUpdate={handleUpdate} />
      </div>

      {/* Right: Panels */}
      <div className="flex-1 flex flex-col h-full min-w-0">
        {/* Tab bar + Book preview button */}
        <div className="px-4 py-2.5 border-b border-[#d4c9b5]/40 shrink-0 flex items-center justify-between">
          <div className="flex gap-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-ui text-xs transition-colors ${
                    activeTab === tab.key
                      ? "bg-muted text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                  {tab.key === "characters" && characters.length > 0 && (
                    <span className="bg-foreground/10 text-foreground/70 rounded-full px-1.5 text-[10px]">
                      {characters.length}
                    </span>
                  )}
                  {tab.key === "scenes" && images.length > 0 && (
                    <span className="bg-foreground/10 text-foreground/70 rounded-full px-1.5 text-[10px]">
                      {images.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {images.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBookOpen(true)}
              className="h-7 font-ui text-xs gap-1.5"
            >
              <BookOpen className="h-3.5 w-3.5" />
              Book Preview
            </Button>
          )}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === "characters" && (
            <CharacterPanel characters={characters} isLoading={isLoadingChars} />
          )}
          {activeTab === "scenes" && (
            <ScenePanel images={images} isLoading={isLoadingImages} />
          )}
          {activeTab === "style" && (
            <StylePanel currentStyle={artStyle} onStyleSelect={handleStyleSelect} />
          )}
        </div>
      </div>

      {/* Full-screen book popup */}
      <BookPopup pages={bookPages} open={bookOpen} onClose={() => setBookOpen(false)} />
    </div>
  );
}
