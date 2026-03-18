"use client";

import Link from "next/link";
import {
 ChevronLeft,
 ChevronRight,
 BookOpen,
 Library,
 Sparkles,
 Navigation,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface SourceInfo {
 bibliographyId: string;
 authorSurname: string;
 authorName: string | null;
 title: string;
 shortTitle: string | null;
 entryType: string;
 priority: string;
 relevance: string | null;
}

interface PrevNext {
 subsectionId: string;
 title: string;
 sectionTitle: string;
 chapterTitle: string;
 dbId: string;
}

interface StyleSummary {
 tone?: string;
 formality?: number;
 sentenceLength?: string;
 rhetoricalApproach?: string;
 usesFirstPerson?: boolean;
}

interface ContextPanelProps {
 projectId: string;
 position: {
  sectionFirst: boolean;
  sectionLast: boolean;
  chapterFirst: boolean;
  chapterLast: boolean;
 } | null;
 prevSubsection: PrevNext | null;
 nextSubsection: PrevNext | null;
 sources: SourceInfo[];
 styleProfile: StyleSummary | null;
}

export default function ContextPanel({
 projectId,
 position,
 prevSubsection,
 nextSubsection,
 sources,
 styleProfile,
}: ContextPanelProps) {
 return (
  <ScrollArea className="h-full">
   <div className="p-4 space-y-5">
    {/* Position */}
    {position && (
     <section>
      <div className="flex items-center gap-2 mb-2.5">
       <Navigation className="h-3.5 w-3.5 text-muted-foreground" />
       <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Position
       </h3>
      </div>
      <div className="flex flex-wrap gap-1.5">
       {position.chapterFirst && (
        <Badge variant="secondary" className="text-xs">
         Chapter start
        </Badge>
       )}
       {position.chapterLast && (
        <Badge variant="secondary" className="text-xs">
         Chapter end
        </Badge>
       )}
       {position.sectionFirst && (
        <Badge variant="secondary" className="text-xs">
         Section start
        </Badge>
       )}
       {position.sectionLast && (
        <Badge variant="secondary" className="text-xs">
         Section end
        </Badge>
       )}
       {!position.chapterFirst &&
        !position.chapterLast &&
        !position.sectionFirst &&
        !position.sectionLast && (
         <span className="text-xs text-muted-foreground">
          Middle of section
         </span>
        )}
      </div>
     </section>
    )}

    <Separator />

    {/* Navigation */}
    <section>
     <div className="flex items-center gap-2 mb-2.5">
      <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
       Navigation
      </h3>
     </div>
     <div className="space-y-2">
      {prevSubsection ? (
       <Link
        href={`/projects/${projectId}/write?subsection=${prevSubsection.dbId}`}
        className="flex items-start gap-2 rounded-md p-2 hover:bg-muted transition-colors group"
       >
        <ChevronLeft className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
        <div className="min-w-0">
         <p className="text-xs text-muted-foreground">Previous</p>
         <p className="text-xs font-medium truncate group-hover:text-primary transition-colors">
          {prevSubsection.title}
         </p>
         <p className="text-[10px] text-muted-foreground/70 truncate">
          {prevSubsection.chapterTitle}
         </p>
        </div>
       </Link>
      ) : (
       <div className="rounded-md p-2 bg-muted/30">
        <p className="text-xs text-muted-foreground">
         First subsection
        </p>
       </div>
      )}

      {nextSubsection ? (
       <Link
        href={`/projects/${projectId}/write?subsection=${nextSubsection.dbId}`}
        className="flex items-start gap-2 rounded-md p-2 hover:bg-muted transition-colors group"
       >
        <div className="min-w-0 flex-1">
         <p className="text-xs text-muted-foreground">Next</p>
         <p className="text-xs font-medium truncate group-hover:text-primary transition-colors">
          {nextSubsection.title}
         </p>
         <p className="text-[10px] text-muted-foreground/70 truncate">
          {nextSubsection.chapterTitle}
         </p>
        </div>
        <ChevronRight className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
       </Link>
      ) : (
       <div className="rounded-md p-2 bg-muted/30">
        <p className="text-xs text-muted-foreground">
         Last subsection
        </p>
       </div>
      )}
     </div>
    </section>

    <Separator />

    {/* Sources */}
    <section>
     <div className="flex items-center gap-2 mb-2.5">
      <Library className="h-3.5 w-3.5 text-muted-foreground" />
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
       Sources ({sources.length})
      </h3>
     </div>

     {sources.length === 0 ? (
      <p className="text-xs text-muted-foreground">
       No sources assigned. Map sources in the{" "}
       <Link
        href={`/projects/${projectId}/sources`}
        className="text-primary hover:underline"
       >
        Sources
       </Link>{" "}
       page.
      </p>
     ) : (
      <div className="space-y-2">
       {sources.map((src) => (
        <div
         key={src.bibliographyId}
         className="rounded-md border border-border p-2.5"
        >
         <div className="flex items-start gap-2">
          <span
           className={cn(
            "inline-flex items-center rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide shrink-0 mt-0.5",
            src.priority === "primary"
             ? "bg-accent text-primary"
             : "bg-muted text-muted-foreground"
           )}
          >
           {src.priority}
          </span>
          <div className="min-w-0">
           <p className="text-xs font-medium leading-tight">
            {src.authorSurname}
            {src.authorName ? `, ${src.authorName}` : ""}
           </p>
           <p className="text-[10px] text-muted-foreground truncate">
            {src.shortTitle ?? src.title}
           </p>
          </div>
         </div>
         {src.relevance && (
          <p className="text-[10px] text-muted-foreground mt-1.5 italic leading-relaxed">
           {src.relevance}
          </p>
         )}
        </div>
       ))}
      </div>
     )}
    </section>

    {/* Style profile */}
    {styleProfile && Object.keys(styleProfile).length > 0 && (
     <>
      <Separator />
      <section>
       <div className="flex items-center gap-2 mb-2.5">
        <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
         Style Guide
        </h3>
       </div>
       <div className="space-y-1.5 text-xs">
        {styleProfile.tone && (
         <StyleRow label="Tone" value={styleProfile.tone} />
        )}
        {styleProfile.sentenceLength && (
         <StyleRow
          label="Sentences"
          value={styleProfile.sentenceLength}
         />
        )}
        {styleProfile.formality !== undefined && (
         <StyleRow
          label="Formality"
          value={`${styleProfile.formality}/10`}
         />
        )}
        {styleProfile.rhetoricalApproach && (
         <StyleRow
          label="Rhetoric"
          value={styleProfile.rhetoricalApproach}
         />
        )}
        {styleProfile.usesFirstPerson !== undefined && (
         <StyleRow
          label="1st person"
          value={styleProfile.usesFirstPerson ? "Yes" : "No"}
         />
        )}
       </div>
      </section>
     </>
    )}
   </div>
  </ScrollArea>
 );
}

function StyleRow({ label, value }: { label: string; value: string }) {
 return (
  <div className="flex items-center justify-between gap-2">
   <span className="text-muted-foreground">{label}</span>
   <span className="font-medium capitalize">{value}</span>
  </div>
 );
}
