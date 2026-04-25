"use client"

import type { AuthorBlock, VancouverMeta } from "@/lib/academic-meta"
import {
  FormSection,
  NumberField,
  RepeatableList,
  StringListField,
  TextAreaField,
  TextField,
} from "./shared"

interface Props {
  meta: VancouverMeta
  onChange: (next: VancouverMeta) => void
  onGenerateStructuredAbstract?: () => void
  onGenerateKeywords?: () => void
  generatingAbstract?: boolean
  generatingKeywords?: boolean
  onAutoFillWordCountAbstract?: () => void
  onAutoFillWordCountText?: () => void
  onAutoFillTableCount?: () => void
  onAutoFillFigureCount?: () => void
  autoFillingWordCountAbstract?: boolean
  autoFillingWordCountText?: boolean
  autoFillingTableCount?: boolean
  autoFillingFigureCount?: boolean
  onAutoFillShortTitle?: () => void
  autoFillingShortTitle?: boolean
  onAutoFillNoConflict?: () => void
  onAutoFillNoFunding?: () => void
  onAutoFillNoTrial?: () => void
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

export default function VancouverForm({
  meta,
  onChange,
  onGenerateStructuredAbstract,
  onGenerateKeywords,
  generatingAbstract,
  generatingKeywords,
  onAutoFillWordCountAbstract,
  onAutoFillWordCountText,
  onAutoFillTableCount,
  onAutoFillFigureCount,
  autoFillingWordCountAbstract,
  autoFillingWordCountText,
  autoFillingTableCount,
  autoFillingFigureCount,
  onAutoFillShortTitle,
  autoFillingShortTitle,
  onAutoFillNoConflict,
  onAutoFillNoFunding,
  onAutoFillNoTrial,
}: Props) {
  const set = <K extends keyof VancouverMeta>(k: K, v: VancouverMeta[K]) =>
    onChange({ ...meta, [k]: v })

  const setAbstract = <K extends keyof VancouverMeta["structuredAbstract"]>(
    k: K,
    v: VancouverMeta["structuredAbstract"][K]
  ) =>
    onChange({
      ...meta,
      structuredAbstract: { ...meta.structuredAbstract, [k]: v },
    })

  const setCorresponding = <K extends keyof VancouverMeta["correspondingAuthor"]>(
    k: K,
    v: VancouverMeta["correspondingAuthor"][K]
  ) =>
    onChange({
      ...meta,
      correspondingAuthor: { ...meta.correspondingAuthor, [k]: v },
    })

  return (
    <div className="space-y-6">
      <FormSection title="Title">
        <TextField
          label="Short title (running head)"
          value={meta.shortTitle}
          onChange={(v) => set("shortTitle", v)}
          maxLength={50}
          hint="40–50 characters, printed on every page of the manuscript."
          onAutoFill={onAutoFillShortTitle}
          autoFillLoading={autoFillingShortTitle}
          autoFillHint="Truncate project title at 50 characters"
        />
      </FormSection>

      <FormSection title="Authors">
        <RepeatableList<AuthorBlock>
          title="Authors"
          items={meta.authors}
          onChange={(next) => set("authors", next)}
          emptyItem={emptyAuthor}
          addLabel="Add author"
          itemLabel={(i) => `Author ${i + 1}`}
          minItems={1}
          renderItem={(author, _, update) => (
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
            </div>
          )}
        />
      </FormSection>

      <FormSection title="Corresponding author">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TextField
            label="Name"
            value={meta.correspondingAuthor.name}
            onChange={(v) => setCorresponding("name", v)}
          />
          <TextField
            label="Email"
            type="email"
            value={meta.correspondingAuthor.email}
            onChange={(v) => setCorresponding("email", v)}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TextField
            label="Phone"
            value={meta.correspondingAuthor.phone}
            onChange={(v) => setCorresponding("phone", v)}
          />
          <TextField
            label="Address"
            value={meta.correspondingAuthor.address}
            onChange={(v) => setCorresponding("address", v)}
          />
        </div>
      </FormSection>

      <FormSection
        title="Structured abstract"
        description="Four labelled sections. Total ~250 words."
      >
        <div className="flex justify-end">
          {onGenerateStructuredAbstract ? (
            <button
              type="button"
              onClick={onGenerateStructuredAbstract}
              disabled={generatingAbstract}
              className="text-[11px] text-[#5C4A32] hover:underline disabled:opacity-50"
            >
              {generatingAbstract ? "Generating…" : "✨ Generate all sections"}
            </button>
          ) : null}
        </div>
        <TextAreaField
          label="Background"
          value={meta.structuredAbstract.background}
          onChange={(v) => setAbstract("background", v)}
          rows={4}
        />
        <TextAreaField
          label="Methods"
          value={meta.structuredAbstract.methods}
          onChange={(v) => setAbstract("methods", v)}
          rows={4}
        />
        <TextAreaField
          label="Results"
          value={meta.structuredAbstract.results}
          onChange={(v) => setAbstract("results", v)}
          rows={4}
        />
        <TextAreaField
          label="Conclusions"
          value={meta.structuredAbstract.conclusions}
          onChange={(v) => setAbstract("conclusions", v)}
          rows={4}
        />
        <StringListField
          label="Keywords / MeSH terms"
          value={meta.keywords}
          onChange={(v) => set("keywords", v)}
          hint="2–10 MeSH terms."
          onGenerate={onGenerateKeywords}
          generating={generatingKeywords}
        />
      </FormSection>

      <FormSection
        title="Submission metadata"
        description="Word counts, tables and figures count from the project's written content with one click."
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <NumberField
            label="Abstract word count"
            value={meta.wordCountAbstract}
            onChange={(v) => set("wordCountAbstract", v)}
            onAutoFill={onAutoFillWordCountAbstract}
            autoFillLoading={autoFillingWordCountAbstract}
            autoFillHint="Count words in the structured abstract"
          />
          <NumberField
            label="Text word count"
            value={meta.wordCountText}
            onChange={(v) => set("wordCountText", v)}
            onAutoFill={onAutoFillWordCountText}
            autoFillLoading={autoFillingWordCountText}
            autoFillHint="Count words in all written subsections"
          />
          <NumberField
            label="Tables"
            value={meta.tableCount}
            onChange={(v) => set("tableCount", v)}
            onAutoFill={onAutoFillTableCount}
            autoFillLoading={autoFillingTableCount}
            autoFillHint="Detect markdown tables in the manuscript"
          />
          <NumberField
            label="Figures"
            value={meta.figureCount}
            onChange={(v) => set("figureCount", v)}
            onAutoFill={onAutoFillFigureCount}
            autoFillLoading={autoFillingFigureCount}
            autoFillHint="Count images and figures in the manuscript"
          />
        </div>
        <TextAreaField
          label="Conflict of interest"
          value={meta.conflictOfInterest}
          onChange={(v) => set("conflictOfInterest", v)}
          rows={3}
          onAutoFill={onAutoFillNoConflict}
          autoFillHint='Insert "The authors declare no conflict of interest."'
        />
        <TextAreaField
          label="Funding"
          value={meta.funding}
          onChange={(v) => set("funding", v)}
          rows={3}
          onAutoFill={onAutoFillNoFunding}
          autoFillHint='Insert "This research received no specific funding."'
        />
        <TextField
          label="Trial registration"
          value={meta.trialRegistration}
          onChange={(v) => set("trialRegistration", v)}
          placeholder="e.g. ClinicalTrials.gov NCT01234567"
          onAutoFill={onAutoFillNoTrial}
          autoFillHint='Insert "Not applicable" — non-clinical study'
        />
        <TextAreaField
          label="Acknowledgments"
          value={meta.acknowledgments}
          onChange={(v) => set("acknowledgments", v)}
          rows={3}
        />
      </FormSection>
    </div>
  )
}
