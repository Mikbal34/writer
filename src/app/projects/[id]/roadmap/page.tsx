"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  Panel,
  Group as PanelGroup,
  Separator as PanelResizeHandle,
} from "react-resizable-panels";
import {
  Save,
  Loader2,
  AlertCircle,
  Bot,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import StructureTree from "@/components/roadmap/StructureTree";
import RoadmapChat from "@/components/roadmap/RoadmapChat";
import { Ornament, PageNumber } from "@/components/shared/BookElements";
import { FadeUp, FadeIn } from "@/components/shared/Animations";
import type { ChapterWithSections } from "@/types/project";

export default function RoadmapPage() {
  const params = useParams();
  const projectId = params.id as string;

  const [chapters, setChapters] = useState<ChapterWithSections[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setIsMobile(window.innerWidth < 768);
    setMounted(true);
    const mq = window.matchMedia("(max-width: 767px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const fetchRoadmap = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/roadmap`);
      if (!res.ok) throw new Error("Failed to load roadmap");
      const data = await res.json();
      setChapters(data.chapters ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load roadmap");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchRoadmap();
  }, [fetchRoadmap]);

  async function handleSave() {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/roadmap`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roadmap: { chapters } }),
      });
      if (!res.ok) throw new Error("Failed to save roadmap");
      setHasUnsavedChanges(false);
      toast.success("Roadmap saved.");
    } catch {
      toast.error("Failed to save roadmap");
    } finally {
      setIsSaving(false);
    }
  }

  function handleChaptersChange(updated: ChapterWithSections[]) {
    setChapters(updated);
    setHasUnsavedChanges(true);
  }

  const roadmapContent = (
    <div className="h-full overflow-y-auto px-6 py-8">
      {/* Header */}
      <FadeUp className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold text-ink">
            Book Roadmap
          </h1>
          <p className="font-body text-sm text-muted-foreground mt-1">
            Your book&apos;s structure — chapters, sections, and subsections.
            Click any title to edit it inline.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {hasUnsavedChanges && (
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2 border border-[#d4c9b5] rounded-sm font-ui text-sm text-ink hover:bg-[#e8dfd0]/30 disabled:opacity-50 transition-colors"
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save Changes
            </button>
          )}
        </div>
      </FadeUp>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 mb-6 px-4 py-3 border border-red-200 bg-red-50 rounded-sm text-red-700 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-forest" />
          <p className="text-sm text-muted-foreground">Loading roadmap...</p>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && chapters.length === 0 && <EmptyRoadmap />}

      {/* Ornament + Tree */}
      {!isLoading && chapters.length > 0 && (
        <>
          <Ornament className="w-40 mx-auto text-[#c9bfad] mb-6" />
          <StructureTree
            projectId={projectId}
            chapters={chapters}
            onChaptersChange={handleChaptersChange}
          />
        </>
      )}

      {/* Footer stats */}
      {!isLoading && chapters.length > 0 && (
        <>
          <FadeIn delay={0.3} className="mt-6 flex items-center gap-4 font-ui text-sm text-muted-foreground">
            <span>
              {chapters.length} chapter{chapters.length !== 1 ? "s" : ""}
            </span>
            <span>&middot;</span>
            <span>
              {chapters.flatMap((c) => c.sections).length} sections
            </span>
            <span>&middot;</span>
            <span>
              {chapters
                .flatMap((c) => c.sections)
                .flatMap((s) => s.subsections).length}{" "}
              subsections
            </span>
            <span>&middot;</span>
            <span>
              ~
              {chapters.reduce(
                (acc, c) => acc + (c.estimatedPages ?? 0),
                0
              )}{" "}
              estimated pages
            </span>
          </FadeIn>
          <PageNumber number="iv" />
        </>
      )}
    </div>
  );

  // Loading skeleton while detecting viewport
  if (!mounted) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-forest" />
      </div>
    );
  }

  // Mobile: Tab layout
  if (isMobile) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <Tabs defaultValue="chat" className="flex flex-col h-full">
          <TabsList className="w-full shrink-0 rounded-none bg-[#F5F0E6] border-b border-[#d4c9b5]/40">
            <TabsTrigger
              value="chat"
              className="flex-1 font-ui text-sm data-[state=active]:text-forest data-[state=active]:border-b-2 data-[state=active]:border-forest"
            >
              Chat
            </TabsTrigger>
            <TabsTrigger
              value="roadmap"
              className="flex-1 font-ui text-sm data-[state=active]:text-forest data-[state=active]:border-b-2 data-[state=active]:border-forest"
            >
              Roadmap
            </TabsTrigger>
          </TabsList>
          <TabsContent value="chat" className="flex-1 min-h-0 mt-0">
            <RoadmapChat projectId={projectId} onRoadmapUpdate={fetchRoadmap} />
          </TabsContent>
          <TabsContent value="roadmap" className="flex-1 min-h-0 overflow-y-auto mt-0">
            {roadmapContent}
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  // Desktop: Resizable panels
  return (
    <div style={{ height: "100%", overflow: "hidden" }}>
      <PanelGroup
        orientation="horizontal"
        defaultLayout={{ chat: 40, roadmap: 60 }}
      >
        <Panel id="chat" minSize="20%" maxSize="60%">
          <RoadmapChat projectId={projectId} onRoadmapUpdate={fetchRoadmap} />
        </Panel>
        <PanelResizeHandle
          style={{ width: 6, flexShrink: 0 }}
          className="bg-[#d4c9b5]/40 hover:bg-[#d4c9b5] transition-colors cursor-col-resize"
        >
          <div className="h-full w-px mx-auto bg-[#d4c9b5]" />
        </PanelResizeHandle>
        <Panel id="roadmap" minSize="30%">
          {roadmapContent}
        </Panel>
      </PanelGroup>
    </div>
  );
}

function EmptyRoadmap() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#e8dfd0] mb-5">
        <Bot className="h-8 w-8 text-forest" />
      </div>
      <h2 className="font-display text-xl font-semibold mb-2">
        Build your roadmap
      </h2>
      <p className="font-body text-muted-foreground max-w-sm mb-6 text-sm">
        Chat with AI to create your book&apos;s structure. Describe your topic,
        purpose, and audience — the AI will build a detailed roadmap for you.
      </p>
      <p className="font-body text-xs text-muted-foreground">
        Use the chat panel on the left to get started.
      </p>
    </div>
  );
}
