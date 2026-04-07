"use client";

import { useState, useRef } from "react";
import {
  Search,
  Download,
  Paperclip,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type FinderState =
  | "idle"
  | "searching"
  | "found"
  | "not_found"
  | "downloading"
  | "done";

interface PdfFinderButtonProps {
  bibliographyId: string;
  projectId: string;
  onSourceLinked: () => void;
}

export default function PdfFinderButton({
  bibliographyId,
  projectId,
  onSourceLinked,
}: PdfFinderButtonProps) {
  const [state, setState] = useState<FinderState>("idle");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFindPdf(e: React.MouseEvent) {
    e.stopPropagation();
    setState("searching");

    try {
      const res = await fetch("/api/research/find-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bibliographyId }),
      });

      if (!res.ok) {
        setState("not_found");
        return;
      }

      const data = await res.json();

      if (data.found && data.pdfUrl) {
        setPdfUrl(data.pdfUrl);
        setProvider(data.provider);
        setState("found");
      } else {
        setState("not_found");
      }
    } catch {
      setState("not_found");
    }
  }

  async function handleDownloadPdf(e: React.MouseEvent) {
    e.stopPropagation();
    if (!pdfUrl) return;
    setState("downloading");

    try {
      const res = await fetch("/api/research/download-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bibliographyId, pdfUrl }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Download failed" }));
        throw new Error(err.error);
      }

      setState("done");
      toast.success("PDF indirildi ve işlendi");
      onSourceLinked();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Download failed";
      toast.error(message);
      setState("found"); // allow retry
    }
  }

  function handleManualUpload(e: React.MouseEvent) {
    e.stopPropagation();
    fileInputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setState("downloading");
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
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      toast.error(message);
      setState("not_found");
    }
  }

  const PROVIDER_LABELS: Record<string, string> = {
    unpaywall: "Unpaywall",
    semantic_scholar: "S2",
    openalex: "OpenAlex",
    core: "CORE",
    open_library: "Archive",
    doab: "DOAB",
  };

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
          onClick={handleFindPdf}
          title="PDF Bul"
          className="w-8 h-8 rounded-sm flex items-center justify-center hover:bg-[#e8dfd0]/50 transition-colors shrink-0"
        >
          <Search className="w-4 h-4 text-ink-light group-hover:text-forest transition-colors" />
        </button>
      )}

      {state === "searching" && (
        <div className="w-8 h-8 flex items-center justify-center shrink-0">
          <Loader2 className="w-4 h-4 animate-spin text-forest" />
        </div>
      )}

      {state === "found" && (
        <button
          onClick={handleDownloadPdf}
          title={`İndir (${PROVIDER_LABELS[provider ?? ""] ?? provider})`}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded-sm transition-colors shrink-0",
            "bg-forest/10 hover:bg-forest/20 text-forest"
          )}
        >
          <Download className="w-3.5 h-3.5" />
          <span className="text-[10px] font-ui font-medium">
            {PROVIDER_LABELS[provider ?? ""] ?? "PDF"}
          </span>
        </button>
      )}

      {state === "not_found" && (
        <button
          onClick={handleManualUpload}
          title="PDF bulunamadı — kendin yükle"
          className="w-8 h-8 rounded-sm flex items-center justify-center hover:bg-[#e8dfd0]/50 transition-colors shrink-0"
        >
          <Paperclip className="w-4 h-4 text-gold-dark" />
        </button>
      )}

      {state === "downloading" && (
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
