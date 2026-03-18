"use client";

import { useState } from "react";
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
import { Loader2, Save, X } from "lucide-react";
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
  { value: "kitap", label: "Kitap", description: "Book / Monograph" },
  { value: "makale", label: "Makale", description: "Journal Article" },
  { value: "nesir", label: "Nesir", description: "Prose / Classical Text" },
  { value: "ceviri", label: "Çeviri", description: "Translated Work" },
  { value: "tez", label: "Tez", description: "Dissertation / Thesis" },
  { value: "ansiklopedi", label: "Ansiklopedi", description: "Encyclopedia Entry" },
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

  function update(field: keyof LibraryFormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!form.authorSurname.trim()) {
      toast.error("Yazar soyadı gerekli");
      return;
    }
    if (!form.title.trim()) {
      toast.error("Başlık gerekli");
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
        const err = await res.json().catch(() => ({ error: "Kaydetme başarısız" }));
        throw new Error(err.error ?? "Kaydetme başarısız");
      }

      toast.success(entryId ? "Kaynak güncellendi." : "Kaynak eklendi.");
      onSave?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kaydetme başarısız");
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
      <Field id="entryType" label="Tür" required>
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
        <Field id="authorSurname" label="Yazar Soyadı" required>
          <Input
            id="authorSurname"
            placeholder="örn. İbn Haldûn"
            value={form.authorSurname}
            onChange={(e) => update("authorSurname", e.target.value)}
          />
        </Field>
        <Field id="authorName" label="Yazar Adı">
          <Input
            id="authorName"
            placeholder="örn. Abdurrahman"
            value={form.authorName}
            onChange={(e) => update("authorName", e.target.value)}
          />
        </Field>
      </div>

      <Field id="title" label="Başlık" required>
        <Input
          id="title"
          placeholder="Eserin tam başlığı"
          value={form.title}
          onChange={(e) => update("title", e.target.value)}
        />
      </Field>

      <Field id="shortTitle" label="Kısa Başlık">
        <Input
          id="shortTitle"
          placeholder="örn. Mukaddime"
          value={form.shortTitle}
          onChange={(e) => update("shortTitle", e.target.value)}
        />
      </Field>

      {showEditorField && (
        <Field id="editor" label="Editör">
          <Input id="editor" value={form.editor} onChange={(e) => update("editor", e.target.value)} />
        </Field>
      )}

      {showTranslatorField && (
        <Field id="translator" label="Mütercim">
          <Input id="translator" value={form.translator} onChange={(e) => update("translator", e.target.value)} />
        </Field>
      )}

      {showJournalFields && (
        <>
          <Field id="journalName" label="Dergi Adı">
            <Input id="journalName" value={form.journalName} onChange={(e) => update("journalName", e.target.value)} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field id="journalVolume" label="Cilt">
              <Input id="journalVolume" value={form.journalVolume} onChange={(e) => update("journalVolume", e.target.value)} />
            </Field>
            <Field id="journalIssue" label="Sayı">
              <Input id="journalIssue" value={form.journalIssue} onChange={(e) => update("journalIssue", e.target.value)} />
            </Field>
            <Field id="pageRange" label="Sayfa">
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
          <Field id="publisher" label="Yayınevi">
            <Input id="publisher" value={form.publisher} onChange={(e) => update("publisher", e.target.value)} />
          </Field>
          <Field id="publishPlace" label="Yayın Yeri">
            <Input id="publishPlace" value={form.publishPlace} onChange={(e) => update("publishPlace", e.target.value)} />
          </Field>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Field id="year" label="Yıl">
          <Input id="year" value={form.year} onChange={(e) => update("year", e.target.value)} />
        </Field>
        <Field id="volume" label="Cilt">
          <Input id="volume" value={form.volume} onChange={(e) => update("volume", e.target.value)} />
        </Field>
        <Field id="edition" label="Baskı">
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
            İptal
          </Button>
        )}
        <Button
          type="submit"
          disabled={isSaving}
          className="gap-2"
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {isSaving ? "Kaydediliyor..." : "Kaydet"}
        </Button>
      </div>
    </form>
  );
}
