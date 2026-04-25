"use client"

import type { AmaMeta, AuthorBlock } from "@/lib/academic-meta"
import {
  FormSection,
  NumberField,
  RepeatableList,
  StringListField,
  TextAreaField,
  TextField,
} from "./shared"

interface Props {
  meta: AmaMeta
  onChange: (next: AmaMeta) => void
  onGenerateStructuredAbstract?: () => void
  onGenerateKeyPoints?: () => void
  onGenerateKeywords?: () => void
  generatingAbstract?: boolean
  generatingKeyPoints?: boolean
  generatingKeywords?: boolean
  onAutoFillWordCountAbstract?: () => void
  onAutoFillWordCountText?: () => void
  autoFillingWordCountAbstract?: boolean
  autoFillingWordCountText?: boolean
  onAutoFillShortTitle?: () => void
  autoFillingShortTitle?: boolean
  onAutoFillCorresponding?: () => void
  onAutoFillNoConflict?: () => void
  onAutoFillNoFunding?: () => void
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

export default function AmaForm({
  meta,
  onChange,
  onGenerateStructuredAbstract,
  onGenerateKeyPoints,
  onGenerateKeywords,
  generatingAbstract,
  generatingKeyPoints,
  generatingKeywords,
  onAutoFillWordCountAbstract,
  onAutoFillWordCountText,
  autoFillingWordCountAbstract,
  autoFillingWordCountText,
  onAutoFillShortTitle,
  autoFillingShortTitle,
  onAutoFillCorresponding,
  onAutoFillNoConflict,
  onAutoFillNoFunding,
}: Props) {
  const set = <K extends keyof AmaMeta>(k: K, v: AmaMeta[K]) =>
    onChange({ ...meta, [k]: v })

  const setAbstract = <K extends keyof AmaMeta["structuredAbstract"]>(
    k: K,
    v: AmaMeta["structuredAbstract"][K]
  ) =>
    onChange({
      ...meta,
      structuredAbstract: { ...meta.structuredAbstract, [k]: v },
    })

  const setKeyPoints = <K extends keyof AmaMeta["keyPoints"]>(
    k: K,
    v: AmaMeta["keyPoints"][K]
  ) => onChange({ ...meta, keyPoints: { ...meta.keyPoints, [k]: v } })

  const setCorresponding = <K extends keyof AmaMeta["correspondingAuthor"]>(
    k: K,
    v: AmaMeta["correspondingAuthor"][K]
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
          onAutoFill={onAutoFillShortTitle}
          autoFillLoading={autoFillingShortTitle}
          autoFillHint="Truncate project title at 50 characters"
        />
      </FormSection>

      <FormSection
        title="Authors"
        description="AMA prints degrees after the name (e.g. “Smith MD, PhD”). Enter degrees comma-separated."
      >
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
              <StringListField
                label="Degrees"
                value={author.degrees}
                onChange={(v) => update({ degrees: v })}
                placeholder="MD, PhD"
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

      <FormSection
        title="Corresponding author"
        description="Auto-fill copies the first author's contact info into this block."
      >
        <div className="flex justify-end">
          {onAutoFillCorresponding ? (
            <button
              type="button"
              onClick={onAutoFillCorresponding}
              className="text-[11px] text-[#5C4A32] hover:underline"
            >
              ✨ Copy from first author
            </button>
          ) : null}
        </div>
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
        title="Key Points"
        description="A short 50–75 word box printed above the abstract: one sentence each for Question, Findings, Meaning."
      >
        <div className="flex justify-end">
          {onGenerateKeyPoints ? (
            <button
              type="button"
              onClick={onGenerateKeyPoints}
              disabled={generatingKeyPoints}
              className="text-[11px] text-[#5C4A32] hover:underline disabled:opacity-50"
            >
              {generatingKeyPoints ? "Generating…" : "✨ Generate Key Points"}
            </button>
          ) : null}
        </div>
        <TextAreaField
          label="Question"
          value={meta.keyPoints.question}
          onChange={(v) => setKeyPoints("question", v)}
          rows={2}
        />
        <TextAreaField
          label="Findings"
          value={meta.keyPoints.findings}
          onChange={(v) => setKeyPoints("findings", v)}
          rows={2}
        />
        <TextAreaField
          label="Meaning"
          value={meta.keyPoints.meaning}
          onChange={(v) => setKeyPoints("meaning", v)}
          rows={2}
        />
      </FormSection>

      <FormSection
        title="Structured abstract"
        description="AMA prescribes nine labelled sections for original research. Total ~350 words."
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
          label="Importance"
          value={meta.structuredAbstract.importance}
          onChange={(v) => setAbstract("importance", v)}
          rows={3}
        />
        <TextAreaField
          label="Objective"
          value={meta.structuredAbstract.objective}
          onChange={(v) => setAbstract("objective", v)}
          rows={3}
        />
        <TextAreaField
          label="Design, Setting, and Participants"
          value={meta.structuredAbstract.designSettingParticipants}
          onChange={(v) => setAbstract("designSettingParticipants", v)}
          rows={3}
        />
        <TextAreaField
          label="Interventions / Exposures"
          value={meta.structuredAbstract.interventions}
          onChange={(v) => setAbstract("interventions", v)}
          rows={3}
        />
        <TextAreaField
          label="Main Outcomes and Measures"
          value={meta.structuredAbstract.mainOutcomesAndMeasures}
          onChange={(v) => setAbstract("mainOutcomesAndMeasures", v)}
          rows={3}
        />
        <TextAreaField
          label="Results"
          value={meta.structuredAbstract.results}
          onChange={(v) => setAbstract("results", v)}
          rows={4}
        />
        <TextAreaField
          label="Conclusions and Relevance"
          value={meta.structuredAbstract.conclusionsAndRelevance}
          onChange={(v) => setAbstract("conclusionsAndRelevance", v)}
          rows={3}
        />
        <TextField
          label="Trial Registration"
          value={meta.structuredAbstract.trialRegistration}
          onChange={(v) => setAbstract("trialRegistration", v)}
          placeholder="ClinicalTrials.gov NCT01234567"
        />
        <StringListField
          label="Keywords"
          value={meta.keywords}
          onChange={(v) => set("keywords", v)}
          onGenerate={onGenerateKeywords}
          generating={generatingKeywords}
        />
      </FormSection>

      <FormSection title="Submission metadata">
        <div className="grid grid-cols-2 gap-3">
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
