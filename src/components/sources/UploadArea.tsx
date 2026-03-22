"use client";

import { useRef, useState } from "react";
import { Upload, FileText, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface UploadAreaProps {
 projectId: string;
 onUploadComplete?: () => void;
}

const ACCEPTED_TYPES = [
 "application/pdf",
 "application/msword",
 "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
 "text/plain",
];

const ACCEPTED_EXTENSIONS = [".pdf", ".doc", ".docx", ".txt"];
const MAX_SIZE_MB = 100;

export default function UploadArea({
 projectId,
 onUploadComplete,
}: UploadAreaProps) {
 const inputRef = useRef<HTMLInputElement>(null);
 const [isDragging, setIsDragging] = useState(false);
 const [uploading, setUploading] = useState<string[]>([]);
 const [uploadErrors, setUploadErrors] = useState<string[]>([]);

 function isValidFile(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type) && !ACCEPTED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) {
   return `${file.name}: unsupported file type`;
  }
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
   return `${file.name}: file exceeds ${MAX_SIZE_MB}MB limit`;
  }
  return null;
 }

 async function uploadFile(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("projectId", projectId);

  setUploading((prev) => [...prev, file.name]);

  try {
   const res = await fetch(`/api/sources/upload`, {
    method: "POST",
    body: formData,
   });

   if (res.status === 402) {
    const errData = await res.json().catch(() => ({}));
    toast.error(`Insufficient credits (${errData.balance ?? 0} remaining).`);
    setUploading((prev) => prev.filter((n) => n !== file.name));
    return;
   }
   if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(err.error ?? "Upload failed");
   }

   toast.success(`${file.name} uploaded successfully`);
   onUploadComplete?.();
  } catch (err) {
   const message = err instanceof Error ? err.message : "Upload failed";
   setUploadErrors((prev) => [...prev, `${file.name}: ${message}`]);
   toast.error(`Failed to upload ${file.name}`);
  } finally {
   setUploading((prev) => prev.filter((n) => n !== file.name));
  }
 }

 async function handleFiles(files: FileList | File[]) {
  const fileArray = Array.from(files);
  const errors: string[] = [];

  const validFiles: File[] = [];
  for (const file of fileArray) {
   const error = isValidFile(file);
   if (error) {
    errors.push(error);
   } else {
    validFiles.push(file);
   }
  }

  if (errors.length > 0) {
   setUploadErrors(errors);
  }

  await Promise.all(validFiles.map(uploadFile));
 }

 function handleDragOver(e: React.DragEvent) {
  e.preventDefault();
  setIsDragging(true);
 }

 function handleDragLeave(e: React.DragEvent) {
  e.preventDefault();
  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
   setIsDragging(false);
  }
 }

 function handleDrop(e: React.DragEvent) {
  e.preventDefault();
  setIsDragging(false);
  setUploadErrors([]);
  if (e.dataTransfer.files.length > 0) {
   handleFiles(e.dataTransfer.files);
  }
 }

 function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
  setUploadErrors([]);
  if (e.target.files && e.target.files.length > 0) {
   handleFiles(e.target.files);
   e.target.value = "";
  }
 }

 const isUploading = uploading.length > 0;

 return (
  <div className="space-y-3">
   <div
    role="button"
    tabIndex={0}
    onDragOver={handleDragOver}
    onDragLeave={handleDragLeave}
    onDrop={handleDrop}
    onClick={() => !isUploading && inputRef.current?.click()}
    onKeyDown={(e) => {
     if ((e.key === "Enter" || e.key === " ") && !isUploading) {
      inputRef.current?.click();
     }
    }}
    className={cn(
     "relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
     isDragging
      ? "border-primary bg-accent"
      : "border-border hover:border-primary/30 hover:bg-muted/30 ",
     isUploading && "cursor-not-allowed opacity-70"
    )}
    aria-label="Upload files"
   >
    <input
     ref={inputRef}
     type="file"
     multiple
     accept={ACCEPTED_EXTENSIONS.join(",")}
     onChange={handleChange}
     className="hidden"
     aria-hidden="true"
    />

    {isUploading ? (
     <>
      <Loader2 className="h-8 w-8 text-primary animate-spin mb-3" />
      <p className="text-sm font-medium">
       Uploading {uploading.length} file{uploading.length !== 1 ? "s" : ""}...
      </p>
      <div className="mt-2 space-y-1 text-center">
       {uploading.map((name) => (
        <p key={name} className="text-xs text-muted-foreground">
         {name}
        </p>
       ))}
      </div>
     </>
    ) : (
     <>
      <div
       className={cn(
        "flex h-12 w-12 items-center justify-center rounded-xl mb-4 transition-colors",
        isDragging
         ? "bg-accent"
         : "bg-muted"
       )}
      >
       {isDragging ? (
        <FileText className="h-6 w-6 text-primary" />
       ) : (
        <Upload className="h-6 w-6 text-muted-foreground" />
       )}
      </div>
      <p className="text-sm font-medium mb-1">
       {isDragging ? "Drop files here" : "Drop files or click to browse"}
      </p>
      <p className="text-xs text-muted-foreground">
       PDF, Word, or TXT &middot; up to {MAX_SIZE_MB}MB per file
      </p>
     </>
    )}
   </div>

   {uploadErrors.length > 0 && (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-1">
     <div className="flex items-center gap-1.5 text-destructive">
      <AlertCircle className="h-3.5 w-3.5" />
      <span className="text-xs font-medium">Upload errors</span>
     </div>
     {uploadErrors.map((err, i) => (
      <p key={i} className="text-xs text-destructive/80 ml-5">
       {err}
      </p>
     ))}
    </div>
   )}
  </div>
 );
}
