"use client";

import { useRef, useState, useEffect } from "react";
import { Pencil, Trash2, Link2, FileCheck, CheckCircle2, Download, ExternalLink, BookOpen, Upload, AlertTriangle, Loader2, RotateCw, Search as SearchIcon, ChevronDown } from "lucide-react";
import { StaggerItem, FadeUpLarge } from "@/components/shared/Animations";
import { toast } from "sonner";

function buildSearchLinks(entry: {
 title: string;
 authorSurname: string;
 authorName: string | null;
 doi?: string | null;
 url?: string | null;
 openAccessUrl?: string | null;
}): Array<{ label: string; href: string; hint?: string }> {
 const fullAuthor = entry.authorName
  ? `${entry.authorName} ${entry.authorSurname}`
  : entry.authorSurname;
 const q = encodeURIComponent(`${entry.title} ${fullAuthor}`);
 const links: Array<{ label: string; href: string; hint?: string }> = [
  {
   label: "Google Scholar",
   href: `https://scholar.google.com/scholar?q=${q}`,
   hint: "All versions → genelde OA PDF bulunur",
  },
  {
   label: "ResearchGate",
   href: `https://www.researchgate.net/search/publication?q=${encodeURIComponent(entry.title)}`,
   hint: "Yazarlar sıklıkla buraya upload eder",
  },
 ];
 if (entry.doi) {
  links.push({
   label: "DOI (yayıncı)",
   href: `https://doi.org/${entry.doi}`,
   hint: "Kurumsal aboneliğinle açılabilir",
  });
 }
 if (entry.url && entry.url !== entry.openAccessUrl) {
  links.push({ label: "Orijinal sayfa", href: entry.url });
 }
 return links;
}

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
 pdfStatus?: string | null;
 pdfError?: string | null;
 openAccessUrl?: string | null;
 doi?: string | null;
 url?: string | null;
 tags: Array<{ tag: { id: string; name: string } }>;
 _count?: { bibliographies: number };
}

interface LibraryEntryTableProps {
 entries: LibraryEntryRow[];
 onEdit: (entry: LibraryEntryRow) => void;
 onDelete: (id: string) => void;
 onPdfAttached?: (entryId: string) => void;
 viewMode?: "list" | "card";
}

const ENTRY_TYPE_LABELS: Record<string, string> = {
 kitap: "Book",
 makale: "Article",
 nesir: "Prose",
 ceviri: "Translation",
 tez: "Thesis",
 ansiklopedi: "Encyclopedia",
 web: "Web",
};

const ENTRY_TYPE_COLORS: Record<string, { color: string; accent: string; spine: string }> = {
 kitap: { color: "#2D5016", accent: "#4a7a2e", spine: "#1e3a0e" },
 makale: { color: "#1E3A5C", accent: "#3a6a9c", spine: "#122840" },
 nesir: { color: "#5C3D1E", accent: "#8a6a3e", spine: "#3d2810" },
 ceviri: { color: "#3D1E5C", accent: "#6a3e8a", spine: "#2a1040" },
 tez: { color: "#5C1E2D", accent: "#8a3e4d", spine: "#40101e" },
 ansiklopedi: { color: "#3D3D1E", accent: "#6a6a3e", spine: "#2a2a10" },
 web: { color: "#1E5C5C", accent: "#3a8a8a", spine: "#104040" },
};

export default function LibraryEntryTable({
 entries,
 onEdit,
 onDelete,
 onPdfAttached,
 viewMode = "list",
}: LibraryEntryTableProps) {
 const [uploadingId, setUploadingId] = useState<string | null>(null);
 const fileInputRef = useRef<HTMLInputElement>(null);
 const [pendingEntryId, setPendingEntryId] = useState<string | null>(null);
 const [findMenuOpenId, setFindMenuOpenId] = useState<string | null>(null);

 useEffect(() => {
  if (!findMenuOpenId) return;
  // Native document listener — React's synthetic stopPropagation can't
  // block it, so we check the click target's ancestry and ignore clicks
  // that landed inside the dropdown. Otherwise the dropdown would close
  // before the link's default navigation fires.
  const close = (e: MouseEvent) => {
   const target = e.target as Element | null;
   if (target?.closest?.("[data-pdf-find-menu]")) return;
   setFindMenuOpenId(null);
  };
  document.addEventListener("click", close);
  return () => document.removeEventListener("click", close);
 }, [findMenuOpenId]);

 async function handleFileSelected(entryId: string, file: File) {
  setUploadingId(entryId);
  try {
   const form = new FormData();
   form.append("file", file);
   const res = await fetch(`/api/library/entries/${entryId}/attach-pdf`, {
    method: "POST",
    body: form,
   });
   if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast.error(err.error ?? "PDF yüklenemedi");
    return;
   }
   toast.success("PDF yüklendi, arka planda işleniyor...");
   onPdfAttached?.(entryId);
  } catch {
   toast.error("Bağlantı hatası");
  } finally {
   setUploadingId(null);
   setPendingEntryId(null);
  }
 }

 async function handleReprocess(entryId: string) {
  setUploadingId(entryId);
  try {
   const res = await fetch(`/api/library/entries/${entryId}/reprocess`, {
    method: "POST",
   });
   if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast.error(err.error ?? "Yeniden işleme başarısız");
    return;
   }
   toast.success("Yeniden deneniyor...");
   onPdfAttached?.(entryId);
  } catch {
   toast.error("Bağlantı hatası");
  } finally {
   setUploadingId(null);
  }
 }
 if (entries.length === 0) {
  return (
   <div className="text-center py-12">
    <BookOpen className="h-8 w-8 text-[#c9bfad] mx-auto mb-3" />
    <p className="font-body text-sm text-[#8a7a65]">
     Your library is empty.
    </p>
   </div>
  );
 }

 if (viewMode === "card") {
  return (
   <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
    {entries.map((entry, i) => {
     const colorScheme = ENTRY_TYPE_COLORS[entry.entryType] ?? { color: "#5C4A32", accent: "#7a6a52", spine: "#3d3222" };
     return (
      <FadeUpLarge key={entry.id} delay={i * 0.05}>
      <button
       type="button"
       onClick={() => onEdit(entry)}
       className="group text-left w-full"
       style={{ perspective: "800px" }}
      >
       <div className="book-card relative overflow-hidden rounded-sm">
        {/* Spine */}
        <div
         className="absolute left-0 top-0 bottom-0 w-5 z-10"
         style={{
          background: `linear-gradient(to right, ${colorScheme.spine}, ${colorScheme.color})`,
         }}
        >
         <div className="absolute top-3 left-1/2 -translate-x-1/2 w-2.5 h-px" style={{ backgroundColor: "#C9A84C" }} />
         <div className="absolute top-5 left-1/2 -translate-x-1/2 w-1.5 h-px" style={{ backgroundColor: "rgba(201,168,76,0.6)" }} />
         <div className="absolute bottom-5 left-1/2 -translate-x-1/2 w-1.5 h-px" style={{ backgroundColor: "rgba(201,168,76,0.6)" }} />
         <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-2.5 h-px" style={{ backgroundColor: "#C9A84C" }} />
        </div>

        {/* Cover */}
        <div
         className="relative pl-5 flex flex-col min-h-[220px]"
         style={{
          background: `linear-gradient(160deg, ${colorScheme.color} 0%, ${colorScheme.accent} 100%)`,
         }}
        >
         {/* Type badge — top right */}
         <div
          className="absolute top-2.5 right-2.5 px-1.5 py-0.5 rounded-sm text-[10px] font-ui font-medium uppercase tracking-wider z-10"
          style={{
           backgroundColor: "rgba(0,0,0,0.35)",
           color: "rgba(250,247,240,0.85)",
           backdropFilter: "blur(4px)",
          }}
         >
          {ENTRY_TYPE_LABELS[entry.entryType] ?? entry.entryType}
         </div>

         {/* Title + Author area */}
         <div className="flex-1 flex flex-col justify-center px-4 py-5">
          <h3
           className="font-display text-base font-bold leading-snug line-clamp-3 mb-2"
           style={{
            color: "rgba(250,247,240,0.95)",
            textShadow: "0 1px 3px rgba(0,0,0,0.3)",
           }}
          >
           {entry.title}
          </h3>
          <p
           className="font-body text-xs line-clamp-1"
           style={{ color: "rgba(250,247,240,0.60)" }}
          >
           {entry.authorSurname}
           {entry.authorName ? `, ${entry.authorName}` : ""}
          </p>
         </div>

         {/* Bottom strip */}
         <div
          className="px-4 py-2.5"
          style={{
           backgroundColor: "rgba(250,240,220,0.12)",
           borderTop: "1px solid rgba(201,168,76,0.20)",
          }}
         >
          <div className="flex items-center justify-between gap-2">
           <span
            className="font-display text-[11px]"
            style={{ color: "rgba(250,247,240,0.55)" }}
           >
            {entry.year ?? "—"}
           </span>
           <div className="flex items-center gap-2">
            {entry.filePath && (
             <FileCheck className="h-3 w-3" style={{ color: "rgba(250,247,240,0.50)" }} />
            )}
            {(entry._count?.bibliographies ?? 0) > 0 && (
             <span className="flex items-center gap-0.5 font-ui text-[10px]" style={{ color: "rgba(250,247,240,0.50)" }}>
              <Link2 className="h-2.5 w-2.5" />
              {entry._count!.bibliographies}
             </span>
            )}
           </div>
           <div
            role="button"
            tabIndex={0}
            title="Delete"
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
            className="flex items-center justify-center h-5 w-5 rounded-sm opacity-0 group-hover:opacity-100 hover:bg-red-500/20 transition-all cursor-pointer"
           >
            <Trash2 className="h-3 w-3 text-red-300" />
           </div>
          </div>
         </div>
        </div>
       </div>
      </button>
      </FadeUpLarge>
     );
    })}
   </div>
  );
 }

 // List view (default)
 return (
  <div>
   {entries.map((entry, i) => {
    const colorScheme = ENTRY_TYPE_COLORS[entry.entryType] ?? { color: "#5C4A32", accent: "#7a6a52", spine: "#3d3222" };
    return (
     <StaggerItem
      key={entry.id}
      index={i}
      baseDelay={0.1}
      stagger={0.04}
     >
     <div
      role="button"
      tabIndex={0}
      onClick={() => onEdit(entry)}
      onKeyDown={(e) => {
       if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onEdit(entry);
       }
      }}
      className="group flex items-center gap-3 py-3.5 border-b border-dashed border-[#d4c9b5]/40 hover:bg-[#e8dfd0]/15 px-4 w-full text-left transition-colors last:border-b-0 cursor-pointer"
     >
      {/* Vertical accent bar */}
      <div
       className="w-[3px] self-stretch rounded-full shrink-0"
       style={{ backgroundColor: colorScheme.color }}
      />

      {/* Checkbox icon */}
      {entry.filePath ? (
       <div className="w-5 h-5 rounded-sm bg-forest flex items-center justify-center shrink-0">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
         <path d="M2.5 6L5 8.5L9.5 3.5" stroke="#F5EDE0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
       </div>
      ) : (
       <div className="w-5 h-5 rounded-sm border-2 border-[#d4c9b5]/60 shrink-0" />
      )}

      {/* Author + Title + Tags */}
      <div className="min-w-0 flex-1">
       <div className="flex items-baseline gap-2 flex-wrap">
        <span className="font-body text-sm font-semibold text-[#2D1F0E]">
         {entry.authorSurname}
         {entry.authorName ? `, ${entry.authorName}` : ""}
        </span>
        <span className="text-[#a89880]">—</span>
        <span className="font-body text-sm italic text-[#6b5a45] truncate">
         {entry.title}
        </span>
       </div>
       {entry.tags.length > 0 && (
        <div className="flex gap-1 mt-1">
         {entry.tags.map((t) => (
          <span
           key={t.tag.id}
           className="font-ui text-[10px] bg-[#e8dfd0] text-[#5C4A32] px-1.5 py-0.5 rounded-sm"
          >
           {t.tag.name}
          </span>
         ))}
        </div>
       )}
      </div>

      {/* Year */}
      <span className="font-display text-sm text-[#8a7a65] tabular-nums shrink-0">
       {entry.year ?? "—"}
      </span>

      {/* Type badge */}
      <span className="font-ui text-[10px] px-2 py-0.5 bg-[#e8dfd0] text-[#5C4A32] rounded-sm tracking-wider uppercase shrink-0">
       {ENTRY_TYPE_LABELS[entry.entryType] ?? entry.entryType}
      </span>

      {/* Linked projects count */}
      {(entry._count?.bibliographies ?? 0) > 0 && (
       <span className="flex items-center gap-0.5 font-ui text-[10px] text-forest shrink-0" title="Linked projects">
        <Link2 className="h-3 w-3" />
        {entry._count!.bibliographies}
       </span>
      )}

      {/* PDF status */}
      {entry.pdfStatus === "ready" ? (
       <span title="RAG için hazır" className="shrink-0 text-[#2D8B4E]">
        <FileCheck className="h-3.5 w-3.5" />
       </span>
      ) : ["downloading", "pending", "extracting", "embedding"].includes(entry.pdfStatus ?? "") ? (
       <span title={`İşleniyor: ${entry.pdfStatus}`} className="shrink-0 text-[#8a7a65]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
       </span>
      ) : entry.pdfStatus === "failed" ? (
       <div className="flex items-center gap-1 shrink-0 relative">
        <div
         role="button"
         tabIndex={0}
         title={entry.pdfError ? `PDF bul\n\n${entry.pdfError}` : "PDF bul"}
         onClick={(e) => {
          e.stopPropagation();
          setFindMenuOpenId((prev) => (prev === entry.id ? null : entry.id));
         }}
         onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
           e.stopPropagation();
           setFindMenuOpenId((prev) => (prev === entry.id ? null : entry.id));
          }
         }}
         className="flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[#8a5a1a] bg-[#C9A84C]/15 hover:bg-[#C9A84C]/30 cursor-pointer transition-colors"
        >
         <SearchIcon className="h-3 w-3" />
         <span className="font-ui text-[10px]">PDF Bul</span>
         <ChevronDown className="h-2.5 w-2.5" />
        </div>
        {findMenuOpenId === entry.id && (
         <>
          {/* Fullscreen backdrop: absorbs outside clicks and guarantees the
              menu sits above every row/hover/nav bar beneath. */}
          <div
           onClick={(e) => {
            e.stopPropagation();
            setFindMenuOpenId(null);
           }}
           style={{ position: "fixed", inset: 0, zIndex: 999, backgroundColor: "transparent" }}
          />
          <div
           data-pdf-find-menu
           onClick={(e) => e.stopPropagation()}
           onPointerDown={(e) => e.stopPropagation()}
           style={{
            position: "absolute",
            right: 0,
            top: "100%",
            marginTop: 4,
            width: 260,
            zIndex: 1000,
            backgroundColor: "#ffffff",
            border: "1px solid #d4c9b5",
            borderRadius: 3,
            boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
            padding: 8,
           }}
          >
           <p className="font-ui text-[10px] text-[#8a7a65] px-2 pb-1 border-b border-[#d4c9b5]/60 mb-1">
            Dış kaynakta PDF ara
           </p>
           {buildSearchLinks(entry).map((link) => (
            <a
             key={link.label}
             href={link.href}
             target="_blank"
             rel="noreferrer"
             className="block px-2 py-1.5 rounded-sm hover:bg-[#C9A84C]/10 transition-colors"
             onClick={(e) => {
              e.stopPropagation();
              // Navigate explicitly so React re-renders can't race the
              // default action.
              e.preventDefault();
              window.open(link.href, "_blank", "noopener,noreferrer");
              setFindMenuOpenId(null);
             }}
             title={link.hint}
            >
             <div className="flex items-center gap-1.5">
              <ExternalLink className="h-2.5 w-2.5 text-[#8a7a65]" />
              <span className="font-ui text-xs text-[#2D1F0E]">{link.label}</span>
             </div>
             {link.hint && (
              <p className="font-ui text-[10px] text-[#8a7a65] mt-0.5 ml-4">{link.hint}</p>
             )}
            </a>
           ))}
           <div className="border-t border-[#d4c9b5]/60 mt-1 pt-1">
            <button
             type="button"
             onClick={(e) => {
              e.stopPropagation();
              setFindMenuOpenId(null);
              handleReprocess(entry.id);
             }}
             className="flex items-center gap-1.5 px-2 py-1.5 w-full text-left rounded-sm hover:bg-[#C9A84C]/10 transition-colors"
            >
             <RotateCw className="h-2.5 w-2.5 text-[#8a7a65]" />
             <span className="font-ui text-xs text-[#2D1F0E]">Pipeline ile tekrar dene</span>
            </button>
            {entry.pdfError && (
             <p className="font-ui text-[9px] text-[#a89a82] mt-1 px-2 pb-1 leading-snug whitespace-pre-wrap">
              {entry.pdfError.slice(0, 200)}
             </p>
            )}
           </div>
          </div>
         </>
        )}
        <div
         role="button"
         tabIndex={0}
         title="PDF yükle (elinde dosya varsa)"
         onClick={(e) => {
          e.stopPropagation();
          setPendingEntryId(entry.id);
          fileInputRef.current?.click();
         }}
         onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
           e.stopPropagation();
           setPendingEntryId(entry.id);
           fileInputRef.current?.click();
          }
         }}
         className="flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[#2D8B4E] bg-[#2D8B4E]/10 hover:bg-[#2D8B4E]/20 cursor-pointer transition-colors"
        >
         {uploadingId === entry.id ? (
          <Loader2 className="h-3 w-3 animate-spin" />
         ) : (
          <Upload className="h-3 w-3" />
         )}
         <span className="font-ui text-[10px]">Yükle</span>
        </div>
       </div>
      ) : (
       <div
        role="button"
        tabIndex={0}
        title="PDF yükle — yazımda kullanılabilmesi için gerekli"
        onClick={(e) => {
         e.stopPropagation();
         setPendingEntryId(entry.id);
         fileInputRef.current?.click();
        }}
        onKeyDown={(e) => {
         if (e.key === "Enter" || e.key === " ") {
          e.stopPropagation();
          setPendingEntryId(entry.id);
          fileInputRef.current?.click();
         }
        }}
        className="flex items-center gap-1 px-1.5 py-0.5 shrink-0 rounded-sm text-[#c44] bg-[#c44]/10 hover:bg-[#c44]/20 cursor-pointer transition-colors"
       >
        {uploadingId === entry.id ? (
         <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
         <Upload className="h-3 w-3" />
        )}
        <span className="font-ui text-[10px]">PDF</span>
       </div>
      )}

      {/* Delete */}
      <div
       role="button"
       tabIndex={0}
       title="Delete"
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
       className="flex items-center justify-center h-6 w-6 shrink-0 rounded-sm opacity-0 group-hover:opacity-100 hover:bg-red-50 transition-all cursor-pointer"
      >
       <Trash2 className="h-3.5 w-3.5 text-red-400" />
      </div>
     </div>
     </StaggerItem>
    );
   })}
   <input
    ref={fileInputRef}
    type="file"
    accept="application/pdf"
    className="hidden"
    onChange={(e) => {
     const f = e.target.files?.[0];
     if (f && pendingEntryId) handleFileSelected(pendingEntryId, f);
     e.target.value = "";
    }}
   />
  </div>
 );
}
