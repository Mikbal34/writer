"use client"

import type { ApaMeta } from "@/lib/academic-meta"
import {
  FormSection,
  StringListField,
  TextAreaField,
  TextField,
  VariantPicker,
} from "./shared"

interface Props {
  meta: ApaMeta
  onChange: (next: ApaMeta) => void
  onGenerateAbstract?: () => void
  onGenerateKeywords?: () => void
  generatingAbstract?: boolean
  generatingKeywords?: boolean
}

export default function ApaForm({
  meta,
  onChange,
  onGenerateAbstract,
  onGenerateKeywords,
  generatingAbstract,
  generatingKeywords,
}: Props) {
  const set = <K extends keyof ApaMeta>(k: K, v: ApaMeta[K]) =>
    onChange({ ...meta, [k]: v })

  const isStudent = meta.variant === "student"

  return (
    <div className="space-y-6">
      <VariantPicker
        label="Paper type"
        value={meta.variant}
        options={[
          {
            value: "student",
            label: "Student paper",
            description: "Course, instructor, and due date on title page",
          },
          {
            value: "professional",
            label: "Professional paper",
            description: "Author note + short-title running head",
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
        />
        <TextField
          label="Author"
          required
          value={meta.author}
          onChange={(v) => set("author", v ?? "")}
          placeholder="Firstname Middle Lastname"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TextField
            label="Institution"
            value={meta.institution}
            onChange={(v) => set("institution", v)}
            placeholder="University of Example"
          />
          <TextField
            label="Department"
            value={meta.department}
            onChange={(v) => set("department", v)}
            placeholder="Department of Psychology"
          />
        </div>

        {isStudent ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <TextField
                label="Course number"
                value={meta.courseNumber}
                onChange={(v) => set("courseNumber", v)}
                placeholder="PSY 101"
              />
              <TextField
                label="Course name"
                value={meta.courseName}
                onChange={(v) => set("courseName", v)}
                placeholder="Introduction to Psychology"
              />
            </div>
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
              label="Due date"
              value={meta.dueDate}
              onChange={(v) => set("dueDate", v)}
              placeholder="e.g. October 14, 2025"
            />
          </>
        ) : (
          <>
            <TextField
              label="Short title (running head)"
              value={meta.shortTitle}
              onChange={(v) => set("shortTitle", v)}
              maxLength={50}
              hint="Printed ALL CAPS at the top of every page. Max 50 characters."
            />
            <TextAreaField
              label="Author note"
              value={meta.authorNote}
              onChange={(v) => set("authorNote", v)}
              rows={4}
              hint="ORCID iDs, disclosures, contact for correspondence."
            />
          </>
        )}
      </FormSection>

      <FormSection
        title="Abstract"
        description="150–250 words, single paragraph. Keywords appear underneath."
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
          placeholder="comma, separated, 3 to 5"
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
