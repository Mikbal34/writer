"use client"

import type { MlaMeta } from "@/lib/academic-meta"
import {
  FormSection,
  StringListField,
  TextAreaField,
  TextField,
} from "./shared"

interface Props {
  meta: MlaMeta
  onChange: (next: MlaMeta) => void
  onGenerateAbstract?: () => void
  onGenerateKeywords?: () => void
  generatingAbstract?: boolean
  generatingKeywords?: boolean
  onAutoFillDate?: () => void
  autoFillingDate?: boolean
  onAutoFillSubtitle?: () => void
  autoFillingSubtitle?: boolean
}

export default function MlaForm({
  meta,
  onChange,
  onGenerateAbstract,
  onGenerateKeywords,
  generatingAbstract,
  generatingKeywords,
  onAutoFillDate,
  autoFillingDate,
  onAutoFillSubtitle,
  autoFillingSubtitle,
}: Props) {
  const set = <K extends keyof MlaMeta>(k: K, v: MlaMeta[K]) =>
    onChange({ ...meta, [k]: v })

  return (
    <div className="space-y-6">
      <FormSection
        title="Page 1 info block"
        description="MLA has no separate title page. Author, instructor, course and date appear in the upper-left corner of page one, with the title centered below."
      >
        <TextField
          label="Subtitle"
          value={meta.subtitle}
          onChange={(v) => set("subtitle", v)}
          placeholder="Optional"
          onAutoFill={onAutoFillSubtitle}
          autoFillLoading={autoFillingSubtitle}
          autoFillHint="Extract from project title"
        />
        <TextField
          label="Author"
          required
          value={meta.author}
          onChange={(v) => set("author", v ?? "")}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TextField
            label="Instructor title"
            value={meta.instructorTitle}
            onChange={(v) => set("instructorTitle", v)}
            placeholder="Dr. / Professor"
          />
          <TextField
            label="Instructor name"
            value={meta.instructorName}
            onChange={(v) => set("instructorName", v)}
          />
        </div>
        <TextField
          label="Course"
          value={meta.courseName}
          onChange={(v) => set("courseName", v)}
          placeholder="English 101"
        />
        <TextField
          label="Date"
          value={meta.date}
          onChange={(v) => set("date", v)}
          placeholder="14 October 2025"
          hint="MLA prescribes the day-month-year format."
          onAutoFill={onAutoFillDate}
          autoFillLoading={autoFillingDate}
          autoFillHint="Use today's date in MLA format"
        />
      </FormSection>

      <FormSection
        title="Abstract (optional)"
        description="MLA does not require an abstract. Some departments ask for one on theses and long papers — leave blank otherwise."
      >
        <TextAreaField
          label="Abstract"
          value={meta.abstract}
          onChange={(v) => set("abstract", v)}
          rows={6}
          onGenerate={onGenerateAbstract}
          generating={generatingAbstract}
        />
        <StringListField
          label="Keywords"
          value={meta.keywords}
          onChange={(v) => set("keywords", v)}
          onGenerate={onGenerateKeywords}
          generating={generatingKeywords}
        />
      </FormSection>

      <FormSection title="Optional front matter">
        <TextAreaField
          label="Acknowledgments"
          value={meta.acknowledgments}
          onChange={(v) => set("acknowledgments", v)}
          rows={4}
        />
        <TextAreaField
          label="Dedication"
          value={meta.dedication}
          onChange={(v) => set("dedication", v)}
          rows={2}
        />
      </FormSection>
    </div>
  )
}
