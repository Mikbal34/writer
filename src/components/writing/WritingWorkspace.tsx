"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
 Sparkles,
 ChevronLeft,
 ChevronRight,
 PanelLeftOpen,
 PanelRightOpen,
 Loader2,
 BookOpen,
 FileText,
 ChevronDown,
 PlayCircle,
 Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import ContentEditor from "./ContentEditor";
import ContextPanel from "./ContextPanel";

interface SubsectionNode {
 id: string;
 subsectionId: string;
 title: string;
 status: string;
 wordCount: number;
}

interface SectionNode {
 id: string;
 sectionId: string;
 title: string;
 subsections: SubsectionNode[];
}

interface ChapterNode {
 id: string;
 number: number;
 title: string;
 sections: SectionNode[];
}

interface WritingContextData {
 subsection: {
  id: string;
  title: string;
  description: string | null;
  content: string | null;
  status: string;
  wordCount: number;
  subsectionId: string;
 };
 section: { id: string; title: string; sectionId: string };
 chapter: { id: string; title: string; number: number };
 position: {
  sectionFirst: boolean;
  sectionLast: boolean;
  chapterFirst: boolean;
  chapterLast: boolean;
 };
 prevSubsection: {
  subsectionId: string;
  title: string;
  sectionTitle: string;
  chapterTitle: string;
  dbId: string;
 } | null;
 nextSubsection: {
  subsectionId: string;
  title: string;
  sectionTitle: string;
  chapterTitle: string;
  dbId: string;
 } | null;
 sources: Array<{
  bibliographyId: string;
  authorSurname: string;
  authorName: string | null;
  title: string;
  shortTitle: string | null;
  entryType: string;
  priority: string;
  relevance: string | null;
 }>;
 styleProfile: Record<string, unknown> | null;
}

interface WritingWorkspaceProps {
 projectId: string;
 chapters: ChapterNode[];
}

const STATUS_DOT: Record<string, string> = {
 pending: "bg-muted-foreground/30",
 in_progress: "bg-primary",
 draft: "bg-amber-500",
 review: "bg-sky-500",
 completed: "bg-emerald-500",
};

export default function WritingWorkspace({
 projectId,
 chapters,
}: WritingWorkspaceProps) {
 const searchParams = useSearchParams();
 const router = useRouter();

 const [showLeftPanel, setShowLeftPanel] = useState(true);
 const [showRightPanel, setShowRightPanel] = useState(true);
 const [expandedChapters, setExpandedChapters] = useState<Set<string>>(
  new Set(chapters.map((c) => c.id))
 );

 // Batch writing state
 const [batchQueue, setBatchQueue] = useState<SubsectionNode[]>([]);
 const [batchCurrent, setBatchCurrent] = useState(0);
 const [batchTotal, setBatchTotal] = useState(0);
 const [isBatchWriting, setIsBatchWriting] = useState(false);
 const batchAbortRef = useRef(false);

 const [selectedSubsectionId, setSelectedSubsectionId] = useState<string | null>(
  searchParams.get("subsection")
 );
 const [context, setContext] = useState<WritingContextData | null>(null);
 const [isLoadingContext, setIsLoadingContext] = useState(false);
 const [streamingContent, setStreamingContent] = useState("");
 const [isStreaming, setIsStreaming] = useState(false);
 const [currentContent, setCurrentContent] = useState("");

 const fetchContext = useCallback(
  async (subsectionId: string) => {
   setIsLoadingContext(true);
   try {
    const res = await fetch(
     `/api/projects/${projectId}/write/${subsectionId}`
    );
    if (!res.ok) throw new Error("Failed to load context");
    const data = await res.json();
    setContext(data);
    setCurrentContent(data.subsection.content ?? "");
    setStreamingContent("");
   } catch {
    toast.error("Failed to load writing context");
   } finally {
    setIsLoadingContext(false);
   }
  },
  [projectId]
 );

 useEffect(() => {
  const sid = searchParams.get("subsection");
  if (sid) {
   setSelectedSubsectionId(sid);
   fetchContext(sid);
  } else {
   // auto-select first subsection
   const first = chapters[0]?.sections[0]?.subsections[0];
   if (first) {
    setSelectedSubsectionId(first.id);
    fetchContext(first.id);
    router.replace(`?subsection=${first.id}`);
   }
  }
 }, [searchParams, chapters, fetchContext, router]);

 function handleSelectSubsection(id: string) {
  setSelectedSubsectionId(id);
  router.push(`?subsection=${id}`);
  fetchContext(id);
 }

 function toggleChapter(chapterId: string) {
  setExpandedChapters((prev) => {
   const next = new Set(prev);
   if (next.has(chapterId)) next.delete(chapterId);
   else next.add(chapterId);
   return next;
  });
 }

 async function handleWriteWithAI() {
  if (!selectedSubsectionId) return;

  setIsStreaming(true);
  setStreamingContent("");

  try {
   const res = await fetch(
    `/api/projects/${projectId}/write/${selectedSubsectionId}/generate`,
    { method: "POST" }
   );

   if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Generation failed" }));
    throw new Error(err.error ?? "Generation failed");
   }

   if (!res.body) throw new Error("No response body");

   const reader = res.body.getReader();
   const decoder = new TextDecoder();
   let accumulated = "";

   while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    // Parse SSE chunks
    const lines = chunk.split("\n");
    for (const line of lines) {
     if (line.startsWith("data: ")) {
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      try {
       const parsed = JSON.parse(data);
       if (parsed.delta) {
        accumulated += parsed.delta;
        setStreamingContent(accumulated);
       }
      } catch {
       // not JSON, treat as raw text
       accumulated += data;
       setStreamingContent(accumulated);
      }
     }
    }
   }

   setCurrentContent(accumulated);
   toast.success("AI writing complete!");
  } catch (err) {
   toast.error(err instanceof Error ? err.message : "AI generation failed");
  } finally {
   setIsStreaming(false);
  }
 }

 // Write a single subsection and return success/fail
 async function writeOneSubsection(subId: string): Promise<boolean> {
  try {
   const res = await fetch(
    `/api/projects/${projectId}/write/${subId}/generate`,
    { method: "POST" }
   );
   if (!res.ok || !res.body) return false;

   const reader = res.body.getReader();
   const decoder = new TextDecoder();
   let accumulated = "";

   while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n");
    for (const line of lines) {
     if (line.startsWith("data: ")) {
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      try {
       const parsed = JSON.parse(data);
       if (parsed.delta) {
        accumulated += parsed.delta;
        setStreamingContent(accumulated);
       }
      } catch {
       accumulated += data;
       setStreamingContent(accumulated);
      }
     }
    }
   }

   setCurrentContent(accumulated);
   return true;
  } catch {
   return false;
  }
 }

 async function handleBatchWrite(subsections: SubsectionNode[]) {
  // Filter to only pending/incomplete subsections
  const queue = subsections.filter(
   (s) => s.status === "pending" || s.status === "in_progress"
  );

  if (queue.length === 0) {
   toast.info("Yazılacak pending alt başlık yok.");
   return;
  }

  setIsBatchWriting(true);
  batchAbortRef.current = false;
  setBatchQueue(queue);
  setBatchTotal(queue.length);

  let completed = 0;
  for (let i = 0; i < queue.length; i++) {
   if (batchAbortRef.current) {
    toast.info(`Toplu yazma durduruldu. ${completed}/${queue.length} tamamlandı.`);
    break;
   }

   setBatchCurrent(i + 1);
   const sub = queue[i];

   // Select this subsection in UI
   setSelectedSubsectionId(sub.id);
   router.push(`?subsection=${sub.id}`);
   await fetchContext(sub.id);

   setIsStreaming(true);
   setStreamingContent("");
   const ok = await writeOneSubsection(sub.id);
   setIsStreaming(false);

   if (ok) {
    completed++;
   } else {
    toast.error(`"${sub.title}" yazılamadı, devam ediliyor...`);
   }

   // Small delay between subsections
   await new Promise((r) => setTimeout(r, 1000));
  }

  toast.success(`Toplu yazma tamamlandı! ${completed}/${queue.length} alt başlık yazıldı.`);
  setIsBatchWriting(false);
  setBatchQueue([]);
  setBatchCurrent(0);
  setBatchTotal(0);
 }

 function handleBatchWriteChapter(chapter: ChapterNode) {
  const allSubs = chapter.sections.flatMap((s) => s.subsections);
  handleBatchWrite(allSubs);
 }

 function handleBatchWriteSection(section: SectionNode) {
  handleBatchWrite(section.subsections);
 }

 function handleStopBatch() {
  batchAbortRef.current = true;
 }

 return (
  <div className="flex h-full overflow-hidden">
   {/* Left panel: subsection navigator */}
   <div
    className={cn(
     "shrink-0 border-r border-border bg-background transition-all duration-200 overflow-hidden",
     showLeftPanel ? "w-64" : "w-0"
    )}
   >
    <div className="flex items-center justify-between px-3 py-3 border-b border-border">
     <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      Sections
     </h2>
     <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6"
      onClick={() => setShowLeftPanel(false)}
      aria-label="Hide sections panel"
     >
      <ChevronLeft className="h-3.5 w-3.5" />
     </Button>
    </div>

    <ScrollArea className="h-[calc(100%-49px)]">
     <div className="p-2 space-y-1">
      {chapters.map((chapter) => {
       const isExpanded = expandedChapters.has(chapter.id);
       return (
        <div key={chapter.id}>
         <div className="flex items-center group/chapter">
          <button
           type="button"
           onClick={() => toggleChapter(chapter.id)}
           className="flex items-center gap-2 flex-1 min-w-0 rounded-md px-2 py-1.5 hover:bg-muted transition-colors text-left"
          >
           <BookOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
           <span className="text-xs font-medium truncate flex-1">
            Ch.{chapter.number} {chapter.title}
           </span>
           <ChevronDown
            className={cn(
             "h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform",
             isExpanded ? "rotate-0" : "-rotate-90"
            )}
           />
          </button>
          <div
           role="button"
           tabIndex={-1}
           title="Tüm bölümü yazdır"
           onClick={(e) => {
            e.stopPropagation();
            (e.currentTarget as HTMLElement).blur();
            handleBatchWriteChapter(chapter);
           }}
           className="p-1 rounded opacity-50 hover:opacity-100 hover:bg-accent transition-opacity cursor-pointer shrink-0"
          >
           <PlayCircle className="h-3.5 w-3.5 text-primary" />
          </div>
         </div>

         {isExpanded && (
          <div className="ml-3 space-y-0.5 mt-0.5">
           {chapter.sections.map((section) => (
            <div key={section.id}>
             <div className="flex items-center gap-1.5 px-2 py-1 group/section">
              <FileText className="h-3 w-3 shrink-0 text-muted-foreground/70" />
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-semibold truncate flex-1">
               {section.title}
              </span>
              <div
               role="button"
               tabIndex={-1}
               title="Bu bölümü yazdır"
               onClick={(e) => {
                (e.currentTarget as HTMLElement).blur();
                handleBatchWriteSection(section);
               }}
               className="p-0.5 rounded opacity-50 hover:opacity-100 hover:bg-accent transition-opacity cursor-pointer shrink-0"
              >
               <PlayCircle className="h-3 w-3 text-primary" />
              </div>
             </div>
             <div className="space-y-0.5">
              {section.subsections.map((sub) => {
               const isActive = sub.id === selectedSubsectionId;
               return (
                <button
                 key={sub.id}
                 type="button"
                 onClick={() => handleSelectSubsection(sub.id)}
                 className={cn(
                  "flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-left transition-colors",
                  isActive
                   ? "bg-accent text-primary"
                   : "hover:bg-muted text-muted-foreground hover:text-foreground"
                 )}
                >
                 <div
                  className={cn(
                   "h-1.5 w-1.5 rounded-full shrink-0",
                   STATUS_DOT[sub.status] ?? STATUS_DOT.pending
                  )}
                 />
                 <span className="text-xs truncate leading-tight">
                  {sub.title}
                 </span>
                 {sub.wordCount > 0 && (
                  <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                   {sub.wordCount}w
                  </span>
                 )}
                </button>
               );
              })}
             </div>
            </div>
           ))}
          </div>
         )}
        </div>
       );
      })}
     </div>
    </ScrollArea>
   </div>

   {/* Center: main editor */}
   <div className="flex-1 flex flex-col overflow-hidden min-w-0">
    {/* Top bar */}
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-background/95 shrink-0">
     {!showLeftPanel && (
      <Button
       variant="ghost"
       size="icon"
       className="h-7 w-7 shrink-0"
       onClick={() => setShowLeftPanel(true)}
       aria-label="Show sections panel"
      >
       <PanelLeftOpen className="h-4 w-4" />
      </Button>
     )}

     <div className="flex-1 min-w-0">
      {context ? (
       <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground hidden sm:block">
         {context.chapter.title}
         {" › "}
         {context.section.title}
         {" › "}
        </span>
        <span className="text-sm font-semibold truncate">
         {context.subsection.title}
        </span>
        <Badge
         variant="secondary"
         className="text-xs hidden sm:inline-flex"
        >
         {context.subsection.subsectionId}
        </Badge>
       </div>
      ) : (
       <span className="text-sm text-muted-foreground">
        Select a subsection to start writing
       </span>
      )}
     </div>

     {isBatchWriting ? (
      <div className="flex items-center gap-2 shrink-0">
       <div className="flex items-center gap-1.5 text-xs text-primary">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span className="font-medium">
         {batchCurrent}/{batchTotal}
        </span>
       </div>
       <Button
        onClick={handleStopBatch}
        variant="outline"
        className="h-8 text-xs gap-1.5 border-red-200 text-red-600 hover:bg-red-50"
       >
        <Square className="h-3 w-3" />
        Durdur
       </Button>
      </div>
     ) : (
      <Button
       onClick={handleWriteWithAI}
       disabled={!context || isStreaming || isLoadingContext}
       className="shrink-0 gap-2 h-8 text-xs"
      >
       {isStreaming ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
       ) : (
        <Sparkles className="h-3.5 w-3.5" />
       )}
       {isStreaming ? "Writing..." : "Write with AI"}
      </Button>
     )}

     {!showRightPanel && (
      <Button
       variant="ghost"
       size="icon"
       className="h-7 w-7 shrink-0"
       onClick={() => setShowRightPanel(true)}
       aria-label="Show context panel"
      >
       <PanelRightOpen className="h-4 w-4" />
      </Button>
     )}
    </div>

    {/* Editor area */}
    <div className="flex-1 overflow-hidden">
     {isLoadingContext ? (
      <div className="flex items-center justify-center h-full gap-3">
       <Loader2 className="h-5 w-5 animate-spin text-primary" />
       <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
     ) : !context ? (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
       <BookOpen className="h-10 w-10 text-muted-foreground/30 mb-4" />
       <p className="text-sm text-muted-foreground">
        Select a subsection from the left panel to start writing.
       </p>
      </div>
     ) : (
      <ContentEditor
       subsectionId={context.subsection.id}
       projectId={projectId}
       initialContent={context.subsection.content ?? ""}
       status={context.subsection.status}
       onContentChange={setCurrentContent}
       streamingContent={streamingContent || currentContent}
       isStreaming={isStreaming}
      />
     )}
    </div>
   </div>

   {/* Right panel: context */}
   <div
    className={cn(
     "shrink-0 border-l border-border bg-background transition-all duration-200 overflow-hidden",
     showRightPanel ? "w-64" : "w-0"
    )}
   >
    <div className="flex items-center justify-between px-3 py-3 border-b border-border">
     <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      Context
     </h2>
     <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6"
      onClick={() => setShowRightPanel(false)}
      aria-label="Hide context panel"
     >
      <ChevronRight className="h-3.5 w-3.5" />
     </Button>
    </div>

    <div className="h-[calc(100%-49px)] overflow-hidden">
     {context ? (
      <ContextPanel
       projectId={projectId}
       position={context.position}
       prevSubsection={context.prevSubsection}
       nextSubsection={context.nextSubsection}
       sources={context.sources}
       styleProfile={context.styleProfile as Record<string, unknown> | null}
      />
     ) : (
      <div className="p-4 text-xs text-muted-foreground">
       Select a subsection to see context.
      </div>
     )}
    </div>
   </div>
  </div>
 );
}
