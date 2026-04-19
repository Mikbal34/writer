"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Loader2, Save, X, Sparkles, FileCheck } from "lucide-react";
import { toast } from "sonner";

type EntryType = "kitap" | "makale" | "nesir" | "ceviri" | "tez" | "ansiklopedi" | "web";

export interface LibraryFormData {
  entryType: EntryType;
  authorSurname: string;
  authorName: string;
  title: string;
  shortTitle: string;
  editor: string;
  translator: string;
  publisher: string;
  publishPlace: string;
  year: string;
  volume: string;
  edition: string;
  journalName: string;
  journalVolume: string;
  journalIssue: string;
  pageRange: string;
  doi: string;
  url: string;
}

const ENTRY_TYPES: Array<{ value: EntryType; label: string; description: string }> = [
  { value: "kitap", label: "Book", description: "Book / Monograph" },
  { value: "makale", label: "Article", description: "Journal Article" },
  { value: "nesir", label: "Prose", description: "Prose / Classical Text" },
  { value: "ceviri", label: "Translation", description: "Translated Work" },
  { value: "tez", label: "Thesis", description: "Dissertation / Thesis" },
  { value: "ansiklopedi", label: "Encyclopedia", description: "Encyclopedia Entry" },
  { value: "web", label: "Web", description: "Website / Online Source" },
];

const EMPTY_FORM: LibraryFormData = {
  entryType: "kitap",
  authorSurname: "",
  authorName: "",
  title: "",
  shortTitle: "",
  editor: "",
  translator: "",
  publisher: "",
  publishPlace: "",
  year: "",
  volume: "",
  edition: "",
  journalName: "",
  journalVolume: "",
  journalIssue: "",
  pageRange: "",
  doi: "",
  url: "",
};

interface LibraryEntryFormProps {
  entryId?: string;
  initialData?: Partial<LibraryFormData>;
  onSave?: () => void;
  onCancel?: () => void;
}

function Field({
  id,
  label,
  required,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-medium">
        {label}{" "}
        {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
    </div>
  );
}

export default function LibraryEntryForm({
  entryId,
  initialData,
  onSave,
  onCancel,
}: LibraryEntryFormProps) {
  const [form, setForm] = useState<LibraryFormData>({
    ...EMPTY_FORM,
    ...initialData,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isEnriching, setIsEnriching] = useState(false);
  const [isLoadingFull, setIsLoadingFull] = useState(false);
  const [hasReadyPdf, setHasReadyPdf] = useState(false);

  // When editing, fetch the full entry so all fields (journal, volume,
  // issue, pages, DOI, etc.) populate — the list view only carries a
  // shallow projection.
  useEffect(() => {
    if (!entryId) return;
    let cancelled = false;
    (async () => {
      setIsLoadingFull(true);
      try {
        const res = await fetch(`/api/library/${entryId}`);
        if (!res.ok) return;
        const full = await res.json();
        if (cancelled) return;
        setForm((prev) => ({
          ...prev,
          entryType: (full.entryType as EntryType) ?? prev.entryType,
          authorSurname: full.authorSurname ?? "",
          authorName: full.authorName ?? "",
          title: full.title ?? "",
          shortTitle: full.shortTitle ?? "",
          editor: full.editor ?? "",
          translator: full.translator ?? "",
          publisher: full.publisher ?? "",
          publishPlace: full.publishPlace ?? "",
          year: full.year ?? "",
          volume: full.volume ?? "",
          edition: full.edition ?? "",
          journalName: full.journalName ?? "",
          journalVolume: full.journalVolume ?? "",
          journalIssue: full.journalIssue ?? "",
          pageRange: full.pageRange ?? "",
          doi: full.doi ?? "",
          url: full.url ?? "",
        }));
        setHasReadyPdf(full.pdfStatus === "ready");
      } catch {
        // Non-fatal — user can still edit with whatever initialData had.
      } finally {
        if (!cancelled) setIsLoadingFull(false);
      }
    })();
    return () => { cancelled = true; };
  }, [entryId]);

  function update(field: keyof LibraryFormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleEnrich() {
    if (!entryId) return;
    setIsEnriching(true);
    try {
      const res = await fetch(`/api/library/entries/${entryId}/enrich`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Enrichment failed.");
        return;
      }
      // Merge enriched fields back into form (only fill empty slots so we
      // don't wipe edits in progress).
      const refreshed = body.entry as Partial<LibraryFormData> | undefined;
      if (refreshed) {
        setForm((prev) => {
          const next = { ...prev };
          (Object.keys(refreshed) as Array<keyof LibraryFormData>).forEach((k) => {
            const candidate = (refreshed as Record<string, unknown>)[k];
            if (typeof candidate === "string" && candidate.trim() && !next[k]) {
              (next as Record<string, string>)[k] = candidate;
            }
          });
          return next;
        });
      }
      toast.success("Bilgiler PDF'ten tamamlandı.");
    } catch {
      toast.error("Enrichment failed.");
    } finally {
      setIsEnriching(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!form.authorSurname.trim()) {
      toast.error("Author surname is required");
      return;
    }
    if (!form.title.trim()) {
      toast.error("Title is required");
      return;
    }

    setIsSaving(true);
    try {
      const method = entryId ? "PATCH" : "POST";
      const url = entryId ? `/api/library/${entryId}` : `/api/library`;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error ?? "Save failed");
      }

      toast.success(entryId ? "Source updated." : "Source added.");
      onSave?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  }

  const showJournalFields = form.entryType === "makale";
  const showPublisherFields = ["kitap", "nesir", "ceviri", "tez", "ansiklopedi"].includes(form.entryType);
  const showTranslatorField = form.entryType === "ceviri";
  const showEditorField = ["kitap", "ansiklopedi", "nesir"].includes(form.entryType);
  const showUrlField = form.entryType === "web";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {entryId && hasReadyPdf && (
        <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded border border-[#d4c9b5] bg-[#FAF3E3]">
          <div className="flex items-center gap-2 min-w-0">
            <FileCheck className="h-4 w-4 shrink-0 text-[#2D8B4E]" />
            <div className="min-w-0">
              <div className="text-xs font-medium text-[#2D1F0E]">PDF yüklü</div>
              <div className="text-[11px] text-[#8a7a65] truncate">
                Boş alanları PDF'in ilk sayfalarından otomatik tamamla
              </div>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleEnrich}
            disabled={isEnriching || isLoadingFull}
            className="gap-1.5 shrink-0 border-[#C9A84C] text-[#8a5a1a] hover:bg-[#C9A84C]/15"
          >
            {isEnriching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {isEnriching ? "Tamamlanıyor…" : "PDF'ten doldur"}
          </Button>
        </div>
      )}
      <Field id="entryType" label="Type" required>
        <Select
          value={form.entryType}
          onValueChange={(v) => { if (v) update("entryType", v as EntryType); }}
        >
          <SelectTrigger id="entryType">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ENTRY_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                <div>
                  <span className="font-medium">{t.label}</span>
                  <span className="text-muted-foreground ml-2 text-xs">{t.description}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Separator />

      <div className="grid grid-cols-2 gap-3">
        <Field id="authorSurname" label="Author Surname" required>
          <Input
            id="authorSurname"
            placeholder="e.g. Ibn Khaldun"
            value={form.authorSurname}
            onChange={(e) => update("authorSurname", e.target.value)}
          />
        </Field>
        <Field id="authorName" label="Author First Name">
          <Input
            id="authorName"
            placeholder="e.g. Abdurrahman"
            value={form.authorName}
            onChange={(e) => update("authorName", e.target.value)}
          />
        </Field>
      </div>

      <Field id="title" label="Title" required>
        <Input
          id="title"
          placeholder="Full title of the work"
          value={form.title}
          onChange={(e) => update("title", e.target.value)}
        />
      </Field>

      <Field id="shortTitle" label="Short Title">
        <Input
          id="shortTitle"
          placeholder="e.g. Muqaddimah"
          value={form.shortTitle}
          onChange={(e) => update("shortTitle", e.target.value)}
        />
      </Field>

      {showEditorField && (
        <Field id="editor" label="Editor">
          <Input id="editor" value={form.editor} onChange={(e) => update("editor", e.target.value)} />
        </Field>
      )}

      {showTranslatorField && (
        <Field id="translator" label="Translator">
          <Input id="translator" value={form.translator} onChange={(e) => update("translator", e.target.value)} />
        </Field>
      )}

      {showJournalFields && (
        <>
          <Field id="journalName" label="Journal Name">
            <Input id="journalName" value={form.journalName} onChange={(e) => update("journalName", e.target.value)} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field id="journalVolume" label="Volume">
              <Input id="journalVolume" value={form.journalVolume} onChange={(e) => update("journalVolume", e.target.value)} />
            </Field>
            <Field id="journalIssue" label="Issue">
              <Input id="journalIssue" value={form.journalIssue} onChange={(e) => update("journalIssue", e.target.value)} />
            </Field>
            <Field id="pageRange" label="Pages">
              <Input id="pageRange" value={form.pageRange} onChange={(e) => update("pageRange", e.target.value)} />
            </Field>
          </div>
          <Field id="doi" label="DOI">
            <Input id="doi" value={form.doi} onChange={(e) => update("doi", e.target.value)} />
          </Field>
        </>
      )}

      {showPublisherFields && (
        <div className="grid grid-cols-2 gap-3">
          <Field id="publisher" label="Publisher">
            <Input id="publisher" value={form.publisher} onChange={(e) => update("publisher", e.target.value)} />
          </Field>
          <Field id="publishPlace" label="Place of Publication">
            <Input id="publishPlace" value={form.publishPlace} onChange={(e) => update("publishPlace", e.target.value)} />
          </Field>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Field id="year" label="Year">
          <Input id="year" value={form.year} onChange={(e) => update("year", e.target.value)} />
        </Field>
        <Field id="volume" label="Volume">
          <Input id="volume" value={form.volume} onChange={(e) => update("volume", e.target.value)} />
        </Field>
        <Field id="edition" label="Edition">
          <Input id="edition" value={form.edition} onChange={(e) => update("edition", e.target.value)} />
        </Field>
      </div>

      {showUrlField && (
        <Field id="url" label="URL">
          <Input id="url" type="url" placeholder="https://..." value={form.url} onChange={(e) => update("url", e.target.value)} />
        </Field>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} className="gap-2">
            <X className="h-4 w-4" />
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          disabled={isSaving}
          className="gap-2"
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {isSaving ? "Saving..." : "Save"}
        </Button>
      </div>
    </form>
  );
}
