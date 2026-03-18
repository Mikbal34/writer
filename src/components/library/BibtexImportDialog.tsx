"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Upload, FileUp, Check } from "lucide-react";
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
    reader.onload = (ev) => {
      setContent(ev.target?.result as string);
    };
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      setContent(ev.target?.result as string);
    };
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
        const err = await res.json().catch(() => ({ error: "Import başarısız" }));
        throw new Error(err.error ?? "Import başarısız");
      }

      const data = await res.json();
      setResult(data);

      if (data.created > 0) {
        toast.success(`${data.created} kaynak eklendi.`);
        onImported();
      } else {
        toast.info("Yeni kaynak eklenmedi (tümü mevcut).");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import başarısız");
    } finally {
      setIsImporting(false);
    }
  }

  function handleClose(open: boolean) {
    if (!open) {
      setContent("");
      setFileName(null);
      setResult(null);
    }
    onOpenChange(open);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>BibTeX Aktar</DialogTitle>
        </DialogHeader>

        {/* Drop zone */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
        >
          <input
            ref={fileRef}
            type="file"
            accept=".bib,.bibtex,.txt"
            onChange={handleFileChange}
            className="hidden"
          />
          {fileName ? (
            <div className="flex items-center justify-center gap-2 text-sm">
              <FileUp className="h-5 w-5 text-primary" />
              <span className="font-medium">{fileName}</span>
            </div>
          ) : (
            <div>
              <Upload className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                .bib dosyasını sürükleyin veya tıklayın
              </p>
            </div>
          )}
        </div>

        {/* Paste area */}
        <div>
          <textarea
            placeholder="Veya BibTeX içeriğini buraya yapıştırın..."
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setResult(null);
            }}
            rows={6}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* Result */}
        {result && (
          <div className="rounded-md bg-muted p-3 text-sm space-y-1">
            <p className="flex items-center gap-1.5">
              <Check className="h-4 w-4 text-emerald-500" />
              <strong>{result.created}</strong> eklendi, <strong>{result.skipped}</strong> atlandı
              (toplam {result.total})
            </p>
            {result.errors.length > 0 && (
              <div className="text-xs text-amber-600 mt-1 max-h-20 overflow-y-auto">
                {result.errors.map((err, i) => (
                  <p key={i}>{err}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => handleClose(false)}>
            Kapat
          </Button>
          <Button
            onClick={handleImport}
            disabled={!content.trim() || isImporting}
            className="gap-2"
          >
            {isImporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileUp className="h-4 w-4" />
            )}
            {isImporting ? "İçe aktarılıyor..." : "İçe Aktar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
