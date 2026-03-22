"use client";

import { useState } from "react";
import {
 ChevronDown,
 ChevronRight,
 GripVertical,
 FileText,
 BookOpen,
 Check,
 Clock,
 Pencil,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import SubsectionDetail from "./SubsectionDetail";
import type { SourceMapping, Bibliography } from "@prisma/client";

interface SourceMappingWithBibliography extends SourceMapping {
 bibliography: Bibliography;
}

interface SubsectionNode {
 id: string;
 subsectionId: string;
 title: string;
 description: string | null;
 whatToWrite?: string | null;
 keyPoints?: string[];
 writingStrategy?: string | null;
 estimatedPages: number | null;
 status: string;
 wordCount: number;
 sourceMappings?: SourceMappingWithBibliography[];
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
 purpose: string | null;
 estimatedPages: number | null;
 sections: SectionNode[];
}

interface ChapterCardProps {
 chapter: ChapterNode;
 onTitleChange?: (chapterId: string, newTitle: string) => void;
 onSectionTitleChange?: (sectionId: string, newTitle: string) => void;
 onSubsectionTitleChange?: (subsectionId: string, newTitle: string) => void;
}

const STATUS_STYLES: Record<string, string> = {
 pending: "bg-muted text-muted-foreground",
 in_progress: "bg-accent text-primary",
 draft: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
 review: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
 completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
};

const STATUS_LABELS: Record<string, string> = {
 pending: "Pending",
 in_progress: "In Progress",
 draft: "Draft",
 review: "Review",
 completed: "Done",
};

function InlineEdit({
 value,
 onSave,
 className,
}: {
 value: string;
 onSave: (newValue: string) => void;
 className?: string;
}) {
 const [editing, setEditing] = useState(false);
 const [draft, setDraft] = useState(value);

 function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Enter") {
   onSave(draft.trim() || value);
   setEditing(false);
  }
  if (e.key === "Escape") {
   setDraft(value);
   setEditing(false);
  }
 }

 function handleBlur() {
  onSave(draft.trim() || value);
  setEditing(false);
 }

 if (editing) {
  return (
   <input
    autoFocus
    type="text"
    value={draft}
    onChange={(e) => setDraft(e.target.value)}
    onKeyDown={handleKeyDown}
    onBlur={handleBlur}
    className={cn(
     "bg-transparent border-b border-primary outline-none text-sm leading-tight w-full min-w-0",
     className
    )}
   />
  );
 }

 return (
  <span
   role="button"
   tabIndex={0}
   onClick={() => setEditing(true)}
   onKeyDown={(e) => e.key === "Enter" && setEditing(true)}
   className={cn(
    "cursor-text hover:text-primary transition-colors focus:outline-none",
    className
   )}
   title="Click to edit"
  >
   {value}
  </span>
 );
}

export default function ChapterCard({
 chapter,
 onTitleChange,
 onSectionTitleChange,
 onSubsectionTitleChange,
}: ChapterCardProps) {
 const [expanded, setExpanded] = useState(true);
 const [expandedSections, setExpandedSections] = useState<Set<string>>(
  new Set(chapter.sections.map((s) => s.id))
 );
 const [expandedSubsections, setExpandedSubsections] = useState<Set<string>>(
  new Set()
 );

 function toggleSubsection(subsectionId: string) {
  setExpandedSubsections((prev) => {
   const next = new Set(prev);
   if (next.has(subsectionId)) {
    next.delete(subsectionId);
   } else {
    next.add(subsectionId);
   }
   return next;
  });
 }

 function toggleSection(sectionId: string) {
  setExpandedSections((prev) => {
   const next = new Set(prev);
   if (next.has(sectionId)) {
    next.delete(sectionId);
   } else {
    next.add(sectionId);
   }
   return next;
  });
 }

 const totalSubsections = chapter.sections.flatMap((s) => s.subsections).length;
 const completedSubsections = chapter.sections
  .flatMap((s) => s.subsections)
  .filter((s) => s.status === "completed").length;

 return (
  <div className="border border-border rounded-xl overflow-hidden">
   {/* Chapter header */}
   <div
    className="flex items-center gap-3 px-4 py-3.5 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
    onClick={() => setExpanded(!expanded)}
   >
    <GripVertical className="h-4 w-4 text-muted-foreground/50 cursor-grab shrink-0" />
    <button
     type="button"
     className="shrink-0 text-muted-foreground hover:text-foreground"
     aria-label={expanded ? "Collapse chapter" : "Expand chapter"}
     onClick={(e) => {
      e.stopPropagation();
      setExpanded(!expanded);
     }}
    >
     {expanded ? (
      <ChevronDown className="h-4 w-4" />
     ) : (
      <ChevronRight className="h-4 w-4" />
     )}
    </button>

    <div className="flex items-center gap-2 min-w-0 flex-1">
     <BookOpen className="h-3.5 w-3.5 text-forest shrink-0" />
     <div className="min-w-0 flex-1" onClick={(e) => e.stopPropagation()}>
      <span className="font-ui text-xs text-muted-foreground mr-2">
       Ch. {chapter.number}
      </span>
      <InlineEdit
       value={chapter.title}
       onSave={(v) => onTitleChange?.(chapter.id, v)}
       className="font-display font-bold text-sm"
      />
     </div>
    </div>

    <div className="flex items-center gap-3 shrink-0">
     {totalSubsections > 0 && (
      <span className="font-ui text-xs text-muted-foreground tabular-nums">
       {completedSubsections}/{totalSubsections}
      </span>
     )}
     {chapter.estimatedPages && (
      <span className="font-ui text-xs text-muted-foreground hidden sm:block">
       ~{chapter.estimatedPages} pp.
      </span>
     )}
    </div>
   </div>

   {/* Sections */}
   {expanded && (
    <div className="divide-y divide-border">
     {chapter.sections.length === 0 && (
      <div className="px-6 py-4 text-sm text-muted-foreground italic">
       No sections yet.
      </div>
     )}
     {chapter.sections.map((section) => {
      const isSectionExpanded = expandedSections.has(section.id);
      return (
       <div key={section.id}>
        {/* Section header */}
        <div
         className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20 cursor-pointer transition-colors pl-10"
         onClick={() => toggleSection(section.id)}
        >
         <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 cursor-grab shrink-0" />
         <button
          type="button"
          className="shrink-0 text-muted-foreground"
          onClick={(e) => {
           e.stopPropagation();
           toggleSection(section.id);
          }}
         >
          {isSectionExpanded ? (
           <ChevronDown className="h-3.5 w-3.5" />
          ) : (
           <ChevronRight className="h-3.5 w-3.5" />
          )}
         </button>
         <div
          className="flex-1 min-w-0"
          onClick={(e) => e.stopPropagation()}
         >
          <span className="font-ui text-xs text-muted-foreground mr-2">
           {section.sectionId}
          </span>
          <InlineEdit
           value={section.title}
           onSave={(v) => onSectionTitleChange?.(section.id, v)}
           className="font-display text-sm font-semibold"
          />
         </div>
         <span className="font-ui text-xs text-muted-foreground shrink-0">
          {section.subsections.length} subsections
         </span>
        </div>

        {/* Subsections */}
        {isSectionExpanded && section.subsections.length > 0 && (
         <div className="divide-y divide-border/50">
          {section.subsections.map((sub) => {
           const isSubExpanded = expandedSubsections.has(sub.id);
           return (
            <div key={sub.id}>
             <div
              className="flex items-start gap-3 px-4 py-2.5 pl-20 hover:bg-muted/10 transition-colors cursor-pointer"
              onClick={() => toggleSubsection(sub.id)}
             >
              <GripVertical className="h-3.5 w-3.5 text-muted-foreground/30 cursor-grab shrink-0 mt-0.5" />
              <button
               type="button"
               className="shrink-0 text-muted-foreground mt-0.5"
               onClick={(e) => {
                e.stopPropagation();
                toggleSubsection(sub.id);
               }}
              >
               {isSubExpanded ? (
                <ChevronDown className="h-3 w-3" />
               ) : (
                <ChevronRight className="h-3 w-3" />
               )}
              </button>
              <div className="flex h-4 w-4 shrink-0 items-center justify-center mt-0.5">
               <FileText className="h-3.5 w-3.5 text-muted-foreground/60" />
              </div>
              <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
               <div className="flex items-start gap-2 flex-wrap">
                <span className="font-ui text-xs text-muted-foreground shrink-0 mt-0.5">
                 {sub.subsectionId}
                </span>
                <InlineEdit
                 value={sub.title}
                 onSave={(v) =>
                  onSubsectionTitleChange?.(sub.id, v)
                 }
                 className="font-display text-sm font-medium flex-1 min-w-0"
                />
               </div>
               {!isSubExpanded && sub.description && (
                <p className="font-body text-xs text-muted-foreground mt-0.5 line-clamp-1 ml-8">
                 {sub.description}
                </p>
               )}
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
               {sub.estimatedPages && (
                <span className="font-ui text-xs text-muted-foreground hidden sm:block">
                 ~{sub.estimatedPages}pp
                </span>
               )}
               {sub.status === "completed" ? (
                <Check className="w-3.5 h-3.5 text-forest" />
               ) : sub.status === "in_progress" || sub.status === "draft" ? (
                <Pencil className="w-3 h-3 text-ink-light" />
               ) : (
                <Clock className="w-3 h-3 text-[#c9bfad]" />
               )}
              </div>
             </div>
             {isSubExpanded && (
              <SubsectionDetail
               whatToWrite={sub.whatToWrite ?? null}
               keyPoints={sub.keyPoints ?? []}
               writingStrategy={sub.writingStrategy ?? null}
               sourceMappings={sub.sourceMappings ?? []}
              />
             )}
            </div>
           );
          })}
         </div>
        )}
       </div>
      );
     })}
    </div>
   )}
  </div>
 );
}
