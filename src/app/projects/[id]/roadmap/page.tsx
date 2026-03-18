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
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import StructureTree from "@/components/roadmap/StructureTree";
import RoadmapChat from "@/components/roadmap/RoadmapChat";
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
   <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
    <div>
     <h1 className="text-2xl font-bold tracking-tight">Book Roadmap</h1>
     <p className="text-muted-foreground text-sm mt-1">
      Your book&apos;s structure — chapters, sections, and subsections.
      Click any title to edit it inline.
     </p>
    </div>

    <div className="flex items-center gap-2 flex-wrap">
     {hasUnsavedChanges && (
      <Button
       variant="outline"
       onClick={handleSave}
       disabled={isSaving}
       className="gap-2"
      >
       {isSaving ? (
        <Loader2 className="h-4 w-4 animate-spin" />
       ) : (
        <Save className="h-4 w-4" />
       )}
       Save Changes
      </Button>
     )}

    </div>
   </div>

   {/* Error */}
   {error && (
    <Alert variant="destructive" className="mb-6">
     <AlertCircle className="h-4 w-4" />
     <AlertDescription>{error}</AlertDescription>
    </Alert>
   )}

   {/* Loading */}
   {isLoading && (
    <div className="flex flex-col items-center justify-center py-24 gap-3">
     <Loader2 className="h-6 w-6 animate-spin text-primary" />
     <p className="text-sm text-muted-foreground">Loading roadmap...</p>
    </div>
   )}

   {/* Empty state */}
   {!isLoading && chapters.length === 0 && <EmptyRoadmap />}

   {/* Tree */}
   {!isLoading && chapters.length > 0 && (
    <StructureTree
     projectId={projectId}
     chapters={chapters}
     onChaptersChange={handleChaptersChange}
    />
   )}

   {/* Footer stats */}
   {!isLoading && chapters.length > 0 && (
    <div className="mt-6 flex items-center gap-4 text-sm text-muted-foreground">
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
    </div>
   )}
  </div>
 );

 // Loading skeleton while detecting viewport
 if (!mounted) {
  return (
   <div className="h-full flex items-center justify-center">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
   </div>
  );
 }

 // Mobile: Tab layout
 if (isMobile) {
  return (
   <div className="h-full flex flex-col overflow-hidden">
    <Tabs defaultValue="chat" className="flex flex-col h-full">
     <TabsList className="w-full shrink-0 rounded-none border-b">
      <TabsTrigger value="chat" className="flex-1">Chat</TabsTrigger>
      <TabsTrigger value="roadmap" className="flex-1">Roadmap</TabsTrigger>
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
     className="hover:bg-border transition-colors cursor-col-resize"
    >
     <div className="h-full w-px mx-auto bg-border" />
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
   <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent mb-5">
    <Bot className="h-8 w-8 text-primary" />
   </div>
   <h2 className="text-xl font-semibold mb-2">Build your roadmap</h2>
   <p className="text-muted-foreground max-w-sm mb-6 text-sm">
    Chat with AI to create your book&apos;s structure. Describe your topic,
    purpose, and audience — the AI will build a detailed roadmap for you.
   </p>
   <p className="text-xs text-muted-foreground">
    Use the chat panel on the left to get started.
   </p>
  </div>
 );
}
