"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Users, ImageIcon, Palette } from "lucide-react";
import PreviewChat from "@/components/preview/PreviewChat";
import CharacterPanel from "@/components/preview/CharacterPanel";
import ScenePanel from "@/components/preview/ScenePanel";
import StylePanel from "@/components/preview/StylePanel";
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
  sortOrder: number;
  chapter: { number: number; title: string } | null;
  subsection: { subsectionId: string; title: string } | null;
}

interface SubsectionData {
  id: string;
  subsectionId: string;
  title: string;
  content: string | null;
}

interface ChapterData {
  id: string;
  number: number;
  title: string;
  subsections: SubsectionData[];
}

export default function PreviewPage() {
  const params = useParams();
  const projectId = params.id as string;

  const [activeTab, setActiveTab] = useState<Tab>("characters");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [images, setImages] = useState<SceneImage[]>([]);
  const [chapters, setChapters] = useState<ChapterData[]>([]);
  const [projectTitle, setProjectTitle] = useState<string>("Untitled Book");
  const [artStyle, setArtStyle] = useState<string | null>(null);
  const [isLoadingChars, setIsLoadingChars] = useState(true);
  const [isLoadingImages, setIsLoadingImages] = useState(true);

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
      const [projRes, roadmapRes] = await Promise.all([
        fetch(`/api/projects/${projectId}`),
        fetch(`/api/projects/${projectId}/roadmap`),
      ]);

      if (projRes.ok) {
        const data = await projRes.json();
        if (data.title) setProjectTitle(data.title);
        const guidelines = data.writingGuidelines as Record<string, unknown> | null;
        if (guidelines?.artStyle) setArtStyle(guidelines.artStyle as string);
      }

      if (roadmapRes.ok) {
        const data = await roadmapRes.json();

        type RawSub = { id: string; subsectionId: string; title: string; content?: string | null };
        type RawSec = { subsections?: RawSub[] };
        type RawCh = {
          id: string;
          number: number;
          title: string;
          sections?: RawSec[];
        };

        const rawChapters: RawCh[] = data.chapters ?? [];

        const builtChapters: ChapterData[] = rawChapters.map((ch) => {
          const flatSubs: SubsectionData[] = [];
          for (const sec of ch.sections ?? []) {
            for (const sub of sec.subsections ?? []) {
              flatSubs.push({
                id: sub.id,
                subsectionId: sub.subsectionId,
                title: sub.title,
                content: sub.content ?? null,
              });
            }
          }
          return {
            id: ch.id,
            number: ch.number,
            title: ch.title,
            subsections: flatSubs,
          };
        });

        setChapters(builtChapters);
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

  // Flat chapters list for ScenePanel
  const chaptersList = chapters.map((ch) => ({
    id: ch.id,
    number: ch.number,
    title: ch.title,
  }));

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
        {/* Tab bar */}
        <div className="px-4 py-2.5 border-b border-[#d4c9b5]/40 shrink-0 flex items-center">
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
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === "characters" && (
            <CharacterPanel characters={characters} isLoading={isLoadingChars} />
          )}
          {activeTab === "scenes" && (
            <ScenePanel
              images={images}
              chapters={chaptersList}
              projectId={projectId}
              isLoading={isLoadingImages}
              onUpdate={handleUpdate}
            />
          )}
          {activeTab === "style" && (
            <StylePanel currentStyle={artStyle} onStyleSelect={handleStyleSelect} />
          )}
        </div>
      </div>

    </div>
  );
}
