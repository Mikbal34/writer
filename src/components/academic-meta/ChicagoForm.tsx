"use client"

import type { ChicagoMeta } from "@/lib/academic-meta"
import {
  FormSection,
  StringListField,
  TextAreaField,
  TextField,
  VariantPicker,
} from "./shared"

interface Props {
  meta: ChicagoMeta
  onChange: (next: ChicagoMeta) => void
  onGenerateAbstract?: () => void
  onGenerateKeywords?: () => void
  generatingAbstract?: boolean
  generatingKeywords?: boolean
  onAutoFillDate?: () => void
  autoFillingDate?: boolean
  onAutoFillSubtitle?: () => void
  autoFillingSubtitle?: boolean
}

export default function ChicagoForm({
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
  const set = <K extends keyof ChicagoMeta>(k: K, v: ChicagoMeta[K]) =>
    onChange({ ...meta, [k]: v })

  const isThesis = meta.variant === "thesis"

  return (
    <div className="space-y-6">
      <VariantPicker
        label="Paper type"
        value={meta.variant}
        options={[
          {
            value: "student",
            label: "Student paper",
            description: "Course, instructor, institution, date",
          },
          {
            value: "thesis",
            label: "Thesis / dissertation",
            description: "Degree type, city, committee",
          },
        ]}
        onChange={(v) => set("variant", v)}
      />

      <FormSection title="Title page">
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

        {isThesis ? (
          <>
            <TextField
              label="Degree type"
              value={meta.degreeType}
              onChange={(v) => set("degreeType", v)}
              placeholder="Master of Arts / Doctor of Philosophy"
            />
            <TextField
              label="City"
              value={meta.city}
              onChange={(v) => set("city", v)}
              placeholder="Chicago, Illinois"
            />
            <StringListField
              label="Committee members"
              value={meta.committeeMembers}
              onChange={(v) => set("committeeMembers", v)}
              hint="Comma-separated. Appears on the approval page."
            />
          </>
        ) : (
          <>
            <TextField
              label="Course"
              value={meta.courseName}
              onChange={(v) => set("courseName", v)}
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
          </>
        )}

        <TextField
          label="Date"
          value={meta.date}
          onChange={(v) => set("date", v)}
          placeholder="October 14, 2025"
          onAutoFill={onAutoFillDate}
          autoFillLoading={autoFillingDate}
          autoFillHint="Use today's date"
        />
      </FormSection>

      <FormSection
        title="Abstract"
        description="Optional on short papers, typical on theses (~300 words)."
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
