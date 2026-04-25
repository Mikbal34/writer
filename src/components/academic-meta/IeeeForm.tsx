"use client"

import type { AuthorBlock, IeeeMeta } from "@/lib/academic-meta"
import {
  FormSection,
  RepeatableList,
  StringListField,
  TextAreaField,
  TextField,
} from "./shared"

interface Props {
  meta: IeeeMeta
  onChange: (next: IeeeMeta) => void
  onGenerateAbstract?: () => void
  onGenerateIndexTerms?: () => void
  generatingAbstract?: boolean
  generatingIndexTerms?: boolean
  onAutoFillSubtitle?: () => void
  autoFillingSubtitle?: boolean
}

const emptyAuthor = (): AuthorBlock => ({
  name: "",
  degrees: [],
  department: null,
  institution: null,
  city: null,
  country: null,
  email: null,
  orcid: null,
})

export default function IeeeForm({
  meta,
  onChange,
  onGenerateAbstract,
  onGenerateIndexTerms,
  generatingAbstract,
  generatingIndexTerms,
  onAutoFillSubtitle,
  autoFillingSubtitle,
}: Props) {
  const set = <K extends keyof IeeeMeta>(k: K, v: IeeeMeta[K]) =>
    onChange({ ...meta, [k]: v })

  return (
    <div className="space-y-6">
      <FormSection title="Title">
        <TextField
          label="Subtitle"
          value={meta.subtitle}
          onChange={(v) => set("subtitle", v)}
          onAutoFill={onAutoFillSubtitle}
          autoFillLoading={autoFillingSubtitle}
          autoFillHint="Extract from project title"
        />
      </FormSection>

      <FormSection
        title="Authors & affiliations"
        description="IEEE requires a full affiliation block for each author (department, institution, city, country, email, optional ORCID)."
      >
        <RepeatableList<AuthorBlock>
          title="Authors"
          items={meta.authors}
          onChange={(next) => set("authors", next)}
          emptyItem={emptyAuthor}
          addLabel="Add author"
          itemLabel={(i) => `Author ${i + 1}`}
          minItems={1}
          renderItem={(author, i, update) => (
            <div className="space-y-2">
              <TextField
                label="Name"
                required
                value={author.name}
                onChange={(v) => update({ name: v ?? "" })}
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <TextField
                  label="Department"
                  value={author.department}
                  onChange={(v) => update({ department: v })}
                />
                <TextField
                  label="Institution"
                  value={author.institution}
                  onChange={(v) => update({ institution: v })}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <TextField
                  label="City"
                  value={author.city}
                  onChange={(v) => update({ city: v })}
                />
                <TextField
                  label="Country"
                  value={author.country}
                  onChange={(v) => update({ country: v })}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <TextField
                  label="Email"
                  type="email"
                  value={author.email}
                  onChange={(v) => update({ email: v })}
                />
                <TextField
                  label="ORCID"
                  value={author.orcid}
                  onChange={(v) => update({ orcid: v })}
                  placeholder="0000-0000-0000-0000"
                />
              </div>
              <label className="flex items-center gap-2 text-[11px] text-[#5C4A32]">
                <input
                  type="radio"
                  name="corresponding"
                  checked={meta.correspondingAuthorIndex === i}
                  onChange={() => set("correspondingAuthorIndex", i)}
                />
                Corresponding author
              </label>
            </div>
          )}
        />
      </FormSection>

      <FormSection
        title="Abstract"
        description="Single paragraph, ~250 words. Rendered with a bold “Abstract—” prefix."
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
          label="Index Terms"
          value={meta.indexTerms}
          onChange={(v) => set("indexTerms", v)}
          hint="Alphabetised, 4–8 terms. IEEE uses “Index Terms”, not “Keywords”."
          onGenerate={onGenerateIndexTerms}
          generating={generatingIndexTerms}
        />
      </FormSection>

      <FormSection title="Acknowledgments">
        <TextAreaField
          label="Acknowledgments"
          value={meta.acknowledgments}
          onChange={(v) => set("acknowledgments", v)}
          rows={4}
        />
      </FormSection>
    </div>
  )
}
