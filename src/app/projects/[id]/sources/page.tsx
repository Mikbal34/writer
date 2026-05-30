"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  Plus,
  Loader2,
  BookMarked,
  FileText,
  Search,
  CheckCircle2,
  X,
  Library as LibraryIcon,
  Paperclip,
  AlertTriangle,
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
import { type SourceItem } from "@/components/sources/SourceList";
import KunyeForm from "@/components/sources/KunyeForm";
import PdfFinderButton from "@/components/sources/PdfFinderButton";
import LibraryPickerDialog from "@/components/library/LibraryPickerDialog";
import { Ornament, PageNumber, PageTitle } from "@/components/shared/BookElements";
import { FadeUp, FadeIn, StaggerItem } from "@/components/shared/Animations";

interface BibliographyAttachment {
  id: string;
  source: {
    id: string;
    filename: string;
    fileType: string;
    processed: boolean;
    totalPages: number | null;
  };
}

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
  libraryEntryId: string | null;
  libraryEntry?: {
    id: string;
    pdfStatus: string | null;
    filePath: string | null;
    fileType: string | null;
  } | null;
  attachments?: BibliographyAttachment[];
  _count?: { sourceMappings: number };
}

function AttachmentChip({
  filename,
  processed,
  sourceId,
  onDeleted,
}: {
  filename: string;
  processed: boolean;
  sourceId: string;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`"${filename}" silinsin mi?`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/sources/${sourceId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("silinemedi");
      toast.success("Dosya silindi");
      onDeleted();
    } catch {
      toast.error("Silme başarısız");
      setDeleting(false);
    }
  }

  return (
    <span
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-sandy-soft/50 border border-sandy rounded-sm text-[11px] font-ui text-ink-light max-w-[260px]"
    >
      <FileText className="h-3 w-3 shrink-0 text-ink-light" />
      <span className="truncate" title={filename}>
        {filename}
      </span>
      {!processed && (
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
      )}
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        className="text-muted-foreground hover:text-red-600 transition-colors shrink-0"
        title="Kaldır"
      >
        {deleting ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <X className="h-3 w-3" />
        )}
      </button>
    </span>
  );
}

function isBibComplete(bib: BibliographyEntry): boolean {
  return !!(bib.authorSurname && bib.title && bib.year && bib.publisher);
}

function isBibPartial(bib: BibliographyEntry): boolean {
  return !!(bib.authorSurname && bib.title) && !isBibComplete(bib);
}

// Kütüphane bağı var mı? Bibliography ya bir LibraryEntry'e bağlı
// (libraryEntryId not null) ya da değil. Bağlıysa o kitap kullanıcının
// global kütüphanesinde mevcut — başka projelerde de yeniden
// kullanılabilir.
function isInLibrary(bib: BibliographyEntry): boolean {
  return !!bib.libraryEntryId;
}

// PDF erişimi var mı? İki kaynaktan biri:
//  - Bağlı LibraryEntry'nin PDF'i ready durumda
//  - Bibliography'e doğrudan attach edilmiş Source dosya
function hasPdf(bib: BibliographyEntry): boolean {
  const libPdf =
    !!bib.libraryEntry &&
    (bib.libraryEntry.pdfStatus === "ready" || !!bib.libraryEntry.filePath);
  const localPdf = (bib.attachments?.length ?? 0) > 0;
  return libPdf || localPdf;
}

export default function SourcesPage() {
  const params = useParams();
  const projectId = params.id as string;

  const [sources, setSources] = useState<SourceItem[]>([]);
  const [allBibliography, setAllBibliography] = useState<BibliographyEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showKunyeDialog, setShowKunyeDialog] = useState(false);
  const [editingBiblio, setEditingBiblio] = useState<BibliographyEntry | null>(null);
  const [bibSearch, setBibSearch] = useState("");
  type BibFilter = "all" | "complete" | "incomplete" | "library" | "withPdf" | "noPdf";
  const [bibFilter, setBibFilter] = useState<BibFilter>("all");
  const [showLibraryPicker, setShowLibraryPicker] = useState(false);

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

  function handleKunyeSave() {
    setShowKunyeDialog(false);
    setEditingBiblio(null);
    fetchSources();
    fetchBibliography();
  }

  const completeCount = allBibliography.filter(isBibComplete).length;
  const partialCount = allBibliography.filter(isBibPartial).length;
  const missingCount = allBibliography.length - completeCount - partialCount;
  const libraryCount = allBibliography.filter(isInLibrary).length;
  const withPdfCount = allBibliography.filter(hasPdf).length;
  const noPdfCount = allBibliography.length - withPdfCount;

  // Default sıralama: PDF eksik olanlar önce — kullanıcının ilk gördüğü
  // şey aksiyon gerektiren satırlar olsun. Sonra alfabetik.
  const sortedBib = [...allBibliography].sort((a, b) => {
    const aNeeds = !hasPdf(a) ? 0 : 1;
    const bNeeds = !hasPdf(b) ? 0 : 1;
    if (aNeeds !== bNeeds) return aNeeds - bNeeds;
    return a.authorSurname.localeCompare(b.authorSurname, "tr");
  });

  const filteredBib = sortedBib.filter((bib) => {
    const matchesSearch =
      !bibSearch ||
      bib.authorSurname.toLowerCase().includes(bibSearch.toLowerCase()) ||
      bib.title.toLowerCase().includes(bibSearch.toLowerCase()) ||
      (bib.authorName ?? "").toLowerCase().includes(bibSearch.toLowerCase());

    if (!matchesSearch) return false;
    if (bibFilter === "complete") return isBibComplete(bib);
    if (bibFilter === "incomplete") return !isBibComplete(bib);
    if (bibFilter === "library") return isInLibrary(bib);
    if (bibFilter === "withPdf") return hasPdf(bib);
    if (bibFilter === "noPdf") return !hasPdf(bib);
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
            onClick={() => setShowLibraryPicker(true)}
            className="flex items-center gap-2 px-3 py-1.5 border border-sandy rounded-sm font-ui text-xs text-ink hover:bg-sandy-soft/30 transition-colors"
          >
            <BookMarked className="h-3.5 w-3.5" />
            Add from Library
          </button>
          <button
            onClick={() => {
              setEditingBiblio(null);
              setShowKunyeDialog(true);
            }}
            className="flex items-center gap-2 px-3 py-1.5 bg-forest text-page rounded-sm font-ui text-xs hover:bg-forest/90 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Entry
          </button>
        </div>
      </FadeUp>

      {/* Stats bar */}
      <FadeIn delay={0.2} className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 text-ink-light" />
          <span className="font-display text-lg font-bold text-ink">{allBibliography.length}</span>
          <span className="font-ui text-xs text-muted-foreground">References</span>
        </div>
        <div className="h-4 w-px bg-sandy" />
        <button
          onClick={() => setBibFilter(bibFilter === "complete" ? "all" : "complete")}
          className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full transition-colors ${
            bibFilter === "complete"
              ? "bg-sandy-soft text-forest font-medium"
              : "text-muted-foreground hover:bg-sandy-soft/40"
          }`}
        >
          <span className="h-2 w-2 rounded-full bg-forest" />
          {completeCount} Complete
        </button>
        <button
          onClick={() => setBibFilter(bibFilter === "incomplete" ? "all" : "incomplete")}
          className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full transition-colors ${
            bibFilter === "incomplete"
              ? "bg-sandy-soft text-gold-dark font-medium"
              : "text-muted-foreground hover:bg-sandy-soft/40"
          }`}
        >
          <span className="h-2 w-2 rounded-full bg-gold-dark" />
          {partialCount + missingCount} Incomplete
        </button>
        <div className="h-4 w-px bg-sandy" />
        <button
          onClick={() => setBibFilter(bibFilter === "library" ? "all" : "library")}
          className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full transition-colors ${
            bibFilter === "library"
              ? "bg-emerald-100 text-emerald-700 font-medium"
              : "text-muted-foreground hover:bg-emerald-50/60"
          }`}
          title="Kütüphanedeki kitaplarla eşleşmiş kaynaklar"
        >
          <LibraryIcon className="h-3 w-3" />
          {libraryCount} Kütüphanede
        </button>
        <button
          onClick={() => setBibFilter(bibFilter === "withPdf" ? "all" : "withPdf")}
          className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full transition-colors ${
            bibFilter === "withPdf"
              ? "bg-sky-100 text-sky-700 font-medium"
              : "text-muted-foreground hover:bg-sky-50/60"
          }`}
          title="PDF'i erişilebilir kaynaklar (kütüphaneden ya da proje uploadından)"
        >
          <Paperclip className="h-3 w-3" />
          {withPdfCount} PDF&apos;li
        </button>
        <button
          onClick={() => setBibFilter(bibFilter === "noPdf" ? "all" : "noPdf")}
          className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full transition-colors ${
            bibFilter === "noPdf"
              ? "bg-amber-100 text-amber-800 font-medium"
              : "text-muted-foreground hover:bg-amber-50/60"
          }`}
          title="PDF erişimi olmayan kaynaklar — yazıya gömülemez, üzerinde aksiyon gerekir"
        >
          <AlertTriangle className="h-3 w-3" />
          {noPdfCount} PDF eksik
        </button>
        <div className="ml-auto relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search references..."
            value={bibSearch}
            onChange={(e) => setBibSearch(e.target.value)}
            className="pl-8 h-8 w-56 bg-page border-sandy font-ui text-xs"
          />
        </div>
      </FadeIn>

      {/* Ornament divider */}
      <Ornament className="w-48 mx-auto text-sandy mb-4" />

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
              const attachments = bib.attachments ?? [];
              const inLib = isInLibrary(bib);
              const pdfOk = hasPdf(bib);

              return (
                <StaggerItem
                  key={bib.id}
                  index={bibIndex}
                  baseDelay={0.3}
                  stagger={0.08}
                  className="group flex flex-col py-4 border-b border-sandy/40 hover:bg-sandy-soft/15 px-4 -mx-4 transition-colors last:border-b-0 cursor-pointer"
                  onClick={() => {
                    setEditingBiblio(bib);
                    setShowKunyeDialog(true);
                  }}
                >
                  <div className="flex items-center gap-4">
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
                    <span className="font-ui text-[10px] px-2 py-0.5 bg-sandy-soft text-ink-light rounded-sm tracking-wider shrink-0">
                      {bib.entryType}
                    </span>

                    {/* Status badges — kütüphane bağı / PDF / PDF eksik */}
                    <div className="flex items-center gap-1 shrink-0">
                      {inLib && (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded-sm text-[10px] font-ui"
                          title="Bu kaynak senin kütüphanende — başka projelerde de kullanılabilir."
                        >
                          <LibraryIcon className="h-3 w-3" />
                        </span>
                      )}
                      {pdfOk && (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-sky-100 text-sky-700 rounded-sm text-[10px] font-ui"
                          title="PDF erişimi var — yazıya doğrudan alıntılanabilir."
                        >
                          <Paperclip className="h-3 w-3" />
                        </span>
                      )}
                      {!pdfOk && (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded-sm text-[10px] font-ui font-medium"
                          title="PDF erişimi yok — yazma sırasında bu kaynaktan alıntı yapılamaz."
                        >
                          <AlertTriangle className="h-3 w-3" />
                          eksik
                        </span>
                      )}
                    </div>

                    {/* Reverse promote — naked bibliography'i kütüphaneye taşı.
                        Sadece kütüphanede DEĞİL olanlarda göster. */}
                    {!inLib && (
                      <PromoteToLibraryButton
                        bibliographyId={bib.id}
                        onPromoted={() => {
                          fetchSources();
                          fetchBibliography();
                        }}
                      />
                    )}

                    {/* Paperclip upload — always clickable, adds another PDF.
                        Library PDF varsa görsel olarak soluklaşır + tooltip değişir. */}
                    <PdfFinderButton
                      bibliographyId={bib.id}
                      projectId={projectId}
                      hasSource={attachments.length > 0}
                      libraryHasPdf={
                        !!bib.libraryEntry &&
                        (bib.libraryEntry.pdfStatus === "ready" || !!bib.libraryEntry.filePath)
                      }
                      onSourceLinked={() => {
                        fetchSources();
                        fetchBibliography();
                      }}
                    />
                  </div>

                  {/* Attached PDFs */}
                  {attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 ml-9 mt-2">
                      {attachments.map((att) => (
                        <AttachmentChip
                          key={att.id}
                          filename={att.source.filename}
                          processed={att.source.processed}
                          sourceId={att.source.id}
                          onDeleted={() => {
                            fetchSources();
                            fetchBibliography();
                          }}
                        />
                      ))}
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
            setEditingBiblio(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-page border border-sandy">
          <DialogHeader>
            <DialogTitle className="font-display text-ink">
              {editingBiblio ? "Edit Bibliography Entry" : "Add Bibliography Entry"}
            </DialogTitle>
          </DialogHeader>

          <Separator className="my-3 bg-sandy" />

          <KunyeForm
            projectId={projectId}
            bibliographyId={editingBiblio?.id}
            linkedLibraryEntry={
              editingBiblio?.libraryEntryId
                ? {
                    id: editingBiblio.libraryEntryId,
                    title: editingBiblio.title,
                    authorSurname: editingBiblio.authorSurname,
                  }
                : null
            }
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
              setEditingBiblio(null);
            }}
          />
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

function PromoteToLibraryButton({
  bibliographyId,
  onPromoted,
}: {
  bibliographyId: string;
  onPromoted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    setBusy(true);
    try {
      const res = await fetch(`/api/library/from-bibliography/${bibliographyId}`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Kütüphaneye eklenemedi");
        return;
      }
      if (data.matched) {
        toast.success("Kütüphanede zaten vardı — bağlantı kuruldu");
      } else {
        toast.success("Kütüphaneye eklendi (PDF'i kütüphane sayfasından yükleyebilirsin)");
      }
      onPromoted();
    } catch {
      toast.error("Bağlantı hatası");
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-emerald-100 text-emerald-600 disabled:opacity-50"
      title="Kütüphaneye ekle — başka projelerde de kullanılabilir hale gelir"
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <LibraryIcon className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
