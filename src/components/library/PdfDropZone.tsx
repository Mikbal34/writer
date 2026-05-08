"use client";

import { useRef, useState, useCallback } from "react";
import { UploadCloud, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface PdfDropZoneProps {
  onUploaded: () => void;
}

const ACCEPT =
  ".pdf,.epub,.docx,application/pdf,application/epub+zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_BYTES = 50 * 1024 * 1024;

const ALLOWED_EXTS = [".pdf", ".epub", ".docx"];

export default function PdfDropZone({ onUploaded }: PdfDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploading, setUploading] = useState(0);

  const uploadFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      const valid: File[] = [];
      for (const f of files) {
        const lower = f.name.toLowerCase();
        const allowed = ALLOWED_EXTS.some((ext) => lower.endsWith(ext));
        if (!allowed) {
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
        valid.push(f);
      }
      if (valid.length === 0) return;

      toast.success(
        `${valid.length} dosya işleniyor… künye otomatik çıkarılıyor`,
      );
      setUploading((n) => n + valid.length);

      const results = await Promise.allSettled(
        valid.map(async (file) => {
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
          return res.json();
        }),
      );

      setUploading((n) => Math.max(0, n - valid.length));

      const failed = results.filter((r) => r.status === "rejected") as Array<
        PromiseRejectedResult
      >;
      if (failed.length > 0) {
        toast.error(`${failed.length} PDF yüklenemedi: ${failed[0].reason?.message ?? "hata"}`);
      }
      onUploaded();
    },
    [onUploaded],
  );

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) uploadFiles(files);
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

  function handleClick() {
    inputRef.current?.click();
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files && files.length > 0) {
      uploadFiles(files);
      e.target.value = "";
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave}
      className={`group relative flex items-center gap-4 px-5 py-5 rounded-sm border-2 border-dashed cursor-pointer transition-all ${
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
            : "PDF / EPUB / DOCX sürükle ya da tıklayıp seç"}
        </div>
        <div className="font-body text-xs text-[#6b5a45] mt-0.5">
          Yazar, başlık, yıl ve özet otomatik çıkarılır · 50MB&apos;a kadar · birden fazla dosya
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="sr-only"
        onChange={handleChange}
      />
    </div>
  );
}
