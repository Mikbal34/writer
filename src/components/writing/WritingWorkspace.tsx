"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
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
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import ContentEditor from "./ContentEditor";
import ContextPanel from "./ContextPanel";
import { FadeUp, FadeIn } from "@/components/shared/Animations";

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
 projectTitle: string;
 chapters: ChapterNode[];
}

const STATUS_DOT: Record<string, string> = {
 pending: "bg-[#c9bfad]",
 in_progress: "bg-ink",
 draft: "bg-gold-dark",
 review: "bg-ink-light",
 completed: "bg-forest",
};

export default function WritingWorkspace({
 projectId,
 projectTitle,
 chapters,
}: WritingWorkspaceProps) {
 const searchParams = useSearchParams();
 const router = useRouter();

 const [showLeftPanel, setShowLeftPanel] = useState(true);
 const [showRightPanel, setShowRightPanel] = useState(true);
 const [bookExpanded, setBookExpanded] = useState(true);
 const [expandedChapters, setExpandedChapters] = useState<Set<string>>(
  new Set(chapters.map((c) => c.id))
 );

 // Batch writing state
 const [batchCurrent, setBatchCurrent] = useState(0);
 const [batchTotal, setBatchTotal] = useState(0);
 const [isBatchWriting, setIsBatchWriting] = useState(false);
 const batchAbortRef = useRef(false);
 const streamAbortRef = useRef<AbortController | null>(null);

 const [selectedSubsectionId, setSelectedSubsectionId] = useState<string | null>(
  searchParams.get("subsection")
 );
 const [context, setContext] = useState<WritingContextData | null>(null);
 const [isLoadingContext, setIsLoadingContext] = useState(false);
 const [streamingContent, setStreamingContent] = useState("");
 const [isStreaming, setIsStreaming] = useState(false);
 const [currentContent, setCurrentContent] = useState("");

 const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

 const stopPolling = useCallback(() => {
  if (pollingRef.current) {
   clearInterval(pollingRef.current);
   pollingRef.current = null;
  }
 }, []);

 const fetchContext = useCallback(
  async (subsectionId: string) => {
   setIsLoadingContext(true);
   stopPolling();
   try {
    const res = await fetch(
     `/api/projects/${projectId}/write/${subsectionId}`
    );
    if (!res.ok) throw new Error("Failed to load context");
    const data = await res.json();
    setContext(data);
    setCurrentContent(data.subsection.content ?? "");
    setStreamingContent("");

    // If subsection is in_progress, start polling for completion
    if (data.subsection.status === "in_progress") {
     setIsStreaming(true);
     setStreamingContent(data.subsection.content ?? "Writing in progress...");
     pollingRef.current = setInterval(async () => {
      try {
       const pollRes = await fetch(`/api/projects/${projectId}/write/${subsectionId}`);
       if (!pollRes.ok) return;
       const pollData = await pollRes.json();
       if (pollData.subsection.status !== "in_progress") {
        // Operation completed while we were away
        setContext(pollData);
        setCurrentContent(pollData.subsection.content ?? "");
        setStreamingContent("");
        setIsStreaming(false);
        stopPolling();
        if (pollData.subsection.status === "completed" || pollData.subsection.status === "draft") {
         toast.success("Writing completed!");
        }
       } else if (pollData.subsection.content) {
        setStreamingContent(pollData.subsection.content);
       }
      } catch { /* ignore */ }
     }, 3000);
    }
   } catch {
    toast.error("Failed to load writing context");
   } finally {
    setIsLoadingContext(false);
   }
  },
  [projectId, stopPolling]
 );

 // Cleanup polling on unmount
 useEffect(() => {
  return () => stopPolling();
 }, [stopPolling]);

 useEffect(() => {
  const sid = searchParams.get("subsection");
  if (sid) {
   setSelectedSubsectionId(sid);
   fetchContext(sid);
  } else {
   // Resume where the user left off: prefer in_progress, then draft, then
   // the first pending. Only fall back to the very first subsection if the
   // whole project is still untouched.
   const all = chapters.flatMap((c) => c.sections.flatMap((s) => s.subsections));
   const resume =
    all.find((s) => s.status === "in_progress") ??
    all.find((s) => s.status === "draft") ??
    all.find((s) => s.status === "pending") ??
    all[0];
   if (resume) {
    setSelectedSubsectionId(resume.id);
    fetchContext(resume.id);
    router.replace(`?subsection=${resume.id}`);
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

  // Preflight: check source readiness. If any mapped source lacks a
  // usable PDF, warn the user before burning credits on a generation
  // that would have to fall back to the AI's generic knowledge.
  try {
   const pre = await fetch(
    `/api/projects/${projectId}/write/${selectedSubsectionId}/readiness`
   );
   if (pre.ok) {
    const r = await pre.json() as {
     total: number; usable: number; missing: number;
     mappings: Array<{ title: string; usable: boolean }>
    };
    if (r.total > 0 && r.missing > 0) {
     const missingTitles = r.mappings
      .filter((m) => !m.usable)
      .map((m) => `• ${m.title}`)
      .slice(0, 5)
      .join("\n");
     const ok = confirm(
      `Bu altbölüme bağlı ${r.total} kaynaktan ${r.missing} tanesinin PDF'i yok.\n\n` +
      `${missingTitles}\n\n` +
      `Bu kaynaklardan gerçek içerik çekemeyeceğim — halüsinasyon riski var.\n\n` +
      `Yine de yazayım mı?`
     );
     if (!ok) return;
    }
    if (r.total === 0) {
     const ok = confirm(
      `Bu altbölüme hiç kaynak bağlanmamış. AI sadece başlıktan yazacak — halüsinasyon riski yüksek.\n\n` +
      `Yine de yazayım mı?`
     );
     if (!ok) return;
    }
   }
  } catch {
   // non-fatal: preflight is advisory, continue on error
  }

  const abortController = new AbortController();
  streamAbortRef.current = abortController;

  setIsStreaming(true);
  setStreamingContent("");

  try {
   const res = await fetch(
    `/api/projects/${projectId}/write/${selectedSubsectionId}/generate`,
    { method: "POST", signal: abortController.signal }
   );

   if (res.status === 402) {
    const errData = await res.json().catch(() => ({}));
    toast.error(`Insufficient credits (${errData.balance ?? 0} remaining). You need ~${errData.cost ?? '?'} credits.`);
    setIsStreaming(false);
    return;
   }

   if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Generation failed" }));
    throw new Error(err.error ?? "Generation failed");
   }

   if (!res.body) throw new Error("No response body");

   const reader = res.body.getReader();
   const decoder = new TextDecoder();
   let accumulated = "";

   try {
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
   } catch {
    // reader cancelled via abort
   }

   if (accumulated) {
    setCurrentContent(accumulated);
   }
   if (!abortController.signal.aborted) {
    toast.success("AI writing completed!");
   } else {
    toast.info("Writing stopped.");
   }
  } catch (err) {
   if (err instanceof DOMException && err.name === "AbortError") {
    toast.info("Writing stopped.");
   } else {
    toast.error(err instanceof Error ? err.message : "AI generation failed");
   }
  } finally {
   setIsStreaming(false);
   streamAbortRef.current = null;
  }
 }

 function handleStopStream() {
  if (streamAbortRef.current) {
   streamAbortRef.current.abort();
  }
 }

 // Write a single subsection and return success/fail
 async function writeOneSubsection(subId: string): Promise<boolean> {
  const abortController = new AbortController();
  streamAbortRef.current = abortController;

  try {
   const res = await fetch(
    `/api/projects/${projectId}/write/${subId}/generate`,
    { method: "POST", signal: abortController.signal }
   );
   if (res.status === 402) {
    const errData = await res.json().catch(() => ({}));
    toast.error(`Insufficient credits (${errData.balance ?? 0} remaining). Batch writing stopped.`);
    return false;
   }
   if (!res.ok || !res.body) return false;

   const reader = res.body.getReader();
   const decoder = new TextDecoder();
   let accumulated = "";

   try {
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
   } catch {
    // reader cancelled via abort
   }

   if (accumulated) {
    setCurrentContent(accumulated);
   }
   streamAbortRef.current = null;
   return !abortController.signal.aborted;
  } catch {
   streamAbortRef.current = null;
   return false;
  }
 }

 async function runBatchWrite(queue: SubsectionNode[]) {
  setIsBatchWriting(true);
  batchAbortRef.current = false;
  setBatchTotal(queue.length);
  setBatchCurrent(0);

  let completed = 0;
  for (let i = 0; i < queue.length; i++) {
   if (batchAbortRef.current) break;

   setBatchCurrent(i + 1);
   const sub = queue[i];

   setSelectedSubsectionId(sub.id);
   router.push(`?subsection=${sub.id}`);
   await fetchContext(sub.id);

   setIsStreaming(true);
   setStreamingContent("");
   const ok = await writeOneSubsection(sub.id);
   setIsStreaming(false);

   if (batchAbortRef.current) break;

   if (ok) {
    completed++;
   } else {
    toast.error(`Failed to write "${sub.title}", continuing...`);
   }

   await new Promise((r) => setTimeout(r, 1000));
  }

  if (batchAbortRef.current) {
   toast.info(`Cancelled. ${completed}/${queue.length} written.`);
  } else {
   toast.success(`Done! ${completed}/${queue.length} subsections written.`);
  }
  setIsBatchWriting(false);
  setBatchCurrent(0);
  setBatchTotal(0);
 }

 function handleBatchWrite(subsections: SubsectionNode[]) {
  const queue = subsections.filter(
   (s) => s.status === "pending" || s.status === "in_progress"
  );
  if (queue.length === 0) {
   toast.info("No pending subsections to write.");
   return;
  }
  runBatchWrite(queue);
 }

 function handleBatchWriteAll() {
  const allSubs = chapters.flatMap((c) => c.sections.flatMap((s) => s.subsections));
  handleBatchWrite(allSubs);
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
  if (streamAbortRef.current) {
   streamAbortRef.current.abort();
  }
 }

 return (
  <div className="flex h-full overflow-hidden">
   {/* Left panel: subsection navigator */}
   <div
    className={cn(
     "shrink-0 border-r border-[#d4c9b5]/40 transition-all duration-200 overflow-hidden flex flex-col",
     showLeftPanel ? "w-64" : "w-0"
    )}
   >
    {/* Panel header — collapse button only */}
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#d4c9b5]/40 shrink-0">
     <span className="font-ui text-[10px] text-muted-foreground tracking-wider uppercase">Contents</span>
     <button
      className="h-6 w-6 flex items-center justify-center rounded-sm hover:bg-[#e8dfd0]/30 transition-colors shrink-0"
      onClick={() => setShowLeftPanel(false)}
      aria-label="Hide panel"
     >
      <ChevronLeft className="h-3.5 w-3.5 text-ink-light" />
     </button>
    </div>

    {/* Tree */}
    <div className="flex-1 overflow-y-auto">
     <div className="p-2 space-y-1">

      {/* Book-level row — same pattern as chapters */}
      <div>
       <div className="flex items-center group/book">
        <button
         type="button"
         onClick={() => setBookExpanded(!bookExpanded)}
         className="flex items-center gap-2 flex-1 min-w-0 rounded-sm px-3 py-2 hover:bg-[#e8dfd0]/30 transition-colors text-left"
        >
         <BookOpen className="h-4 w-4 text-[#C9A84C] shrink-0" />
         <span className="font-display text-xs font-bold text-ink truncate flex-1">
          {projectTitle}
         </span>
         {bookExpanded ? (
          <ChevronDown className="h-3 w-3 text-ink-light shrink-0" />
         ) : (
          <ChevronRight className="h-3 w-3 text-ink-light shrink-0" />
         )}
        </button>
        {isBatchWriting || isStreaming ? (
         <button
          onClick={isBatchWriting ? handleStopBatch : handleStopStream}
          title="Cancel"
          className="p-1 rounded-sm hover:bg-red-50 transition-colors cursor-pointer shrink-0"
         >
          <Square className="h-3.5 w-3.5 text-red-500" />
         </button>
        ) : (
         <div
          role="button"
          tabIndex={-1}
          title="Write all"
          onClick={(e) => {
           e.stopPropagation();
           (e.currentTarget as HTMLElement).blur();
           handleBatchWriteAll();
          }}
          className="p-1 rounded-sm opacity-0 group-hover/book:opacity-100 hover:bg-[#e8dfd0]/30 transition-opacity cursor-pointer shrink-0"
         >
          <PlayCircle className="h-4 w-4 text-[#C9A84C]" />
         </div>
        )}
       </div>

       {/* Batch progress indicator */}
       {isBatchWriting && (
        <div className="flex items-center gap-1.5 px-3 py-1 ml-3">
         <Loader2 className="h-3 w-3 animate-spin text-forest" />
         <span className="font-ui text-[10px] text-forest font-medium">
          Writing {batchCurrent}/{batchTotal}…
         </span>
        </div>
       )}

       {/* Chapters — nested under book */}
       {bookExpanded && (
        <div className="ml-2 space-y-0.5 mt-0.5">
         {chapters.map((chapter) => {
          const isExpanded = expandedChapters.has(chapter.id);
          const chapterSubs = chapter.sections.flatMap((s) => s.subsections);
          const completedSubs = chapterSubs.filter((s) => s.status === "completed").length;
          return (
           <div key={chapter.id}>
            <div className="flex items-center group/chapter">
             <button
              type="button"
              onClick={() => toggleChapter(chapter.id)}
              className="flex items-center gap-2 flex-1 min-w-0 rounded-sm px-3 py-1.5 hover:bg-[#e8dfd0]/30 transition-colors text-left"
             >
              <BookOpen className="h-3.5 w-3.5 text-forest shrink-0" />
              <span className="font-ui text-xs text-ink truncate flex-1">
               {chapter.title}
              </span>
              <span className="font-ui text-[9px] text-muted-foreground shrink-0 mr-1">
               {completedSubs}/{chapterSubs.length}
              </span>
              {isExpanded ? (
               <ChevronDown className="h-3 w-3 text-ink-light shrink-0" />
              ) : (
               <ChevronRight className="h-3 w-3 text-ink-light shrink-0" />
              )}
             </button>
             <div
              role="button"
              tabIndex={-1}
              title="Write this chapter"
              onClick={(e) => {
               e.stopPropagation();
               (e.currentTarget as HTMLElement).blur();
               handleBatchWriteChapter(chapter);
              }}
              className="p-1 rounded-sm opacity-0 group-hover/chapter:opacity-100 hover:bg-[#e8dfd0]/30 transition-opacity cursor-pointer shrink-0"
             >
              <PlayCircle className="h-3.5 w-3.5 text-forest" />
             </div>
            </div>

            {isExpanded && (
             <div className="ml-3 space-y-0.5 mt-0.5">
              {chapter.sections.map((section) => (
               <div key={section.id}>
                <div className="flex items-center gap-1.5 px-3 py-1.5 group/section">
                 <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                 <span className="font-ui text-[10px] text-muted-foreground tracking-wider uppercase truncate flex-1">
                  {section.title}
                 </span>
                 <div
                  role="button"
                  tabIndex={-1}
                  title="Write this section"
                  onClick={(e) => {
                   (e.currentTarget as HTMLElement).blur();
                   handleBatchWriteSection(section);
                  }}
                  className="p-0.5 rounded-sm opacity-0 group-hover/section:opacity-100 hover:bg-[#e8dfd0]/30 transition-opacity cursor-pointer shrink-0"
                 >
                  <PlayCircle className="h-3 w-3 text-forest" />
                 </div>
                </div>
                <div className="space-y-0.5">
                 {section.subsections.map((sub) => {
                  const isActive = sub.id === selectedSubsectionId;
                  const isCurrentlyWriting = isStreaming && isActive;
                  return (
                   <button
                    key={sub.id}
                    type="button"
                    onClick={() => handleSelectSubsection(sub.id)}
                    className={cn(
                     "flex items-center gap-2 w-full rounded-sm px-3 py-1.5 text-left transition-colors",
                     isActive
                      ? "bg-forest/5 text-forest"
                      : "text-ink hover:bg-[#e8dfd0]/20"
                    )}
                   >
                    {isCurrentlyWriting ? (
                     <Loader2 className="w-3 h-3 animate-spin text-forest shrink-0" />
                    ) : (
                     <span
                      className={cn(
                       "w-1.5 h-1.5 rounded-full shrink-0",
                       isActive ? "bg-forest" : (STATUS_DOT[sub.status] ?? STATUS_DOT.pending)
                      )}
                     />
                    )}
                    <span className="font-body text-xs truncate leading-tight">
                     {sub.title}
                    </span>
                    {sub.wordCount > 0 && (
                     <span className="font-ui text-[10px] text-muted-foreground ml-auto shrink-0">
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
       )}
      </div>

     </div>
    </div>
   </div>

   {/* Center: main editor */}
   <div className="flex-1 flex flex-col overflow-hidden min-w-0">
    {/* Top bar */}
    <div className="flex items-center gap-3 px-6 py-3 border-b border-[#d4c9b5]/40 shrink-0">
     {!showLeftPanel && (
      <button
       className="h-7 w-7 shrink-0 flex items-center justify-center rounded-sm hover:bg-[#e8dfd0]/30 transition-colors"
       onClick={() => setShowLeftPanel(true)}
       aria-label="Show sections panel"
      >
       <PanelLeftOpen className="h-4 w-4 text-ink-light" />
      </button>
     )}

     <div className="flex-1 min-w-0">
      {context ? (
       <div className="flex items-center gap-1.5 font-ui text-xs text-muted-foreground">
        <span className="hidden sm:block">{context.chapter.title}</span>
        <ChevronRight className="w-3 h-3 hidden sm:block" />
        <span className="hidden sm:block">{context.section.title}</span>
        <ChevronRight className="w-3 h-3 hidden sm:block" />
        <span className="text-ink font-medium">{context.subsection.title}</span>
        <span className="ml-2 text-muted-foreground">{context.subsection.subsectionId}</span>
       </div>
      ) : (
       <span className="font-body text-sm text-muted-foreground">
        Select a subsection to start writing
       </span>
      )}
     </div>

     {isBatchWriting && (
      <div className="flex items-center gap-2 shrink-0">
       <div className="flex items-center gap-1.5 font-ui text-xs text-forest">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span className="font-medium">
         {batchCurrent}/{batchTotal}
        </span>
       </div>
       <button
        onClick={handleStopBatch}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm border border-red-200 text-red-600 font-ui text-xs hover:bg-red-50 transition-colors"
       >
        <Square className="h-3 w-3" />
        Cancel
       </button>
      </div>
     )}
     {isStreaming && !isBatchWriting && (
      <button
       onClick={handleStopStream}
       className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm border border-red-200 text-red-600 font-ui text-xs hover:bg-red-50 transition-colors shrink-0"
      >
       <Square className="h-3 w-3" />
       Stop
      </button>
     )}

     {!showRightPanel && (
      <button
       className="h-7 w-7 shrink-0 flex items-center justify-center rounded-sm hover:bg-[#e8dfd0]/30 transition-colors"
       onClick={() => setShowRightPanel(true)}
       aria-label="Show context panel"
      >
       <PanelRightOpen className="h-4 w-4 text-ink-light" />
      </button>
     )}
    </div>

    {/* Editor area */}
    <div className="flex-1 overflow-hidden">
     {isLoadingContext ? (
      <FadeIn className="flex items-center justify-center h-full gap-3">
       <Loader2 className="h-5 w-5 animate-spin text-forest" />
       <span className="text-sm text-muted-foreground">Loading...</span>
      </FadeIn>
     ) : !context ? (
      <FadeUp delay={0.2} className="flex flex-col items-center justify-center h-full text-center p-8">
       <BookOpen className="h-10 w-10 text-muted-foreground/30 mb-4" />
       <p className="text-sm text-muted-foreground">
        Select a subsection from the left panel to start writing.
       </p>
      </FadeUp>
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
     "shrink-0 border-l border-[#d4c9b5]/40 transition-all duration-200 overflow-hidden",
     showRightPanel ? "w-64" : "w-0"
    )}
   >
    <div className="flex items-center justify-between p-4 border-b border-[#d4c9b5]/40">
     <span className="font-display text-sm font-semibold text-ink">CONTEXT</span>
     <button
      className="h-6 w-6 flex items-center justify-center rounded-sm hover:bg-[#e8dfd0]/30 transition-colors"
      onClick={() => setShowRightPanel(false)}
      aria-label="Hide context panel"
     >
      <ChevronRight className="h-3.5 w-3.5 text-ink-light" />
     </button>
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
