"use client";

import { useState, useRef } from "react";
import { Paperclip, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type UploadState = "idle" | "uploading" | "done";

interface PdfFinderButtonProps {
  bibliographyId: string;
  projectId: string;
  hasSource?: boolean;
  onSourceLinked: () => void;
}

export default function PdfFinderButton({
  bibliographyId,
  projectId,
  hasSource = false,
  onSourceLinked,
}: PdfFinderButtonProps) {
  const [state, setState] = useState<UploadState>("idle");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    fileInputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setState("uploading");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("projectId", projectId);
      formData.append("bibliographyId", bibliographyId);

      const res = await fetch("/api/sources/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error ?? "Upload failed");
      }

      setState("done");
      toast.success("Dosya yüklendi");
      onSourceLinked();
      setTimeout(() => setState("idle"), 1500);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      toast.error(message);
      setState("idle");
    }
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.txt"
        onChange={handleFileChange}
        className="hidden"
        aria-hidden="true"
      />

      {state === "idle" && (
        <button
          onClick={handleClick}
          title={hasSource ? "Başka PDF ekle" : "PDF yükle"}
          className="w-8 h-8 rounded-sm flex items-center justify-center hover:bg-[#e8dfd0]/50 transition-colors shrink-0"
        >
          <Paperclip
            className={cn(
              "w-4 h-4 transition-colors",
              hasSource
                ? "text-forest"
                : "text-ink-light group-hover:text-forest"
            )}
          />
        </button>
      )}

      {state === "uploading" && (
        <div className="w-8 h-8 flex items-center justify-center shrink-0">
          <Loader2 className="w-4 h-4 animate-spin text-forest" />
        </div>
      )}

      {state === "done" && (
        <div className="w-8 h-8 flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-4 h-4 text-forest" />
        </div>
      )}
    </>
  );
}
