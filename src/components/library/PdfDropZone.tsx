"use client";

/**
 * Library drop zone — two paths:
 *   - Drop 1 file (or pick 1)        → fast path, POST /api/library/upload-pdf
 *   - Drop 2+ files, click "+ Ekle"  → open BulkUploadDialog so the user
 *                                       can group multi-volume works
 *
 * Keeping single-file drop instant preserves the "I just want to add
 * one book" flow without forcing every upload through a modal.
 */
import { useRef, useState, useCallback } from "react";
import { UploadCloud, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import BulkUploadDialog from "@/components/library/BulkUploadDialog";

interface PdfDropZoneProps {
  onUploaded: () => void;
}

const ACCEPT =
  ".pdf,.epub,.docx,application/pdf,application/epub+zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXTS = [".pdf", ".epub", ".docx"];

function filterValidFiles(fileList: FileList | File[]): File[] {
  const out: File[] = [];
  for (const f of Array.from(fileList)) {
    const lower = f.name.toLowerCase();
    if (!ALLOWED_EXTS.some((ext) => lower.endsWith(ext))) {
      toast.error(`${f.name}: Sadece PDF / EPUB / DOCX kabul edilir`);
      continue;
    }
    if (f.size > MAX_BYTES) {
      toast.error(`${f.name}: 50MB sınırı aşıldı`);
      continue;
    }
    if (f.size === 0) {
      toast.error(`${f.name}: dosya boş`);
      continue;
    }
    out.push(f);
  }
  return out;
}

export default function PdfDropZone({ onUploaded }: PdfDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkInitialFiles, setBulkInitialFiles] = useState<File[]>([]);

  const uploadOne = useCallback(
    async (file: File) => {
      setUploading((n) => n + 1);
      toast.success(`${file.name} işleniyor… künye otomatik çıkarılıyor`);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/library/upload-pdf", {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Upload failed (${res.status})`);
        }
        onUploaded();
      } catch (err) {
        toast.error(
          `${file.name} yüklenemedi: ${err instanceof Error ? err.message : "hata"}`,
        );
      } finally {
        setUploading((n) => Math.max(0, n - 1));
      }
    },
    [onUploaded],
  );

  const acceptFiles = useCallback(
    (fileList: FileList | File[]) => {
      const valid = filterValidFiles(fileList);
      if (valid.length === 0) return;
      if (valid.length === 1) {
        void uploadOne(valid[0]);
      } else {
        // 2+ files → open the bulk dialog so the user can group ciltler.
        setBulkInitialFiles(valid);
        setBulkOpen(true);
      }
    },
    [uploadOne],
  );

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) acceptFiles(files);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragOver) setIsDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }

  function openEmptyBulk() {
    setBulkInitialFiles([]);
    setBulkOpen(true);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files && files.length > 0) {
      acceptFiles(files);
      e.target.value = "";
    }
  }

  return (
    <>
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`group relative flex items-center gap-4 px-5 py-5 rounded-sm border-2 border-dashed transition-all ${
          isDragOver
            ? "border-[#C9A84C] bg-[#C9A84C]/10 scale-[1.005]"
            : "border-[#C9A84C]/50 bg-[#FAF7F0]/60 hover:border-[#C9A84C]/80 hover:bg-[#FAF7F0]"
        }`}
      >
        <div className="flex items-center justify-center h-12 w-12 rounded-sm bg-[#C9A84C]/15 text-[#C9A84C] shrink-0">
          {uploading > 0 ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <UploadCloud className="h-6 w-6" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display text-base font-semibold text-[#2D1F0E]">
            {uploading > 0
              ? `${uploading} dosya işleniyor…`
              : "PDF / EPUB / DOCX sürükle"}
          </div>
          <div className="font-body text-xs text-[#6b5a45] mt-0.5">
            Tek kitap için sürükle · birden fazla dosya gruplama için
            modal açılır · 50MB&apos;a kadar
          </div>
        </div>
        <button
          type="button"
          onClick={openEmptyBulk}
          className="flex items-center gap-1.5 px-3 py-2 rounded-sm bg-[#C9A84C] text-[#1A0F05] font-ui text-xs font-semibold hover:bg-[#d4b85a] transition-colors shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          Yeni kaynak ekle
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="sr-only"
          onChange={handleChange}
        />
      </div>

      <BulkUploadDialog
        open={bulkOpen}
        onOpenChange={(o) => {
          setBulkOpen(o);
          if (!o) setBulkInitialFiles([]);
        }}
        initialFiles={bulkInitialFiles}
        onUploaded={onUploaded}
      />
    </>
  );
}
