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
  CheckCircle2,
  Download,
  BookOpen,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import UploadArea from "@/components/sources/UploadArea";
import SourceList, { type SourceItem } from "@/components/sources/SourceList";
import KunyeForm from "@/components/sources/KunyeForm";
import LibraryPickerDialog from "@/components/library/LibraryPickerDialog";
import { Ornament, PageNumber, PageTitle } from "@/components/shared/BookElements";
import { FadeUp, FadeIn, StaggerItem } from "@/components/shared/Animations";

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
    }, 10000);
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
    <div className="max-w-5xl mx-auto px-6 py-8 overflow-y-auto flex-1 min-h-0">
      {/* Header */}
      <FadeUp className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <PageTitle
          title="Sources & Bibliography"
          subtitle="Manage your sources. Upload PDFs or fill in bibliography details from the roadmap."
        />
        <div className="flex gap-2">
          <button
            onClick={() => setShowUpload(!showUpload)}
            className="flex items-center gap-2 px-3 py-1.5 border border-[#d4c9b5] rounded-sm font-ui text-xs text-ink hover:bg-[#e8dfd0]/30 transition-colors"
          >
            <Upload className="h-3.5 w-3.5" />
            {showUpload ? "Hide Upload" : "Upload PDF"}
            {showUpload ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>
          <button
            onClick={() => setShowLibraryPicker(true)}
            className="flex items-center gap-2 px-3 py-1.5 border border-[#d4c9b5] rounded-sm font-ui text-xs text-ink hover:bg-[#e8dfd0]/30 transition-colors"
          >
            <BookMarked className="h-3.5 w-3.5" />
            Add from Library
          </button>
          <button
            onClick={() => {
              setSelectedSource(null);
              setEditingBiblio(null);
              setShowAddBiblio(true);
              setShowKunyeDialog(true);
            }}
            className="flex items-center gap-2 px-3 py-1.5 bg-forest text-[#F5EDE0] rounded-sm font-ui text-xs hover:bg-forest/90 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Entry
          </button>
        </div>
      </FadeUp>

      {/* Upload area - collapsible */}
      {showUpload && (
        <div className="mb-6 border border-[#d4c9b5] rounded-sm bg-[#FAF7F0] p-5">
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
                <p className="font-ui text-sm font-medium mb-3 text-ink">
                  Uploaded Files ({sources.length})
                </p>
                {isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-forest" />
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
        </div>
      )}

      {/* Stats bar */}
      <FadeIn delay={0.2} className="flex items-center gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 text-ink-light" />
          <span className="font-display text-lg font-bold text-ink">{allBibliography.length}</span>
          <span className="font-ui text-xs text-muted-foreground">References</span>
        </div>
        <div className="h-4 w-px bg-[#d4c9b5]" />
        <button
          onClick={() => setBibFilter(bibFilter === "complete" ? "all" : "complete")}
          className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full transition-colors ${
            bibFilter === "complete"
              ? "bg-[#e8dfd0] text-forest font-medium"
              : "text-muted-foreground hover:bg-[#e8dfd0]/40"
          }`}
        >
          <span className="h-2 w-2 rounded-full bg-forest" />
          {completeCount} Complete
        </button>
        <button
          onClick={() => setBibFilter(bibFilter === "incomplete" ? "all" : "incomplete")}
          className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full transition-colors ${
            bibFilter === "incomplete"
              ? "bg-[#e8dfd0] text-gold-dark font-medium"
              : "text-muted-foreground hover:bg-[#e8dfd0]/40"
          }`}
        >
          <span className="h-2 w-2 rounded-full bg-gold-dark" />
          {partialCount + missingCount} Incomplete
        </button>
        {sources.length > 0 && (
          <>
            <div className="h-4 w-px bg-[#d4c9b5]" />
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground font-ui">
              <BookOpen className="h-3.5 w-3.5 text-ink-light" />
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
            className="pl-8 h-8 w-56 bg-[#FAF7F0] border-[#d4c9b5] font-ui text-xs"
          />
        </div>
      </FadeIn>

      {/* Hidden file input for bibliography row uploads */}
      <input
        ref={bibFileInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.txt"
        onChange={handleBibFileChange}
        className="hidden"
        aria-hidden="true"
      />

      {/* Ornament divider */}
      <Ornament className="w-48 mx-auto text-[#c9bfad] mb-4" />

      {/* Bibliography table */}
      <div className="flex-1 px-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-forest" />
            <span className="font-ui text-sm text-muted-foreground">Loading...</span>
          </div>
        ) : filteredBib.length === 0 ? (
          <div className="text-center py-12">
            <BookMarked className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="font-body text-sm text-muted-foreground">
              {allBibliography.length === 0
                ? "No references yet. Generate a roadmap first to populate references."
                : "No matching references found."}
            </p>
          </div>
        ) : (
          <div>
            {filteredBib.map((bib, bibIndex) => {
              const complete = isBibComplete(bib);
              const partial = isBibPartial(bib);
              const missingFields: string[] = [];
              if (!bib.year) missingFields.push("yıl");
              if (!bib.publisher) missingFields.push("yayınevi");
              if (!bib.publishPlace) missingFields.push("yer");

              return (
                <StaggerItem
                  key={bib.id}
                  index={bibIndex}
                  baseDelay={0.3}
                  stagger={0.08}
                  className="group flex items-center gap-4 py-4 border-b border-[#d4c9b5]/40 hover:bg-[#e8dfd0]/15 px-4 -mx-4 transition-colors last:border-b-0 cursor-pointer"
                  onClick={() => {
                    setEditingBiblio(bib);
                    setSelectedSource(null);
                    setShowAddBiblio(true);
                    setShowKunyeDialog(true);
                  }}
                >
                  {/* Status icon */}
                  {complete ? (
                    <CheckCircle2 className="w-5 h-5 text-forest shrink-0" />
                  ) : partial ? (
                    <CheckCircle2 className="w-5 h-5 text-gold-dark shrink-0" />
                  ) : (
                    <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/20 shrink-0" />
                  )}

                  {/* Author + Title */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-body text-sm font-semibold text-ink">
                        {bib.authorSurname}
                        {bib.authorName ? `, ${bib.authorName}` : ""}
                      </span>
                      <span className="text-muted-foreground">—</span>
                      <span className="font-body text-sm italic text-ink-light truncate">
                        {bib.title}
                      </span>
                    </div>
                    {missingFields.length > 0 && (
                      <span className="text-[10px] text-gold-dark">
                        eksik: {missingFields.join(", ")}
                      </span>
                    )}
                  </div>

                  {/* Year */}
                  <span className="font-display text-sm text-muted-foreground shrink-0">
                    {bib.year ?? "—"}
                  </span>

                  {/* Type badge */}
                  <span className="font-ui text-[10px] px-2 py-0.5 bg-[#e8dfd0] text-ink-light rounded-sm tracking-wider shrink-0">
                    {bib.entryType}
                  </span>

                  {/* Download / attach */}
                  {uploadingBibId === bib.id ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-forest" />
                  ) : bib.sourceId ? (
                    <button
                      onClick={(e) => e.stopPropagation()}
                      className="w-8 h-8 rounded-sm flex items-center justify-center hover:bg-[#e8dfd0]/50 transition-colors shrink-0"
                    >
                      <Download className="w-4 h-4 text-ink-light group-hover:text-forest transition-colors" />
                    </button>
                  ) : (
                    <div
                      role="button"
                      tabIndex={0}
                      title="Add Document"
                      onClick={(e) => handleBibUploadClick(bib.id, e)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ")
                          handleBibUploadClick(
                            bib.id,
                            e as unknown as React.MouseEvent
                          );
                      }}
                      className="w-8 h-8 rounded-sm flex items-center justify-center hover:bg-[#e8dfd0]/50 transition-colors shrink-0"
                    >
                      <Paperclip className="w-4 h-4 text-ink-light group-hover:text-forest transition-colors" />
                    </div>
                  )}
                </StaggerItem>
              );
            })}
          </div>
        )}
      </div>

      <PageNumber number="v" />

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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-[#FAF7F0] border border-[#d4c9b5]">
          <DialogHeader>
            <DialogTitle className="font-display text-ink">
              {editingBiblio
                ? "Edit Bibliography Entry"
                : selectedSource
                ? `Bibliography for: ${selectedSource.filename}`
                : "Add Bibliography Entry"}
            </DialogTitle>
          </DialogHeader>

          <Separator className="my-3 bg-[#d4c9b5]" />

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
