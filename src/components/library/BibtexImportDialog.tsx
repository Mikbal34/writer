"use client";

/**
 * BibTeX içe aktarma diyaloğu. Tasarım dili AddSourceDialog ile aynı:
 * dark olive hero header, parchment body, gold accent button.
 */
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Loader2, Upload, FileUp, Check, X, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";

interface BibtexImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export default function BibtexImportDialog({
  open,
  onOpenChange,
  onImported,
}: BibtexImportDialogProps) {
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<{
    created: number;
    skipped: number;
    total: number;
    errors: string[];
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => setContent(ev.target?.result as string);
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => setContent(ev.target?.result as string);
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!content.trim()) {
      toast.error("BibTeX içeriği boş");
      return;
    }
    setIsImporting(true);
    try {
      const res = await fetch("/api/library/import/bibtex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "İçe aktarma başarısız" }));
        throw new Error(err.error ?? "İçe aktarma başarısız");
      }
      const data = await res.json();
      setResult(data);
      if (data.created > 0) {
        toast.success(`${data.created} kaynak eklendi.`);
        onImported();
      } else {
        toast.info("Yeni kaynak eklenmedi (hepsi zaten kütüphanende).");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "İçe aktarma başarısız");
    } finally {
      setIsImporting(false);
    }
  }

  function handleClose(o: boolean) {
    if (!o) {
      setContent("");
      setFileName(null);
      setResult(null);
    }
    onOpenChange(o);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[720px] sm:max-w-[720px] w-[88vw] max-h-[86vh] p-0 gap-0 overflow-hidden border-0 bg-parchment flex flex-col"
      >
        {/* Dark olive hero header */}
        <div
          className="px-6 pt-5 pb-5 text-gold-soft relative overflow-hidden flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #2a3d28 0%, #1a2818 100%)" }}
        >
          <div
            className="absolute -top-2 right-5 opacity-[0.14] font-serif italic leading-none pointer-events-none select-none"
            style={{ fontSize: 110, color: "var(--color-gold-soft)" }}
          >
            B
          </div>
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <div className="inline-flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.14em] font-semibold text-gold-soft/65 mb-1">
                <FileUp size={11} /> BibTeX içe aktar
              </div>
              <h2 className="font-serif italic text-2xl font-medium text-white leading-tight m-0">
                .bib dosyasından künyeleri al
              </h2>
            </div>
            <button
              onClick={() => handleClose(false)}
              className="w-[30px] h-[30px] rounded-full bg-white/12 border-0 text-gold-soft flex items-center justify-center hover:bg-white/20 transition"
              aria-label="Kapat"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-[22px] pb-1">
          {/* Drop zone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-ink-muted/30 rounded-lg p-7 text-center cursor-pointer hover:border-forest/60 hover:bg-forest/3 transition-colors"
          >
            <input
              ref={fileRef}
              type="file"
              accept=".bib,.bibtex,.txt"
              onChange={handleFileChange}
              className="hidden"
            />
            {fileName ? (
              <div className="flex items-center justify-center gap-2 text-[13px]">
                <FileUp className="h-5 w-5 text-forest" />
                <span className="font-semibold text-ink">{fileName}</span>
              </div>
            ) : (
              <div>
                <Upload className="h-7 w-7 text-ink-muted/50 mx-auto mb-2" />
                <p className="text-[13px] text-ink-muted">
                  Bir <code className="font-mono text-[12px] bg-parchment-dark/60 px-1.5 py-0.5 rounded">.bib</code> dosyasını sürükle ya da tıkla
                </p>
              </div>
            )}
          </div>

          {/* Paste area */}
          <div className="mt-4">
            <div className="text-[10.5px] tracking-[0.14em] uppercase font-semibold text-forest mb-2 flex items-center gap-2">
              Veya doğrudan yapıştır
              <span className="flex-1 h-px bg-forest/20" />
            </div>
            <textarea
              placeholder="@article{key, author={...}, title={...}, year={2024}, ...}"
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                setResult(null);
              }}
              rows={8}
              className="w-full rounded-md border border-ink-muted/25 bg-parchment-dark/30 px-3 py-2 text-[12.5px] font-mono resize-y focus:outline-none focus:border-forest/60 text-ink"
            />
          </div>

          {/* Result */}
          {result && (
            <div className="mt-4 rounded-md bg-forest/5 border border-forest/20 p-3 text-[13px] space-y-1">
              <p className="flex items-center gap-1.5 text-ink">
                <Check className="h-4 w-4 text-forest" />
                <strong>{result.created}</strong> eklendi,{" "}
                <strong>{result.skipped}</strong> atlandı (toplam {result.total})
              </p>
              {result.errors.length > 0 && (
                <div className="text-[11.5px] text-gold-dark mt-1 max-h-24 overflow-y-auto">
                  {result.errors.map((err, i) => (
                    <p key={i}>{err}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2.5 px-6 py-3.5 border-t border-ink-muted/15 bg-parchment-dark/30 flex-shrink-0">
          <span className="text-[11.5px] text-ink-muted inline-flex items-center gap-1.5">
            <Sparkles size={11} className="text-gold" />
            Künyeler kaynak olarak eklenir, PDF eklenmez
          </span>
          <span className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => handleClose(false)}>
            İptal
          </Button>
          <Button
            size="sm"
            onClick={handleImport}
            disabled={!content.trim() || isImporting}
            className="bg-forest hover:bg-forest/90 text-white gap-1"
          >
            {isImporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus size={13} />
            )}
            {isImporting ? "İçe aktarılıyor..." : "İçe aktar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
