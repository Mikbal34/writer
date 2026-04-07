"use client";

import { useState } from "react";
import { Search, Download, Loader2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface BulkResult {
  bibId: string;
  title: string;
  authorSurname: string;
  found: boolean;
  pdfUrl: string | null;
  provider: string | null;
}

interface BulkPdfFinderProps {
  projectId: string;
  missingCount: number;
  onComplete: () => void;
}

const PROVIDER_LABELS: Record<string, string> = {
  unpaywall: "Unpaywall",
  semantic_scholar: "S2",
  openalex: "OpenAlex",
  core: "CORE",
  open_library: "Archive",
  doab: "DOAB",
};

export default function BulkPdfFinder({
  projectId,
  missingCount,
  onComplete,
}: BulkPdfFinderProps) {
  const [isSearching, setIsSearching] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [results, setResults] = useState<BulkResult[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  async function handleBulkSearch() {
    setIsSearching(true);
    setShowDialog(true);
    setResults([]);

    try {
      const res = await fetch("/api/research/find-pdf/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });

      if (!res.ok) {
        toast.error("Arama başarısız oldu");
        setIsSearching(false);
        return;
      }

      const data = await res.json();
      setResults(data.results);

      const foundCount = data.results.filter((r: BulkResult) => r.found).length;
      if (foundCount > 0) {
        toast.success(`${foundCount} PDF bulundu`);
      } else {
        toast.info("Hiçbir PDF bulunamadı");
      }
    } catch {
      toast.error("Bir hata oluştu");
    } finally {
      setIsSearching(false);
    }
  }

  async function handleDownloadAll() {
    const foundResults = results.filter((r) => r.found && r.pdfUrl);
    if (foundResults.length === 0) return;

    setIsDownloading(true);
    setDownloadProgress(0);

    let successCount = 0;
    for (let i = 0; i < foundResults.length; i++) {
      const r = foundResults[i];
      try {
        const res = await fetch("/api/research/download-pdf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bibliographyId: r.bibId, pdfUrl: r.pdfUrl }),
        });
        if (res.ok) successCount++;
      } catch {
        // continue with next
      }
      setDownloadProgress(i + 1);
    }

    setIsDownloading(false);
    toast.success(`${successCount}/${foundResults.length} PDF indirildi`);
    setShowDialog(false);
    onComplete();
  }

  if (missingCount === 0) return null;

  const foundResults = results.filter((r) => r.found);
  const notFoundResults = results.filter((r) => !r.found);

  return (
    <>
      <button
        onClick={handleBulkSearch}
        disabled={isSearching}
        className="flex items-center gap-2 px-3 py-1.5 border border-[#d4c9b5] rounded-sm font-ui text-xs text-ink hover:bg-[#e8dfd0]/30 transition-colors disabled:opacity-50"
      >
        {isSearching ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Search className="h-3.5 w-3.5" />
        )}
        Tüm PDF'leri Ara
        <span className="bg-gold-dark/20 text-gold-dark px-1.5 py-0.5 rounded-full text-[10px] font-bold">
          {missingCount}
        </span>
      </button>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto bg-[#FAF7F0] border border-[#d4c9b5]">
          <DialogHeader>
            <DialogTitle className="font-display text-ink">
              Toplu PDF Arama
            </DialogTitle>
          </DialogHeader>

          {isSearching && (
            <div className="flex items-center justify-center py-8 gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-forest" />
              <span className="font-ui text-sm text-muted-foreground">
                {missingCount} kaynak aranıyor...
              </span>
            </div>
          )}

          {!isSearching && results.length > 0 && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="flex items-center gap-3 text-sm font-ui">
                <span className="text-forest font-medium">
                  {foundResults.length} bulundu
                </span>
                <span className="text-muted-foreground">•</span>
                <span className="text-muted-foreground">
                  {notFoundResults.length} bulunamadı
                </span>
              </div>

              {/* Found results */}
              {foundResults.length > 0 && (
                <div className="space-y-2">
                  <p className="font-ui text-xs text-forest font-medium uppercase tracking-wider">
                    PDF Bulundu
                  </p>
                  {foundResults.map((r) => (
                    <div
                      key={r.bibId}
                      className="flex items-center gap-2 py-2 px-3 bg-forest/5 rounded-sm"
                    >
                      <Download className="w-3.5 h-3.5 text-forest shrink-0" />
                      <span className="text-xs font-body text-ink truncate flex-1">
                        {r.authorSurname} — <em>{r.title}</em>
                      </span>
                      <span className="text-[10px] font-ui text-forest bg-forest/10 px-1.5 py-0.5 rounded-sm">
                        {PROVIDER_LABELS[r.provider ?? ""] ?? r.provider}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Not found results */}
              {notFoundResults.length > 0 && (
                <div className="space-y-2">
                  <p className="font-ui text-xs text-muted-foreground font-medium uppercase tracking-wider">
                    Bulunamadı
                  </p>
                  {notFoundResults.map((r) => (
                    <div
                      key={r.bibId}
                      className="flex items-center gap-2 py-2 px-3 text-muted-foreground"
                    >
                      <X className="w-3.5 h-3.5 shrink-0" />
                      <span className="text-xs font-body truncate">
                        {r.authorSurname} — {r.title}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Download all button */}
              {foundResults.length > 0 && (
                <button
                  onClick={handleDownloadAll}
                  disabled={isDownloading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-forest text-[#F5EDE0] rounded-sm font-ui text-sm hover:bg-forest/90 transition-colors disabled:opacity-50"
                >
                  {isDownloading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {downloadProgress}/{foundResults.length} indiriliyor...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      Hepsini İndir ({foundResults.length} PDF)
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
