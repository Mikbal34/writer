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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";

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
type ExportFileType = "docx" | "pdf";

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
    const chaps: ChapterOption[] = (data.chapters ?? []).map(
     (ch: RawChapter) => ({
      id: ch.id,
      number: ch.number,
      title: ch.title,
      subsections: ch.sections?.flatMap((s) => s.subsections) ?? [],
     })
    );
    setChapters(chaps);
    if (chaps.length > 0 && !selectedChapterId) {
     setSelectedChapterId(chaps[0].id);
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
 }, [projectId, selectedChapterId]);

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
   toast.success("Google Drive'a yüklendi!");
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
    includeBibliography,
    fileType,
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

 return (
  <div className="max-w-4xl mx-auto px-6 py-8">
   {/* Header */}
   <div className="mb-6">
    <h1 className="text-2xl font-bold tracking-tight">Export</h1>
    <p className="text-muted-foreground text-sm mt-1">
     Generate DOCX files from your completed writing.
    </p>
   </div>

   {error && (
    <Alert variant="destructive" className="mb-5">
     <AlertCircle className="h-4 w-4" />
     <AlertDescription>{error}</AlertDescription>
    </Alert>
   )}

   <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
    {/* Export settings */}
    <div className="space-y-5">
     <Card>
      <CardHeader className="pb-3">
       <div className="flex items-center gap-2">
        <FileDown className="h-4 w-4 text-primary" />
        <CardTitle className="text-base font-semibold">
         Export Settings
        </CardTitle>
       </div>
      </CardHeader>
      <CardContent className="space-y-5">
       {/* Scope */}
       <div className="space-y-2">
        <Label className="text-sm font-medium">Export Scope</Label>
        <div className="grid grid-cols-3 gap-2">
         {(["full", "chapter", "subsection"] as ExportScope[]).map((s) => (
          <button
           key={s}
           type="button"
           onClick={() => setScope(s)}
           className={`rounded-lg border-2 p-3 text-center transition-all ${
            scope === s
             ? "border-primary bg-accent"
             : "border-border hover:border-primary/30 "
           }`}
          >
           <div className="flex flex-col items-center gap-1.5">
            {s === "full" && (
             <BookOpen
              className={`h-5 w-5 ${scope === s ? "text-primary" : "text-muted-foreground"}`}
             />
            )}
            {s === "chapter" && (
             <Hash
              className={`h-5 w-5 ${scope === s ? "text-primary" : "text-muted-foreground"}`}
             />
            )}
            {s === "subsection" && (
             <FileText
              className={`h-5 w-5 ${scope === s ? "text-primary" : "text-muted-foreground"}`}
             />
            )}
            <span
             className={`text-xs font-medium capitalize ${
              scope === s ? "text-primary" : "text-muted-foreground"
             }`}
            >
             {s === "full" ? "Full Book" : s}
            </span>
           </div>
          </button>
         ))}
        </div>
       </div>

       {/* Chapter selector */}
       {(scope === "chapter" || scope === "subsection") && (
        <div className="space-y-2">
         <Label htmlFor="chapter-select" className="text-sm font-medium">
          Select Chapter
         </Label>
         <Select
          value={selectedChapterId}
          onValueChange={(v) => setSelectedChapterId(v ?? "")}
         >
          <SelectTrigger id="chapter-select">
           <SelectValue placeholder="Choose a chapter..." />
          </SelectTrigger>
          <SelectContent>
           {chapters.map((ch) => (
            <SelectItem key={ch.id} value={ch.id}>
             Ch. {ch.number}: {ch.title}
            </SelectItem>
           ))}
          </SelectContent>
         </Select>
        </div>
       )}

       {/* Subsection selector */}
       {scope === "subsection" && selectedChapter && (
        <div className="space-y-2">
         <Label htmlFor="sub-select" className="text-sm font-medium">
          Select Subsection
         </Label>
         <Select
          value={selectedSubsectionId}
          onValueChange={(v) => setSelectedSubsectionId(v ?? "")}
         >
          <SelectTrigger id="sub-select">
           <SelectValue placeholder="Choose a subsection..." />
          </SelectTrigger>
          <SelectContent>
           {selectedChapter.subsections.map((sub) => (
            <SelectItem key={sub.id} value={sub.id}>
             {sub.subsectionId}: {sub.title}
            </SelectItem>
           ))}
          </SelectContent>
         </Select>
        </div>
       )}

       {/* File type */}
       <div className="space-y-2">
        <Label className="text-sm font-medium">File Format</Label>
        <div className="grid grid-cols-2 gap-2">
         {(["docx", "pdf"] as ExportFileType[]).map((ft) => (
          <button
           key={ft}
           type="button"
           onClick={() => setFileType(ft)}
           className={`rounded-lg border-2 p-3 text-center transition-all ${
            fileType === ft
             ? "border-primary bg-accent"
             : "border-border hover:border-primary/30 "
           }`}
          >
           <div className="flex flex-col items-center gap-1.5">
            <FileDown
             className={`h-5 w-5 ${fileType === ft ? "text-primary" : "text-muted-foreground"}`}
            />
            <span
             className={`text-xs font-medium uppercase ${
              fileType === ft ? "text-primary" : "text-muted-foreground"
             }`}
            >
             {ft}
            </span>
           </div>
          </button>
         ))}
        </div>
       </div>

       <Separator />

       {/* Options */}
       <div className="flex items-center justify-between">
        <div>
         <Label
          htmlFor="bibliography-toggle"
          className="text-sm font-medium cursor-pointer"
         >
          Include Bibliography
         </Label>
         <p className="text-xs text-muted-foreground mt-0.5">
          Append formatted references at the end
         </p>
        </div>
        <Switch
         id="bibliography-toggle"
         checked={includeBibliography}
         onCheckedChange={setIncludeBibliography}
        />
       </div>

       <Button
        onClick={handleExport}
        disabled={
         isExporting ||
         isLoading ||
         (scope === "chapter" && !selectedChapterId) ||
         (scope === "subsection" && !selectedSubsectionId)
        }
        className="w-full gap-2"
       >
        {isExporting ? (
         <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
         <Download className="h-4 w-4" />
        )}
        {isExporting ? `Generating ${fileType.toUpperCase()}...` : `Generate ${fileType.toUpperCase()}`}
       </Button>
      </CardContent>
     </Card>
    </div>

    {/* Previous exports */}
    <Card>
     <CardHeader className="pb-3">
      <div className="flex items-center gap-2">
       <BookMarked className="h-4 w-4 text-primary" />
       <CardTitle className="text-base font-semibold">
        Export History
       </CardTitle>
      </div>
     </CardHeader>
     <CardContent>
      {isLoading ? (
       <div className="flex items-center justify-center py-8 gap-2">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
       </div>
      ) : outputs.length === 0 ? (
       <div className="flex flex-col items-center justify-center py-10 text-center">
        <FileDown className="h-8 w-8 text-muted-foreground/30 mb-3" />
        <p className="text-sm text-muted-foreground">
         No exports yet.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
         Generate your first DOCX using the settings on the left.
        </p>
       </div>
      ) : (
       <div className="space-y-2">
        {outputs.map((output) => (
         <div
          key={output.id}
          className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5"
         >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent">
           <FileText className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
           <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="text-xs capitalize">
             {output.scope}
            </Badge>
            {output.subsection && (
             <span className="text-xs text-muted-foreground truncate max-w-[150px]">
              {output.subsection.title}
             </span>
            )}
           </div>
           <div className="flex items-center gap-1.5 mt-0.5">
            <Clock className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
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
            >
             <Button size="icon" variant="ghost" className="h-8 w-8">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
             </Button>
            </a>
           ) : (
            <Button
             size="icon"
             variant="ghost"
             className="h-8 w-8"
             disabled={uploadingDriveId === output.id}
             onClick={() => handleDriveUpload(output.id)}
             aria-label="Upload to Google Drive"
            >
             {uploadingDriveId === output.id ? (
              <Loader2 className="h-4 w-4 animate-spin" />
             ) : (
              <CloudUpload className="h-4 w-4" />
             )}
            </Button>
           )}
           <a
            href={`/api/download?path=${encodeURIComponent(output.filePath)}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Download this export"
           >
            <Button size="icon" variant="ghost" className="h-8 w-8">
             <Download className="h-4 w-4" />
            </Button>
           </a>
          </div>
         </div>
        ))}
       </div>
      )}
     </CardContent>
    </Card>
   </div>
  </div>
 );
}
