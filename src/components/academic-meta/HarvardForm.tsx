"use client"

import type { HarvardMeta } from "@/lib/academic-meta"
import {
  FormSection,
  NumberField,
  StringListField,
  TextAreaField,
  TextField,
} from "./shared"

interface Props {
  meta: HarvardMeta
  onChange: (next: HarvardMeta) => void
  onGenerateAbstract?: () => void
  onGenerateKeywords?: () => void
  generatingAbstract?: boolean
  generatingKeywords?: boolean
  onAutoFillWordCount?: () => void
  onAutoFillDate?: () => void
  autoFillingWordCount?: boolean
  autoFillingDate?: boolean
}

export default function HarvardForm({
  meta,
  onChange,
  onGenerateAbstract,
  onGenerateKeywords,
  generatingAbstract,
  generatingKeywords,
  onAutoFillWordCount,
  onAutoFillDate,
  autoFillingWordCount,
  autoFillingDate,
}: Props) {
  const set = <K extends keyof HarvardMeta>(k: K, v: HarvardMeta[K]) =>
    onChange({ ...meta, [k]: v })

  return (
    <div className="space-y-6">
      <FormSection
        title="Submission cover"
        description="UK universities vary — the common set is student ID, module code, supervisor, and word count on the title page."
      >
        <TextField
          label="Subtitle"
          value={meta.subtitle}
          onChange={(v) => set("subtitle", v)}
        />
        <TextField
          label="Author"
          required
          value={meta.author}
          onChange={(v) => set("author", v ?? "")}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TextField
            label="Student ID"
            value={meta.studentId}
            onChange={(v) => set("studentId", v)}
          />
          <TextField
            label="Institution"
            value={meta.institution}
            onChange={(v) => set("institution", v)}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TextField
            label="Module code"
            value={meta.moduleCode}
            onChange={(v) => set("moduleCode", v)}
            placeholder="PSY3023"
          />
          <TextField
            label="Module name"
            value={meta.moduleName}
            onChange={(v) => set("moduleName", v)}
          />
        </div>
        <TextField
          label="Supervisor"
          value={meta.supervisor}
          onChange={(v) => set("supervisor", v)}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <NumberField
            label="Word count"
            value={meta.wordCount}
            onChange={(v) => set("wordCount", v)}
            placeholder="8000"
            onAutoFill={onAutoFillWordCount}
            autoFillLoading={autoFillingWordCount}
            autoFillHint="Count words in all written subsections"
          />
          <TextField
            label="Date of submission"
            value={meta.dateOfSubmission}
            onChange={(v) => set("dateOfSubmission", v)}
            placeholder="14 October 2025"
            onAutoFill={onAutoFillDate}
            autoFillLoading={autoFillingDate}
            autoFillHint="Use today's date"
          />
        </div>
      </FormSection>

      <FormSection
        title="Abstract"
        description="200–300 words, 4–6 keywords."
      >
        <TextAreaField
          label="Abstract"
          value={meta.abstract}
          onChange={(v) => set("abstract", v)}
          rows={7}
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
