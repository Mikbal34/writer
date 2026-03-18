"use client";

import { Pencil, Trash2, Link2, FileCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export interface LibraryEntryRow {
 id: string;
 entryType: string;
 authorSurname: string;
 authorName: string | null;
 title: string;
 year: string | null;
 importSource: string | null;
 filePath: string | null;
 fileType: string | null;
 tags: Array<{ tag: { id: string; name: string } }>;
 _count?: { bibliographies: number };
}

interface LibraryEntryTableProps {
 entries: LibraryEntryRow[];
 onEdit: (entry: LibraryEntryRow) => void;
 onDelete: (id: string) => void;
}

const SOURCE_BADGE: Record<string, string> = {
 bibtex: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
 zotero: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
 manual: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

export default function LibraryEntryTable({
 entries,
 onEdit,
 onDelete,
}: LibraryEntryTableProps) {
 if (entries.length === 0) {
  return (
   <div className="text-center py-12">
    <p className="text-sm text-muted-foreground">
     Kütüphanenizde henüz kaynak yok.
    </p>
   </div>
  );
 }

 return (
  <div className="divide-y divide-border">
   {entries.map((entry) => (
    <button
     key={entry.id}
     type="button"
     onClick={() => onEdit(entry)}
     className="flex items-center gap-3 px-4 py-2.5 w-full text-left hover:bg-muted/40 transition-colors group"
    >
     {/* Author + Title */}
     <div className="min-w-0 flex-1">
      <div className="flex items-baseline gap-1.5">
       <span className="text-sm font-medium truncate group-hover:text-primary transition-colors">
        {entry.authorSurname}
        {entry.authorName ? `, ${entry.authorName}` : ""}
       </span>
       <span className="text-xs text-muted-foreground">—</span>
       <span className="text-sm text-muted-foreground truncate italic">
        {entry.title}
       </span>
      </div>
      {/* Tags */}
      {entry.tags.length > 0 && (
       <div className="flex gap-1 mt-0.5">
        {entry.tags.map((t) => (
         <span
          key={t.tag.id}
          className="text-[10px] bg-accent text-primary px-1.5 py-0.5 rounded"
         >
          {t.tag.name}
         </span>
        ))}
       </div>
      )}
     </div>

     {/* Year */}
     <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-10 text-right">
      {entry.year ?? "—"}
     </span>

     {/* Type badge */}
     <Badge variant="secondary" className="text-[10px] uppercase shrink-0">
      {entry.entryType}
     </Badge>

     {/* Import source badge */}
     {entry.importSource && entry.importSource !== "manual" && (
      <span
       className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${SOURCE_BADGE[entry.importSource] ?? ""}`}
      >
       {entry.importSource}
      </span>
     )}

     {/* File indicator */}
     {entry.filePath && (
      <span title={`PDF mevcut (${entry.fileType ?? 'pdf'})`}>
       <FileCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
      </span>
     )}

     {/* Linked projects count */}
     {(entry._count?.bibliographies ?? 0) > 0 && (
      <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 shrink-0" title="Bağlı proje sayısı">
       <Link2 className="h-3 w-3" />
       {entry._count!.bibliographies}
      </span>
     )}

     {/* Actions */}
     <Pencil className="h-3.5 w-3.5 shrink-0 text-transparent group-hover:text-primary transition-colors" />
     <div
      role="button"
      tabIndex={0}
      title="Sil"
      onClick={(e) => {
       e.stopPropagation();
       onDelete(entry.id);
      }}
      onKeyDown={(e) => {
       if (e.key === "Enter" || e.key === " ") {
        e.stopPropagation();
        onDelete(entry.id);
       }
      }}
      className="flex items-center justify-center h-6 w-6 shrink-0 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors cursor-pointer"
     >
      <Trash2 className="h-3.5 w-3.5 text-transparent group-hover:text-red-400 transition-colors" />
     </div>
    </button>
   ))}
  </div>
 );
}
