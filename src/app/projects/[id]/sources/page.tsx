"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import {
 Plus,
 Loader2,
 BookMarked,
 Upload,
 ChevronDown,
 ChevronUp,
 Pencil,
 FileText,
 Search,
 Paperclip,
 FileCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
 Dialog,
 DialogContent,
 DialogHeader,
 DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import UploadArea from "@/components/sources/UploadArea";
import SourceList, { type SourceItem } from "@/components/sources/SourceList";
import KunyeForm from "@/components/sources/KunyeForm";
import LibraryPickerDialog from "@/components/library/LibraryPickerDialog";

interface BibliographyEntry {
 id: string;
 title: string;
 authorSurname: string;
 authorName: string | null;
 entryType: string;
 shortTitle: string | null;
 editor: string | null;
 translator: string | null;
 publisher: string | null;
 publishPlace: string | null;
 year: string | null;
 volume: string | null;
 edition: string | null;
 journalName: string | null;
 journalVolume: string | null;
 journalIssue: string | null;
 pageRange: string | null;
 doi: string | null;
 url: string | null;
 sourceId: string | null;
 _count?: { sourceMappings: number };
}

function isBibComplete(bib: BibliographyEntry): boolean {
 return !!(bib.authorSurname && bib.title && bib.year && bib.publisher);
}

function isBibPartial(bib: BibliographyEntry): boolean {
 return !!(bib.authorSurname && bib.title) && !isBibComplete(bib);
}

export default function SourcesPage() {
 const params = useParams();
 const projectId = params.id as string;

 const [sources, setSources] = useState<SourceItem[]>([]);
 const [allBibliography, setAllBibliography] = useState<BibliographyEntry[]>([]);
 const [isLoading, setIsLoading] = useState(true);
 const [selectedSource, setSelectedSource] = useState<SourceItem | null>(null);
 const [showKunyeDialog, setShowKunyeDialog] = useState(false);
 const [showAddBiblio, setShowAddBiblio] = useState(false);
 const [editingBiblio, setEditingBiblio] = useState<BibliographyEntry | null>(null);
 const [showUpload, setShowUpload] = useState(false);
 const [bibSearch, setBibSearch] = useState("");
 const [bibFilter, setBibFilter] = useState<"all" | "complete" | "incomplete">("all");
 const [uploadingBibId, setUploadingBibId] = useState<string | null>(null);
 const [showLibraryPicker, setShowLibraryPicker] = useState(false);
 const bibFileInputRef = useRef<HTMLInputElement>(null);
 const pendingBibIdRef = useRef<string | null>(null);

 const fetchSources = useCallback(async () => {
  try {
   const res = await fetch(`/api/projects/${projectId}`);
   if (!res.ok) throw new Error("Failed to fetch project");
   const project = await res.json();
   setSources(
    (project.sources ?? []).map((s: Record<string, unknown>) => ({
     id: s.id,
     filename: s.filename,
     fileType: s.fileType,
     totalPages: s.totalPages,
     processed: s.processed,
     bibliography: Array.isArray(s.bibliography) ? s.bibliography : [],
    }))
   );
  } catch {
   toast.error("Failed to load sources");
  } finally {
   setIsLoading(false);
  }
 }, [projectId]);

 const fetchBibliography = useCallback(async () => {
  try {
   const res = await fetch(`/api/bibliography?projectId=${projectId}`);
   if (!res.ok) return;
   const data = await res.json();
   setAllBibliography(Array.isArray(data) ? data : data.bibliography ?? []);
  } catch {
   // ignore
  }
 }, [projectId]);

 useEffect(() => {
  fetchSources();
  fetchBibliography();
 }, [fetchSources, fetchBibliography]);

 // Auto-poll while any source is still processing
 useEffect(() => {
  const hasProcessing = sources.some((s) => !s.processed);
  if (!hasProcessing) return;
  const interval = setInterval(() => {
   fetchSources();
   fetchBibliography();
  }, 3000);
  return () => clearInterval(interval);
 }, [sources, fetchSources, fetchBibliography]);

 function handleSourceClick(source: SourceItem) {
  setSelectedSource(source);
  setShowKunyeDialog(true);
  setShowAddBiblio(false);
  setEditingBiblio(null);
 }

 function handleKunyeSave() {
  setShowKunyeDialog(false);
  setSelectedSource(null);
  setShowAddBiblio(false);
  setEditingBiblio(null);
  fetchSources();
  fetchBibliography();
 }

 function handleBibUploadClick(bibId: string, e: React.MouseEvent) {
  e.stopPropagation();
  pendingBibIdRef.current = bibId;
  bibFileInputRef.current?.click();
 }

 async function handleBibFileChange(e: React.ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0];
  const bibId = pendingBibIdRef.current;
  e.target.value = "";
  if (!file || !bibId) return;

  setUploadingBibId(bibId);
  try {
   const formData = new FormData();
   formData.append("file", file);
   formData.append("projectId", projectId);
   formData.append("bibliographyId", bibId);

   const res = await fetch("/api/sources/upload", {
    method: "POST",
    body: formData,
   });

   if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(err.error ?? "Upload failed");
   }

   toast.success("Document linked successfully");
   fetchSources();
   fetchBibliography();
  } catch (err) {
   const message = err instanceof Error ? err.message : "Upload failed";
   toast.error(message);
  } finally {
   setUploadingBibId(null);
   pendingBibIdRef.current = null;
  }
 }

 const completeCount = allBibliography.filter(isBibComplete).length;
 const partialCount = allBibliography.filter(isBibPartial).length;
 const missingCount = allBibliography.length - completeCount - partialCount;

 const filteredBib = allBibliography.filter((bib) => {
  const matchesSearch =
   !bibSearch ||
   bib.authorSurname.toLowerCase().includes(bibSearch.toLowerCase()) ||
   bib.title.toLowerCase().includes(bibSearch.toLowerCase()) ||
   (bib.authorName ?? "").toLowerCase().includes(bibSearch.toLowerCase());

  if (!matchesSearch) return false;
  if (bibFilter === "complete") return isBibComplete(bib);
  if (bibFilter === "incomplete") return !isBibComplete(bib);
  return true;
 });

 return (
  <div className="max-w-5xl mx-auto px-6 py-8">
   {/* Header */}
   <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
    <div>
     <h1 className="text-2xl font-bold tracking-tight">Sources & Bibliography</h1>
     <p className="text-muted-foreground text-sm mt-1">
      Manage your references. Upload PDFs or fill in bibliography details from the roadmap.
     </p>
    </div>
    <div className="flex gap-2">
     <Button
      variant="outline"
      onClick={() => setShowUpload(!showUpload)}
      className="gap-2"
     >
      <Upload className="h-4 w-4" />
      {showUpload ? "Hide Upload" : "Upload PDF"}
      {showUpload ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
     </Button>
     <Button
      variant="outline"
      onClick={() => setShowLibraryPicker(true)}
      className="gap-2"
     >
      <BookMarked className="h-4 w-4" />
      Kütüphaneden Ekle
     </Button>
     <Button
      onClick={() => {
       setSelectedSource(null);
       setEditingBiblio(null);
       setShowAddBiblio(true);
       setShowKunyeDialog(true);
      }}
      className="gap-2"
     >
      <Plus className="h-4 w-4" />
      Add Entry
     </Button>
    </div>
   </div>

   {/* Upload area - collapsible */}
   {showUpload && (
    <Card className="mb-6">
     <CardContent className="pt-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
       <div>
        <UploadArea
         projectId={projectId}
         onUploadComplete={() => {
          fetchSources();
          setShowUpload(false);
         }}
        />
       </div>
       {sources.length > 0 && (
        <div>
         <p className="text-sm font-medium mb-3">
          Uploaded Files ({sources.length})
         </p>
         {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
         ) : (
          <SourceList
           sources={sources}
           onSourceClick={handleSourceClick}
           onSourceDeleted={() => {
            fetchSources();
            fetchBibliography();
           }}
           selectedSourceId={selectedSource?.id}
          />
         )}
        </div>
       )}
      </div>
     </CardContent>
    </Card>
   )}

   {/* Stats bar */}
   <div className="flex items-center gap-4 mb-4 flex-wrap">
    <div className="flex items-center gap-2">
     <BookMarked className="h-4 w-4 text-primary" />
     <span className="text-sm font-semibold">
      {allBibliography.length} References
     </span>
    </div>
    <Separator orientation="vertical" className="h-4" />
    <button
     onClick={() => setBibFilter(bibFilter === "complete" ? "all" : "complete")}
     className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full transition-colors ${
      bibFilter === "complete"
       ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
       : "text-muted-foreground hover:bg-muted"
     }`}
    >
     <span className="h-2 w-2 rounded-full bg-emerald-500" />
     {completeCount} Complete
    </button>
    <button
     onClick={() => setBibFilter(bibFilter === "incomplete" ? "all" : "incomplete")}
     className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full transition-colors ${
      bibFilter === "incomplete"
       ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
       : "text-muted-foreground hover:bg-muted"
     }`}
    >
     <span className="h-2 w-2 rounded-full bg-amber-500" />
     {partialCount + missingCount} Incomplete
    </button>
    {sources.length > 0 && (
     <>
      <Separator orientation="vertical" className="h-4" />
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
       <FileText className="h-3 w-3" />
       {sources.length} files uploaded
      </span>
     </>
    )}
    <div className="ml-auto relative">
     <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
     <Input
      placeholder="Search references..."
      value={bibSearch}
      onChange={(e) => setBibSearch(e.target.value)}
      className="pl-8 h-8 w-56 text-xs"
     />
    </div>
   </div>

   {/* Hidden file input for bibliography row uploads */}
   <input
    ref={bibFileInputRef}
    type="file"
    accept=".pdf,.doc,.docx,.txt"
    onChange={handleBibFileChange}
    className="hidden"
    aria-hidden="true"
   />

   {/* Bibliography table */}
   <Card>
    <CardContent className="p-0">
     {isLoading ? (
      <div className="flex items-center justify-center py-12 gap-2">
       <Loader2 className="h-5 w-5 animate-spin text-primary" />
       <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
     ) : filteredBib.length === 0 ? (
      <div className="text-center py-12">
       <BookMarked className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
       <p className="text-sm text-muted-foreground">
        {allBibliography.length === 0
         ? "No references yet. Generate a roadmap first to populate references."
         : "No matching references found."}
       </p>
      </div>
     ) : (
      <div className="divide-y divide-border">
       {filteredBib.map((bib) => {
        const complete = isBibComplete(bib);
        const partial = isBibPartial(bib);
        const missingFields: string[] = [];
        if (!bib.year) missingFields.push("yıl");
        if (!bib.publisher) missingFields.push("yayınevi");
        if (!bib.publishPlace) missingFields.push("yer");

        return (
         <button
          key={bib.id}
          type="button"
          onClick={() => {
           setEditingBiblio(bib);
           setSelectedSource(null);
           setShowAddBiblio(true);
           setShowKunyeDialog(true);
          }}
          className="flex items-center gap-3 px-4 py-2.5 w-full text-left hover:bg-muted/40 transition-colors group"
         >
          {/* Checkbox */}
          <div
           className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border-2 ${
            complete
             ? "bg-emerald-500 border-emerald-500 text-white"
             : partial
             ? "bg-amber-50 border-amber-400 dark:bg-amber-900/20"
             : "border-muted-foreground/20"
           }`}
          >
           {complete && (
            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
             <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
           )}
           {partial && <div className="h-1.5 w-1.5 rounded-sm bg-amber-500" />}
          </div>

          {/* Author + Title */}
          <div className="min-w-0 flex-1">
           <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-medium truncate group-hover:text-primary transition-colors">
             {bib.authorSurname}{bib.authorName ? `, ${bib.authorName}` : ""}
            </span>
            <span className="text-xs text-muted-foreground">—</span>
            <span className="text-sm text-muted-foreground truncate italic">
             {bib.title}
            </span>
           </div>
           {missingFields.length > 0 && (
            <span className="text-[10px] text-amber-500">
             eksik: {missingFields.join(", ")}
            </span>
           )}
          </div>

          {/* Year */}
          <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-10 text-right">
           {bib.year ?? "—"}
          </span>

          {/* Type badge */}
          <Badge variant="secondary" className="text-[10px] uppercase shrink-0">
           {bib.entryType}
          </Badge>

          {/* Document attach / linked indicator */}
          {uploadingBibId === bib.id ? (
           <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
          ) : bib.sourceId ? (
           <span title="PDF bağlı">
            <FileCheck className="h-4 w-4 shrink-0 text-emerald-500" />
           </span>
          ) : (
           <div
            role="button"
            tabIndex={0}
            title="Doküman Ekle"
            onClick={(e) => handleBibUploadClick(bib.id, e)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleBibUploadClick(bib.id, e as unknown as React.MouseEvent); }}
            className="flex items-center justify-center h-6 w-6 shrink-0 rounded hover:bg-accent transition-colors cursor-pointer"
           >
            <Paperclip className="h-3.5 w-3.5 text-muted-foreground hover:text-primary transition-colors" />
           </div>
          )}

          {/* Edit */}
          <Pencil className="h-3.5 w-3.5 shrink-0 text-transparent group-hover:text-primary transition-colors" />
         </button>
        );
       })}
      </div>
     )}
    </CardContent>
   </Card>

   {/* Kunye / Bibliography dialog */}
   <Dialog
    open={showKunyeDialog}
    onOpenChange={(open) => {
     if (!open) {
      setShowKunyeDialog(false);
      setSelectedSource(null);
      setEditingBiblio(null);
      setShowAddBiblio(false);
     }
    }}
   >
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
     <DialogHeader>
      <DialogTitle>
       {editingBiblio
        ? "Edit Bibliography Entry"
        : selectedSource
        ? `Bibliography for: ${selectedSource.filename}`
        : "Add Bibliography Entry"}
      </DialogTitle>
     </DialogHeader>

     <Separator className="my-3" />

     {(showAddBiblio || editingBiblio || !selectedSource) && (
      <KunyeForm
       projectId={projectId}
       sourceId={selectedSource?.id}
       bibliographyId={editingBiblio?.id}
       initialData={
        editingBiblio
         ? {
           entryType: editingBiblio.entryType as
            | "kitap"
            | "makale"
            | "nesir"
            | "ceviri"
            | "tez"
            | "ansiklopedi"
            | "web",
           authorSurname: editingBiblio.authorSurname,
           authorName: editingBiblio.authorName ?? "",
           title: editingBiblio.title,
           shortTitle: editingBiblio.shortTitle ?? "",
           editor: editingBiblio.editor ?? "",
           translator: editingBiblio.translator ?? "",
           publisher: editingBiblio.publisher ?? "",
           publishPlace: editingBiblio.publishPlace ?? "",
           year: editingBiblio.year ?? "",
           volume: editingBiblio.volume ?? "",
           edition: editingBiblio.edition ?? "",
           journalName: editingBiblio.journalName ?? "",
           journalVolume: editingBiblio.journalVolume ?? "",
           journalIssue: editingBiblio.journalIssue ?? "",
           pageRange: editingBiblio.pageRange ?? "",
           doi: editingBiblio.doi ?? "",
           url: editingBiblio.url ?? "",
          }
         : undefined
       }
       onSave={handleKunyeSave}
       onCancel={() => {
        setShowKunyeDialog(false);
        setSelectedSource(null);
        setEditingBiblio(null);
        setShowAddBiblio(false);
       }}
      />
     )}
    </DialogContent>
   </Dialog>

   {/* Library Picker Dialog */}
   <LibraryPickerDialog
    open={showLibraryPicker}
    onOpenChange={setShowLibraryPicker}
    projectId={projectId}
    onLinked={() => {
     fetchBibliography();
    }}
   />
  </div>
 );
}
