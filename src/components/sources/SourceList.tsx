"use client";

import { useState } from "react";
import { FileText, FileType, Loader2, CheckCircle2, XCircle, ChevronRight, Trash2, Library as LibraryIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export interface SourceItem {
 id: string;
 filename: string;
 fileType: string;
 totalPages: number | null;
 processed: boolean;
 createdAt: string;
 bibliography: Array<{
  id: string;
  title: string;
  authorSurname: string;
  entryType: string;
 }>;
}

interface SourceListProps {
 sources: SourceItem[];
 onSourceClick: (source: SourceItem) => void;
 onSourceDeleted?: () => void;
 selectedSourceId?: string;
}

const FILE_ICON_MAP: Record<string, string> = {
 "application/pdf": "PDF",
 "application/msword": "DOC",
 "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
 "text/plain": "TXT",
};

function FileTypeBadge({ fileType }: { fileType: string }) {
 const label = FILE_ICON_MAP[fileType] ?? fileType.split("/").pop()?.toUpperCase() ?? "FILE";
 const colorMap: Record<string, string> = {
  PDF: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  DOC: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  DOCX: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  TXT: "bg-muted text-muted-foreground",
 };
 return (
  <span
   className={cn(
    "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
    colorMap[label] ?? "bg-muted text-muted-foreground"
   )}
  >
   {label}
  </span>
 );
}

export default function SourceList({
 sources,
 onSourceClick,
 onSourceDeleted,
 selectedSourceId,
}: SourceListProps) {
 const [deletingId, setDeletingId] = useState<string | null>(null);
 const [promotingId, setPromotingId] = useState<string | null>(null);

 async function handleDelete(e: React.MouseEvent, sourceId: string) {
  e.stopPropagation();
  if (!confirm("Are you sure you want to delete this source? All chunks and bibliography data will also be deleted.")) {
   return;
  }
  setDeletingId(sourceId);
  try {
   const res = await fetch(`/api/sources/${sourceId}`, { method: "DELETE" });
   if (!res.ok) throw new Error("Failed to delete source");
   toast.success("Source deleted");
   onSourceDeleted?.();
  } catch {
   toast.error("Failed to delete source");
  } finally {
   setDeletingId(null);
  }
 }

 async function handlePromote(e: React.MouseEvent, sourceId: string) {
  e.stopPropagation();
  setPromotingId(sourceId);
  try {
   const res = await fetch(`/api/library/promote-from-source/${sourceId}`, {
    method: "POST",
   });
   const data = await res.json().catch(() => ({}));
   if (!res.ok) {
    toast.error(data.error ?? "Kütüphaneye ekleme başarısız");
    return;
   }
   if (data.created) {
    toast.success(`Kütüphaneye eklendi (${data.chunksCopied} chunk kopyalandı)`);
   } else {
    toast.success("Zaten kütüphanede — bağlantı kuruldu");
   }
  } catch {
   toast.error("Bağlantı hatası");
  } finally {
   setPromotingId(null);
  }
 }
 if (sources.length === 0) {
  return (
   <div className="flex flex-col items-center justify-center py-12 text-center">
    <FileText className="h-8 w-8 text-muted-foreground/40 mb-3" />
    <p className="text-sm text-muted-foreground">No sources uploaded yet.</p>
    <p className="text-xs text-muted-foreground mt-1">
     Upload PDFs, Word documents, or text files above.
    </p>
   </div>
  );
 }

 return (
  <div className="space-y-1.5">
   {sources.map((source) => {
    const isSelected = source.id === selectedSourceId;
    const hasBibliography = source.bibliography.length > 0;

    return (
     <button
      key={source.id}
      type="button"
      onClick={() => onSourceClick(source)}
      className={cn(
       "group w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all",
       isSelected
        ? "bg-accent ring-1 ring-ring "
        : "hover:bg-muted/50"
      )}
     >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
       <FileType className="h-4.5 w-4.5 text-muted-foreground" />
      </div>

      <div className="flex-1 min-w-0">
       <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium truncate max-w-[60%]">
         {source.filename}
        </span>
        <FileTypeBadge fileType={source.fileType} />
       </div>
       <div className="flex items-center gap-2 mt-0.5">
        {source.totalPages && (
         <span className="text-xs text-muted-foreground">
          {source.totalPages} pages
         </span>
        )}
        {hasBibliography && (
         <span className="text-xs text-emerald-600 dark:text-emerald-400">
          {source.bibliography.length} biblio entr{source.bibliography.length !== 1 ? "ies" : "y"}
         </span>
        )}
       </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
       {source.processed ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
       ) : (
        <div className="flex items-center gap-1">
         <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
         <span className="text-xs text-muted-foreground">Processing</span>
        </div>
       )}
       {hasBibliography && source.processed && (
        <div
         role="button"
         tabIndex={0}
         onClick={(e) => handlePromote(e, source.id)}
         onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handlePromote(e as unknown as React.MouseEvent, source.id); }}
         className={cn(
          "p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-all cursor-pointer",
          promotingId === source.id && "pointer-events-none opacity-100"
         )}
         title="Kütüphaneme ekle"
        >
         {promotingId === source.id ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600" />
         ) : (
          <LibraryIcon className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
         )}
        </div>
       )}
       <div
        role="button"
        tabIndex={0}
        onClick={(e) => handleDelete(e, source.id)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleDelete(e as unknown as React.MouseEvent, source.id); }}
        className={cn(
         "p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-red-100 dark:hover:bg-red-900/30 transition-all cursor-pointer",
         deletingId === source.id && "pointer-events-none"
        )}
        title="Delete source"
       >
        {deletingId === source.id ? (
         <Loader2 className="h-3.5 w-3.5 animate-spin text-red-500" />
        ) : (
         <Trash2 className="h-3.5 w-3.5 text-red-500" />
        )}
       </div>
       <ChevronRight
        className={cn(
         "h-4 w-4 transition-colors",
         isSelected ? "text-primary" : "text-muted-foreground/50"
        )}
       />
      </div>
     </button>
    );
   })}
  </div>
 );
}
