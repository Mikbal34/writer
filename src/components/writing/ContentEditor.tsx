"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Save, CheckCircle2, Loader2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ContentEditorProps {
 subsectionId: string;
 projectId: string;
 initialContent: string;
 status: string;
 onContentChange?: (content: string) => void;
 streamingContent?: string;
 isStreaming?: boolean;
}

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
 pending: { label: "Pending", className: "bg-muted text-muted-foreground" },
 in_progress: {
  label: "In Progress",
  className: "bg-accent text-primary",
 },
 draft: {
  label: "Draft",
  className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
 },
 review: {
  label: "For Review",
  className: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
 },
 completed: {
  label: "Completed",
  className: "bg-forest/10 text-forest",
 },
};

function countWords(text: string): number {
 return text
  .trim()
  .split(/\s+/)
  .filter((w) => w.length > 0).length;
}

type SaveState = "idle" | "saving" | "saved" | "error";

export default function ContentEditor({
 subsectionId,
 projectId,
 initialContent,
 status,
 onContentChange,
 streamingContent,
 isStreaming,
}: ContentEditorProps) {
 const [content, setContent] = useState(initialContent);
 const [saveState, setSaveState] = useState<SaveState>("idle");
 const [showPreview, setShowPreview] = useState(false);
 const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
 const statusInfo = STATUS_STYLES[status] ?? STATUS_STYLES.pending;
 const wordCount = countWords(isStreaming && streamingContent ? streamingContent : content);

 // Autosave after 2s of inactivity
 const autoSave = useCallback(
  async (text: string) => {
   setSaveState("saving");
   try {
    const res = await fetch(
     `/api/subsections/${subsectionId}`,
     {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text, status: text.trim() ? "completed" : "pending" }),
     }
    );
    if (!res.ok) throw new Error("Save failed");
    setSaveState("saved");
    setTimeout(() => setSaveState("idle"), 2000);
   } catch {
    setSaveState("error");
   }
  },
  [projectId, subsectionId]
 );

 function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
  const val = e.target.value;
  setContent(val);
  onContentChange?.(val);
  setSaveState("idle");

  if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  saveTimerRef.current = setTimeout(() => autoSave(val), 2000);
 }

 async function handleManualSave() {
  if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  await autoSave(content);
 }

 // When streaming finishes, update local content
 useEffect(() => {
  if (!isStreaming && streamingContent && streamingContent !== content) {
   setContent(streamingContent);
   onContentChange?.(streamingContent);
  }
 }, [isStreaming, streamingContent, content, onContentChange]);

 return (
  <div className="flex flex-col h-full">
   {/* Editor toolbar */}
   <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-background/50 shrink-0">
    <div className="flex items-center gap-3">
     <span
      className={cn(
       "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
       statusInfo.className
      )}
     >
      {statusInfo.label}
     </span>
     <span className="text-xs text-muted-foreground tabular-nums">
      {wordCount.toLocaleString()} word{wordCount !== 1 ? "s" : ""}
     </span>
    </div>

    <div className="flex items-center gap-2">
     {/* Save indicator */}
     <div className="flex items-center gap-1.5 text-xs">
      {saveState === "saving" && (
       <>
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        <span className="text-muted-foreground">Saving...</span>
       </>
      )}
      {saveState === "saved" && (
       <>
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        <span className="text-emerald-600">Saved</span>
       </>
      )}
      {saveState === "error" && (
       <span className="text-destructive">Save failed</span>
      )}
     </div>

     <Button
      variant="ghost"
      size="sm"
      onClick={() => setShowPreview(!showPreview)}
      className="gap-1.5 h-7 text-xs"
     >
      {showPreview ? (
       <EyeOff className="h-3.5 w-3.5" />
      ) : (
       <Eye className="h-3.5 w-3.5" />
      )}
      {showPreview ? "Edit" : "Preview"}
     </Button>

     <Button
      size="sm"
      onClick={handleManualSave}
      disabled={saveState === "saving" || isStreaming}
      className="h-7 gap-1.5 text-xs bg-primary text-primary-foreground"
     >
      <Save className="h-3.5 w-3.5" />
      Save
     </Button>
    </div>
   </div>

   {/* Editor / Preview */}
   <div className="flex-1 overflow-hidden relative">
    {showPreview ? (
     <div className="h-full overflow-y-auto p-6">
      <div
       className="prose prose-sm dark:prose-invert max-w-none"
       style={{ whiteSpace: "pre-wrap" }}
      >
       {content || (
        <p className="text-muted-foreground italic">No content yet.</p>
       )}
      </div>
     </div>
    ) : (
     <>
      <textarea
       value={isStreaming && streamingContent ? streamingContent : content}
       onChange={handleChange}
       readOnly={isStreaming}
       placeholder="Start writing here... or use the 'Write with AI' button to generate content."
       className={cn(
        "w-full h-full resize-none p-6 bg-background text-foreground text-sm leading-7 focus:outline-none font-serif",
        isStreaming && "opacity-80 cursor-not-allowed"
       )}
       aria-label="Content editor"
      />
      {isStreaming && (
       <div className="absolute bottom-4 right-4 flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow-lg">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        AI writing...
       </div>
      )}
     </>
    )}
   </div>
  </div>
 );
}
