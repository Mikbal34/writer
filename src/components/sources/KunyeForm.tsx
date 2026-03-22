"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Loader2, Save, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

type EntryType = "kitap" | "makale" | "nesir" | "ceviri" | "tez" | "ansiklopedi" | "web";

export interface KunyeFormData {
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

const EMPTY_FORM: KunyeFormData = {
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

interface KunyeFormProps {
  projectId: string;
  sourceId?: string;
  initialData?: Partial<KunyeFormData>;
  bibliographyId?: string;
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

export default function KunyeForm({
  projectId,
  sourceId,
  initialData,
  bibliographyId,
  onSave,
  onCancel,
}: KunyeFormProps) {
  const [form, setForm] = useState<KunyeFormData>({
    ...EMPTY_FORM,
    ...initialData,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isEnriching, setIsEnriching] = useState(false);

  function update(field: keyof KunyeFormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
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
      const method = bibliographyId ? "PATCH" : "POST";
      const url = bibliographyId
        ? `/api/bibliography/${bibliographyId}`
        : `/api/bibliography`;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, projectId, sourceId }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to save" }));
        throw new Error(err.error ?? "Failed to save");
      }

      toast.success(bibliographyId ? "Bibliography entry updated." : "Bibliography entry saved.");
      onSave?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleEnrich() {
    if (!bibliographyId) return;
    setIsEnriching(true);
    try {
      const res = await fetch(`/api/bibliography/${bibliographyId}/enrich`, {
        method: "POST",
      });
      if (res.status === 402) {
        const errData = await res.json().catch(() => ({}));
        toast.error(`Insufficient credits (${errData.balance ?? 0} remaining).`);
        setIsEnriching(false);
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to enrich" }));
        throw new Error(err.error ?? "Failed to enrich");
      }
      const data = await res.json();
      const suggestions = data.suggestions as Record<string, string>;
      // Only merge string fields, exclude entryType
      const fillable = Object.keys(suggestions).filter(
        (k): k is keyof Omit<KunyeFormData, "entryType"> =>
          k !== "entryType" && k in EMPTY_FORM
      );
      if (fillable.length === 0) {
        toast.info("All fields are already filled, nothing to complete.");
        return;
      }
      setForm((prev) => {
        const next = { ...prev };
        for (const key of fillable) {
          if (!prev[key] || prev[key].trim() === "") {
            next[key] = suggestions[key];
          }
        }
        return next;
      });
      toast.success(`${fillable.length} field${fillable.length !== 1 ? 's' : ''} filled by AI.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI completion failed");
    } finally {
      setIsEnriching(false);
    }
  }

  const showJournalFields = form.entryType === "makale";
  const showPublisherFields = ["kitap", "nesir", "ceviri", "tez", "ansiklopedi"].includes(form.entryType);
  const showTranslatorField = form.entryType === "ceviri";
  const showEditorField = ["kitap", "ansiklopedi", "nesir"].includes(form.entryType);
  const showUrlField = form.entryType === "web";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Entry type */}
      <Field id="entryType" label="Entry Type" required>
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
                  <span className="text-muted-foreground ml-2 text-xs">
                    {t.description}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Separator />

      {/* Author */}
      <div className="grid grid-cols-2 gap-3">
        <Field id="authorSurname" label="Author Surname" required>
          <Input
            id="authorSurname"
            placeholder="e.g. İbn Haldûn"
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

      {/* Title */}
      <Field id="title" label="Full Title" required>
        <Input
          id="title"
          placeholder="Full title of the work"
          value={form.title}
          onChange={(e) => update("title", e.target.value)}
        />
      </Field>

      <Field id="shortTitle" label="Short Title / Citation Key">
        <Input
          id="shortTitle"
          placeholder="e.g. Mukaddime"
          value={form.shortTitle}
          onChange={(e) => update("shortTitle", e.target.value)}
        />
      </Field>

      {showEditorField && (
        <Field id="editor" label="Editor">
          <Input
            id="editor"
            placeholder="e.g. thk. Dervîş el-Cüveydî"
            value={form.editor}
            onChange={(e) => update("editor", e.target.value)}
          />
        </Field>
      )}

      {showTranslatorField && (
        <Field id="translator" label="Translator">
          <Input
            id="translator"
            placeholder="Translator name"
            value={form.translator}
            onChange={(e) => update("translator", e.target.value)}
          />
        </Field>
      )}

      {showJournalFields && (
        <>
          <Field id="journalName" label="Journal Name">
            <Input
              id="journalName"
              placeholder="Journal or periodical name"
              value={form.journalName}
              onChange={(e) => update("journalName", e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field id="journalVolume" label="Volume">
              <Input
                id="journalVolume"
                placeholder="e.g. 12"
                value={form.journalVolume}
                onChange={(e) => update("journalVolume", e.target.value)}
              />
            </Field>
            <Field id="journalIssue" label="Issue">
              <Input
                id="journalIssue"
                placeholder="e.g. 3"
                value={form.journalIssue}
                onChange={(e) => update("journalIssue", e.target.value)}
              />
            </Field>
            <Field id="pageRange" label="Pages">
              <Input
                id="pageRange"
                placeholder="e.g. 45–67"
                value={form.pageRange}
                onChange={(e) => update("pageRange", e.target.value)}
              />
            </Field>
          </div>
          <Field id="doi" label="DOI">
            <Input
              id="doi"
              placeholder="10.xxxx/..."
              value={form.doi}
              onChange={(e) => update("doi", e.target.value)}
            />
          </Field>
        </>
      )}

      {showPublisherFields && (
        <div className="grid grid-cols-2 gap-3">
          <Field id="publisher" label="Publisher">
            <Input
              id="publisher"
              placeholder="e.g. Dar al-Kutub"
              value={form.publisher}
              onChange={(e) => update("publisher", e.target.value)}
            />
          </Field>
          <Field id="publishPlace" label="Place of Publication">
            <Input
              id="publishPlace"
              placeholder="e.g. Beyrut"
              value={form.publishPlace}
              onChange={(e) => update("publishPlace", e.target.value)}
            />
          </Field>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Field id="year" label="Year">
          <Input
            id="year"
            placeholder="e.g. 2023"
            value={form.year}
            onChange={(e) => update("year", e.target.value)}
          />
        </Field>
        <Field id="volume" label="Volume">
          <Input
            id="volume"
            placeholder="e.g. II"
            value={form.volume}
            onChange={(e) => update("volume", e.target.value)}
          />
        </Field>
        <Field id="edition" label="Edition">
          <Input
            id="edition"
            placeholder="e.g. 3rd"
            value={form.edition}
            onChange={(e) => update("edition", e.target.value)}
          />
        </Field>
      </div>

      {showUrlField && (
        <Field id="url" label="URL">
          <Input
            id="url"
            type="url"
            placeholder="https://..."
            value={form.url}
            onChange={(e) => update("url", e.target.value)}
          />
        </Field>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} className="gap-2">
            <X className="h-4 w-4" />
            Cancel
          </Button>
        )}
        {bibliographyId && (
          <Button
            type="button"
            variant="outline"
            disabled={isEnriching || isSaving}
            onClick={handleEnrich}
            className="gap-2"
          >
            {isEnriching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {isEnriching ? "AI thinking..." : "Complete with AI"}
          </Button>
        )}
        <Button
          type="submit"
          disabled={isSaving}
          className="gap-2"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {isSaving ? "Saving..." : "Save Entry"}
        </Button>
      </div>
    </form>
  );
}
