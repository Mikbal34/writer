"use client"

import type { TurabianMeta } from "@/lib/academic-meta"
import {
  FormSection,
  StringListField,
  TextAreaField,
  TextField,
} from "./shared"

interface Props {
  meta: TurabianMeta
  onChange: (next: TurabianMeta) => void
  onGenerateAbstract?: () => void
  onGenerateKeywords?: () => void
  generatingAbstract?: boolean
  generatingKeywords?: boolean
}

export default function TurabianForm({
  meta,
  onChange,
  onGenerateAbstract,
  onGenerateKeywords,
  generatingAbstract,
  generatingKeywords,
}: Props) {
  const set = <K extends keyof TurabianMeta>(k: K, v: TurabianMeta[K]) =>
    onChange({ ...meta, [k]: v })

  return (
    <div className="space-y-6">
      <FormSection
        title="Title page"
        description="Turabian is Chicago's thesis variant. Title page follows a strict order: title / author / degree statement / institution / department / date."
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
            label="Institution"
            value={meta.institution}
            onChange={(v) => set("institution", v)}
          />
          <TextField
            label="Department"
            value={meta.department}
            onChange={(v) => set("department", v)}
          />
        </div>
        <TextField
          label="Degree type"
          value={meta.degreeType}
          onChange={(v) => set("degreeType", v)}
          placeholder="Master of Arts / Doctor of Philosophy"
        />
        <TextField
          label="Advisor"
          value={meta.advisor}
          onChange={(v) => set("advisor", v)}
        />
        <StringListField
          label="Committee members"
          value={meta.committeeMembers}
          onChange={(v) => set("committeeMembers", v)}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TextField
            label="City"
            value={meta.city}
            onChange={(v) => set("city", v)}
          />
          <TextField
            label="Date"
            value={meta.date}
            onChange={(v) => set("date", v)}
            placeholder="October 2025"
          />
        </div>
      </FormSection>

      <FormSection
        title="Abstract"
        description="Typical for theses and dissertations, 300–350 words."
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
