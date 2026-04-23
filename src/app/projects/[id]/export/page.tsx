"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  Download,
  FileDown,
  Loader2,
  BookOpen,
  FileText,
  Hash,
  CheckCircle2,
  Clock,
  BookMarked,
  AlertCircle,
  CloudUpload,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { toast } from "sonner";
import {
  Ornament,
  PageNumber,
  PageTitle,
  SectionTitle,
  SpineShadow,
} from "@/components/shared/BookElements";
import { FadeUp, FadeRight } from "@/components/shared/Animations";

interface ChapterOption {
  id: string;
  number: number;
  title: string;
  subsections: Array<{ id: string; title: string; subsectionId: string }>;
}

interface OutputFile {
  id: string;
  scope: string;
  fileType: string;
  filePath: string;
  createdAt: string;
  subsection: { title: string } | null;
  driveFileId: string | null;
  driveWebLink: string | null;
}

type ExportScope = "subsection" | "chapter" | "full";
type ExportFileType = "docx" | "pdf" | "epub";

const SCOPE_LABELS: Record<string, string> = {
  full: "Full Book",
  chapter: "Chapter",
  subsection: "Subsection",
};

export default function ExportPage() {
  const params = useParams();
  const projectId = params.id as string;

  const [scope, setScope] = useState<ExportScope>("full");
  const [fileType, setFileType] = useState<ExportFileType>("docx");
  const [selectedChapterId, setSelectedChapterId] = useState<string>("");
  const [selectedSubsectionId, setSelectedSubsectionId] = useState<string>("");
  const [includeBibliography, setIncludeBibliography] = useState(true);
  const [chapters, setChapters] = useState<ChapterOption[]>([]);
  const [outputs, setOutputs] = useState<OutputFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingDriveId, setUploadingDriveId] = useState<string | null>(null);
  const [includeIllustrations, setIncludeIllustrations] = useState(true);
  const [includeStructural, setIncludeStructural] = useState(true);
  const [printReady, setPrintReady] = useState(false);
  const [projectTypeState, setProjectTypeState] = useState<string>("ACADEMIC");
  // Non-academic illustration toggle needs a boolean signal from the server —
  // actual image rendering happens in the export pipeline, not here.
  const [hasIllustrations, setHasIllustrations] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [chapRes, outRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/roadmap`),
        fetch(`/api/projects/${projectId}/outputs`),
      ]);

      if (chapRes.ok) {
        const data = await chapRes.json();
        type RawChapter = {
          id: string;
          number: number;
          title: string;
          sections?: Array<{ subsections: Array<{ id: string; title: string; subsectionId: string }> }>;
        };
        const projectType = data.projectType ?? "ACADEMIC";
        setProjectTypeState(projectType);
        const chaps: ChapterOption[] = (data.chapters ?? []).map(
          (ch: RawChapter) => ({
            id: ch.id,
            number: ch.number,
            title: ch.title,
            subsections: ch.sections?.flatMap((s) => s.subsections) ?? [],
          })
        );
        setChapters(chaps);
        setSelectedChapterId((prev) => prev || (chaps.length > 0 ? chaps[0].id : ""));

        // Illustration toggle is only relevant when the project actually has
        // images — peek at the preview/images endpoint and store a boolean.
        if (projectType !== "ACADEMIC") {
          try {
            const imgRes = await fetch(`/api/projects/${projectId}/preview/images`);
            if (imgRes.ok) {
              const imgData: unknown[] = await imgRes.json();
              setHasIllustrations(Array.isArray(imgData) && imgData.length > 0);
            }
          } catch { /* ignore */ }
        }
      }

      if (outRes.ok) {
        const data = await outRes.json();
        setOutputs(data.outputs ?? []);
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleDriveUpload(outputId: string) {
    setUploadingDriveId(outputId);
    try {
      const res = await fetch(`/api/outputs/${outputId}/drive`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Drive upload failed" }));
        throw new Error(err.error ?? "Drive upload failed");
      }
      const data = await res.json();
      setOutputs((prev) =>
        prev.map((o) =>
          o.id === outputId
            ? { ...o, driveFileId: data.fileId, driveWebLink: data.webViewLink }
            : o
        )
      );
      toast.success("Uploaded to Google Drive!");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Drive upload failed";
      toast.error(message);
    } finally {
      setUploadingDriveId(null);
    }
  }

  async function handleExport() {
    setError(null);
    setIsExporting(true);

    try {
      const body: Record<string, unknown> = {
        scope,
        includeBibliography: projectTypeState === "ACADEMIC" && includeBibliography,
        includeIllustrations: projectTypeState !== "ACADEMIC" && includeIllustrations,
        includeStructural: projectTypeState === "ACADEMIC" && includeStructural,
        fileType,
        printReady: fileType === "pdf" && printReady,
      };

      if (scope === "chapter") body.chapterId = selectedChapterId;
      if (scope === "subsection") body.subsectionId = selectedSubsectionId;

      const res = await fetch(`/api/projects/${projectId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Export failed" }));
        throw new Error(err.error ?? "Export failed");
      }

      const data = await res.json();
      toast.success(`${fileType.toUpperCase()} generated successfully!`);
      setOutputs((prev) => [data.output, ...prev]);

      // Trigger download
      window.open(`/api/download?path=${encodeURIComponent(data.output.filePath)}`, "_blank");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Export failed";
      setError(message);
      toast.error(message);
    } finally {
      setIsExporting(false);
    }
  }

  const selectedChapter = chapters.find((c) => c.id === selectedChapterId);

  const isExportDisabled =
    isExporting ||
    isLoading ||
    (scope === "chapter" && !selectedChapterId) ||
    (scope === "subsection" && !selectedSubsectionId);

  return (
    <div className="flex-1 flex flex-col lg:flex-row">
      {/* LEFT PAGE — Export Settings */}
      <div className="flex-1 p-6 md:p-8 lg:p-10 flex flex-col overflow-y-auto min-h-0">
        <FadeUp>
          <PageTitle
            title="Export"
            subtitle="Generate DOCX or PDF files from your writing."
          />
        </FadeUp>
        <Ornament className="w-40 mx-auto text-[#c9bfad] mb-8" />

        <FadeUp delay={0.2} className="border border-[#d4c9b5]/60 rounded-sm bg-[#FAF7F0]/80 p-6 md:p-8">
          <SectionTitle className="mb-6">Export Settings</SectionTitle>

          {isLoading ? (
            <div className="space-y-4 animate-pulse">
              <div className="h-3 w-24 bg-[#d4c9b5]/40 rounded" />
              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 rounded-sm bg-[#d4c9b5]/20 border border-[#d4c9b5]/30" />
                ))}
              </div>
              <div className="h-3 w-28 bg-[#d4c9b5]/40 rounded mt-4" />
              <div className="grid grid-cols-2 gap-2">
                {[1, 2].map((i) => (
                  <div key={i} className="h-16 rounded-sm bg-[#d4c9b5]/20 border border-[#d4c9b5]/30" />
                ))}
              </div>
              <div className="h-10 w-full bg-[#d4c9b5]/20 rounded-sm mt-4" />
              <div className="h-12 w-full bg-[#1C1410]/10 rounded-sm mt-2" />
            </div>
          ) : (
          <>

          {/* Export Scope */}
          <div className="space-y-2 mb-5">
            <label className="font-ui text-xs uppercase tracking-widest text-[#5C4A32]">
              Scope
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["full", "chapter", "subsection"] as ExportScope[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  className={`rounded-sm border p-3 text-center transition-all ${
                    scope === s
                      ? "border-[#2C5F2E] bg-[#2C5F2E]/10"
                      : "border-[#d4c9b5]/60 hover:border-[#d4c9b5]"
                  }`}
                >
                  <div className="flex flex-col items-center gap-1.5">
                    {s === "full" && (
                      <BookOpen
                        className={`h-5 w-5 ${scope === s ? "text-[#2C5F2E]" : "text-[#8a7a65]"}`}
                      />
                    )}
                    {s === "chapter" && (
                      <Hash
                        className={`h-5 w-5 ${scope === s ? "text-[#2C5F2E]" : "text-[#8a7a65]"}`}
                      />
                    )}
                    {s === "subsection" && (
                      <FileText
                        className={`h-5 w-5 ${scope === s ? "text-[#2C5F2E]" : "text-[#8a7a65]"}`}
                      />
                    )}
                    <span
                      className={`font-ui text-[11px] ${
                        scope === s ? "text-[#2C5F2E]" : "text-[#8a7a65]"
                      }`}
                    >
                      {SCOPE_LABELS[s]}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Chapter selector */}
          {(scope === "chapter" || scope === "subsection") && chapters.length > 0 && (
            <div className="space-y-2 mb-5">
              <label
                htmlFor="chapter-select"
                className="font-ui text-xs uppercase tracking-widest text-[#5C4A32]"
              >
                Select Chapter
              </label>
              <select
                id="chapter-select"
                value={selectedChapterId}
                onChange={(e) => {
                  setSelectedChapterId(e.target.value);
                  setSelectedSubsectionId("");
                }}
                className="w-full bg-[#FAF7F0] border border-[#d4c9b5]/60 font-body text-sm text-[#2D1F0E] rounded-sm px-3 py-2.5 focus:outline-none focus:border-[#C9A84C]/50"
              >
                {chapters.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    Chapter {ch.number}: {ch.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Subsection selector */}
          {scope === "subsection" && selectedChapter && selectedChapter.subsections.length > 0 && (
            <div className="space-y-2 mb-5">
              <label
                htmlFor="sub-select"
                className="font-ui text-xs uppercase tracking-widest text-[#5C4A32]"
              >
                Select Subsection
              </label>
              <select
                id="sub-select"
                value={selectedSubsectionId}
                onChange={(e) => setSelectedSubsectionId(e.target.value)}
                className="w-full bg-[#FAF7F0] border border-[#d4c9b5]/60 font-body text-sm text-[#2D1F0E] rounded-sm px-3 py-2.5 focus:outline-none focus:border-[#C9A84C]/50"
              >
                <option value="">Select subsection...</option>
                {selectedChapter.subsections.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.subsectionId}: {sub.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* File Format */}
          <div className="space-y-2 mb-5">
            <label className="font-ui text-xs uppercase tracking-widest text-[#5C4A32]">
              File Format
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["docx", "pdf", "epub"] as ExportFileType[]).map((ft) => (
                <button
                  key={ft}
                  type="button"
                  onClick={() => setFileType(ft)}
                  className={`rounded-sm border p-3 text-center transition-all ${
                    fileType === ft
                      ? "border-[#2C5F2E] bg-[#2C5F2E]/10"
                      : "border-[#d4c9b5]/60 hover:border-[#d4c9b5]"
                  }`}
                >
                  <div className="flex flex-col items-center gap-1.5">
                    <FileDown
                      className={`h-5 w-5 ${fileType === ft ? "text-[#2C5F2E]" : "text-[#8a7a65]"}`}
                    />
                    <span
                      className={`font-ui text-[11px] uppercase ${
                        fileType === ft ? "text-[#2C5F2E]" : "text-[#8a7a65]"
                      }`}
                    >
                      {ft}
                    </span>
                  </div>
                </button>
              ))}
            </div>
            {fileType === "epub" && (
              <p className="font-body text-[11px] text-[#8a7a65] mt-1">
                Kindle, Apple Books, Kobo'ya yükleme için hazır dosya.
              </p>
            )}
          </div>

          {/* Print-ready toggle — only relevant for PDF */}
          {fileType === "pdf" && (
            <div className="space-y-2 mb-5">
              <label
                className="flex items-start gap-3 p-3 rounded-sm border border-[#d4c9b5]/60 hover:border-[#d4c9b5] cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={printReady}
                  onChange={(e) => setPrintReady(e.target.checked)}
                  className="mt-0.5 h-4 w-4"
                />
                <div className="flex-1">
                  <div className="font-ui text-xs font-medium text-[#2D1F0E]">
                    Matbaaya hazır PDF (bleed + crop marks)
                  </div>
                  <div className="font-body text-[11px] text-[#8a7a65] leading-snug mt-0.5">
                    3mm taşma + köşe kesim işaretleri. KDP / IngramSpark /
                    yerel matbaa için yükleme hazır.
                  </div>
                </div>
              </label>
            </div>
          )}

          {/* Citation format shortcut — only for ACADEMIC projects */}
          {projectTypeState === "ACADEMIC" && (
            <div className="border-t border-[#d4c9b5]/40 pt-4 mb-6">
              <a
                href={`/projects/${projectId}/settings/citations`}
                className="flex items-center justify-between p-3 rounded-sm border border-[#d4c9b5] hover:border-[#C9A84C] hover:bg-[#FAF3E3] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-sm flex items-center justify-center shrink-0"
                    style={{ backgroundColor: "rgba(201,168,76,0.18)" }}
                  >
                    <BookOpen className="h-4 w-4" style={{ color: "#8a5a1a" }} />
                  </div>
                  <div>
                    <div className="font-ui text-xs font-medium text-[#2D1F0E]">
                      Atıf Formatı
                    </div>
                    <div className="font-ui text-[11px] text-[#8a7a65] mt-0.5">
                      Enstitü/dergi formatına uyarla — canlı önizleme
                    </div>
                  </div>
                </div>
                <span className="font-ui text-[10px] text-[#8a5a1a]">Aç →</span>
              </a>
            </div>
          )}

          {/* Academic metadata shortcut — only for ACADEMIC projects */}
          {projectTypeState === "ACADEMIC" && (
            <div className="border-t border-[#d4c9b5]/40 pt-4 mb-4">
              <a
                href={`/projects/${projectId}/settings/academic`}
                className="flex items-center justify-between p-3 rounded-sm border border-[#d4c9b5] hover:border-[#C9A84C] hover:bg-[#FAF3E3] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-sm flex items-center justify-center shrink-0"
                    style={{ backgroundColor: "rgba(201,168,76,0.18)" }}
                  >
                    <BookOpen className="h-4 w-4" style={{ color: "#8a5a1a" }} />
                  </div>
                  <div>
                    <div className="font-ui text-xs font-medium text-[#2D1F0E]">
                      Akademik Metadata
                    </div>
                    <div className="font-ui text-[11px] text-[#8a7a65] mt-0.5">
                      Yazar, kurum, özet, anahtar kelimeler, önsöz — kapak ve ön sayfaları doldur
                    </div>
                  </div>
                </div>
                <span className="font-ui text-[10px] text-[#8a5a1a]">Aç →</span>
              </a>
            </div>
          )}

          {/* Structural toggle — only for ACADEMIC projects */}
          {projectTypeState === "ACADEMIC" && (
            <div className="border-t border-[#d4c9b5]/40 pt-4 mb-4">
              <button
                type="button"
                onClick={() => setIncludeStructural((v) => !v)}
                className="flex items-center justify-between w-full group"
              >
                <div className="text-left">
                  <span className="font-ui text-xs uppercase tracking-widest text-[#5C4A32] block">
                    Include Title Page + Abstract + TOC
                  </span>
                  <span className="font-body text-xs text-[#8a7a65] mt-0.5 block">
                    Formata uygun kapak, özet/abstract, içindekiler ve bölüm açılışları
                  </span>
                </div>
                {includeStructural ? (
                  <ToggleRight className="h-6 w-6 text-[#2C5F2E] shrink-0 ml-3" />
                ) : (
                  <ToggleLeft className="h-6 w-6 text-[#8a7a65] shrink-0 ml-3" />
                )}
              </button>
            </div>
          )}

          {/* Bibliography toggle — only for ACADEMIC projects */}
          {projectTypeState === "ACADEMIC" && (
          <div className="border-t border-[#d4c9b5]/40 pt-4 mb-6">
            <button
              type="button"
              onClick={() => setIncludeBibliography((v) => !v)}
              className="flex items-center justify-between w-full group"
            >
              <div className="text-left">
                <span className="font-ui text-xs uppercase tracking-widest text-[#5C4A32] block">
                  Include Bibliography
                </span>
                <span className="font-body text-xs text-[#8a7a65] mt-0.5 block">
                  Appends a formatted bibliography at the end of the file
                </span>
              </div>
              {includeBibliography ? (
                <ToggleRight className="h-6 w-6 text-[#2C5F2E] shrink-0 ml-3" />
              ) : (
                <ToggleLeft className="h-6 w-6 text-[#8a7a65] shrink-0 ml-3" />
              )}
            </button>
          </div>
          )}

          {/* Illustrations toggle — only for non-academic */}
          {projectTypeState !== "ACADEMIC" && hasIllustrations && (
            <div className="border-t border-[#d4c9b5]/40 pt-4 mb-6">
              <button
                type="button"
                onClick={() => setIncludeIllustrations((v) => !v)}
                className="flex items-center justify-between w-full group"
              >
                <div className="text-left">
                  <span className="font-ui text-xs uppercase tracking-widest text-[#5C4A32] block">
                    Include Illustrations
                  </span>
                  <span className="font-body text-xs text-[#8a7a65] mt-0.5 block">
                    Adds AI-generated images as full pages in the PDF
                  </span>
                </div>
                {includeIllustrations ? (
                  <ToggleRight className="h-6 w-6 text-[#2C5F2E] shrink-0 ml-3" />
                ) : (
                  <ToggleLeft className="h-6 w-6 text-[#8a7a65] shrink-0 ml-3" />
                )}
              </button>
            </div>
          )}

          {/* Generate button */}
          <button
            type="button"
            onClick={handleExport}
            disabled={isExportDisabled}
            className="w-full bg-[#1C1410] text-[#F5EDE0] font-ui text-sm uppercase tracking-widest rounded-sm px-4 py-3 flex items-center justify-center gap-2 transition-opacity disabled:opacity-40 hover:opacity-90"
          >
            {isExporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {isExporting
              ? `Generating ${fileType.toUpperCase()}...`
              : `Generate ${fileType.toUpperCase()}`}
          </button>
          </>
          )}
        </FadeUp>

        <div className="flex-1" />
        {error && (
          <div className="mb-4 p-3 border border-destructive/50 rounded-sm text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}
        <PageNumber number="vii" />
      </div>

      <SpineShadow />

      {/* RIGHT PAGE — Export History */}
      <div className="flex-1 p-6 md:p-8 lg:p-10 flex flex-col overflow-y-auto min-h-0 border-t lg:border-t-0 border-[#d4c9b5]/40">
        <FadeRight delay={0.3}>
          <SectionTitle className="mb-6">
            <BookMarked className="h-4 w-4 text-[#8a7a65]" />
            History
          </SectionTitle>
        </FadeRight>

        <div className="border border-[#d4c9b5]/60 rounded-sm bg-[#FAF7F0]/80 overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-[#2C5F2E]" />
            </div>
          ) : outputs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-6">
              <FileDown className="h-8 w-8 text-[#c9bfad] mb-3" />
              <p className="font-body text-sm text-[#8a7a65]">No exports yet.</p>
              <p className="font-body text-xs text-[#a89880] mt-1">
                Use the settings on the left to generate your first file.
              </p>
            </div>
          ) : (
            <div>
              {outputs.map((output, idx) => (
                <div
                  key={output.id}
                  className={`flex items-center gap-3 px-4 py-3 ${
                    idx !== outputs.length - 1
                      ? "border-b border-dashed border-[#d4c9b5]/50"
                      : ""
                  }`}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-[#e8dfd0]/50">
                    <FileText className="h-4 w-4 text-[#5C4A32]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-ui text-[10px] uppercase tracking-wider text-[#5C4A32] bg-[#e8dfd0]/50 px-1.5 py-0.5 rounded-sm">
                        {SCOPE_LABELS[output.scope] ?? output.scope}
                      </span>
                      <span className="font-ui text-[10px] uppercase tracking-wider text-[#8a7a65] bg-[#e8dfd0]/30 px-1.5 py-0.5 rounded-sm">
                        {output.fileType}
                      </span>
                      {output.subsection && (
                        <span className="font-body text-xs text-[#8a7a65] truncate max-w-[150px]">
                          {output.subsection.title}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Clock className="h-3 w-3 text-[#a89880]" />
                      <span className="font-ui text-[10px] text-[#a89880]">
                        {new Date(output.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {output.driveWebLink ? (
                      <a
                        href={output.driveWebLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Open in Google Drive"
                        className="flex h-8 w-8 items-center justify-center rounded-sm hover:bg-[#e8dfd0]/50 transition-colors"
                      >
                        <CheckCircle2 className="h-4 w-4 text-[#2C5F2E]" />
                      </a>
                    ) : (
                      <button
                        type="button"
                        className="flex h-8 w-8 items-center justify-center rounded-sm hover:bg-[#e8dfd0]/50 transition-colors disabled:opacity-40"
                        disabled={uploadingDriveId === output.id}
                        onClick={() => handleDriveUpload(output.id)}
                        aria-label="Upload to Google Drive"
                      >
                        {uploadingDriveId === output.id ? (
                          <Loader2 className="h-4 w-4 animate-spin text-[#8a7a65]" />
                        ) : (
                          <CloudUpload className="h-4 w-4 text-[#8a7a65]" />
                        )}
                      </button>
                    )}
                    <a
                      href={`/api/download?path=${encodeURIComponent(output.filePath)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Download this export"
                      className="flex h-8 w-8 items-center justify-center rounded-sm hover:bg-[#e8dfd0]/50 transition-colors"
                    >
                      <Download className="h-4 w-4 text-[#8a7a65]" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1" />
        <PageNumber number="viii" />
      </div>
    </div>
  );
}
