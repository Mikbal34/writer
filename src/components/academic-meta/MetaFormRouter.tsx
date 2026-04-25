"use client"

import type { AcademicMeta } from "@/lib/academic-meta"
import ApaForm from "./ApaForm"
import MlaForm from "./MlaForm"
import ChicagoForm from "./ChicagoForm"
import TurabianForm from "./TurabianForm"
import HarvardForm from "./HarvardForm"
import IeeeForm from "./IeeeForm"
import VancouverForm from "./VancouverForm"
import AmaForm from "./AmaForm"
import IsnadForm from "./IsnadForm"

export type AutoFillTarget =
  | 'wordCountText'
  | 'wordCountAbstract'
  | 'tableCount'
  | 'figureCount'
  | 'wordCount'
  | 'date'
  | 'subtitle'
  | 'year'

export interface AiHandlers {
  onGenerateAbstract?: () => void
  onGenerateKeywords?: () => void
  onGenerateIndexTerms?: () => void
  onGenerateStructuredAbstract?: () => void
  onGenerateKeyPoints?: () => void
  onGenerateAbstractTr?: () => void
  onGenerateAbstractEn?: () => void
  onGenerateKeywordsTr?: () => void
  onGenerateKeywordsEn?: () => void

  /** Computes/derives a value from project content rather than calling AI. */
  onAutoFill?: (target: AutoFillTarget) => void

  generating?: {
    abstract?: boolean
    keywords?: boolean
    indexTerms?: boolean
    structuredAbstract?: boolean
    keyPoints?: boolean
    abstractTr?: boolean
    abstractEn?: boolean
    keywordsTr?: boolean
    keywordsEn?: boolean
  }
  autoFilling?: Partial<Record<AutoFillTarget, boolean>>
}

interface Props extends AiHandlers {
  meta: AcademicMeta
  onChange: (next: AcademicMeta) => void
}

/**
 * Dispatches to the format-specific form component based on the meta's
 * discriminator. Every child component is strictly typed to its
 * variant; no optional-chain or `?? {}` ever appears inside them.
 */
export default function MetaFormRouter(props: Props) {
  const { meta, onChange, generating, autoFilling, onAutoFill, ...handlers } = props

  // Tiny binders so each form receives a no-arg callback for its
  // specific auto-fill targets; the parent's onAutoFill takes the
  // discriminator string so we don't need 10 separate handlers there.
  const af = (target: AutoFillTarget) =>
    onAutoFill ? () => onAutoFill(target) : undefined

  switch (meta.format) {
    case "APA":
      return (
        <ApaForm
          meta={meta}
          onChange={onChange}
          onGenerateAbstract={handlers.onGenerateAbstract}
          onGenerateKeywords={handlers.onGenerateKeywords}
          generatingAbstract={generating?.abstract}
          generatingKeywords={generating?.keywords}
          onAutoFillDate={af("date")}
          autoFillingDate={autoFilling?.date}
        />
      )
    case "MLA":
      return (
        <MlaForm
          meta={meta}
          onChange={onChange}
          onGenerateAbstract={handlers.onGenerateAbstract}
          onGenerateKeywords={handlers.onGenerateKeywords}
          generatingAbstract={generating?.abstract}
          generatingKeywords={generating?.keywords}
          onAutoFillDate={af("date")}
          autoFillingDate={autoFilling?.date}
        />
      )
    case "CHICAGO":
      return (
        <ChicagoForm
          meta={meta}
          onChange={onChange}
          onGenerateAbstract={handlers.onGenerateAbstract}
          onGenerateKeywords={handlers.onGenerateKeywords}
          generatingAbstract={generating?.abstract}
          generatingKeywords={generating?.keywords}
          onAutoFillDate={af("date")}
          autoFillingDate={autoFilling?.date}
        />
      )
    case "TURABIAN":
      return (
        <TurabianForm
          meta={meta}
          onChange={onChange}
          onGenerateAbstract={handlers.onGenerateAbstract}
          onGenerateKeywords={handlers.onGenerateKeywords}
          generatingAbstract={generating?.abstract}
          generatingKeywords={generating?.keywords}
          onAutoFillDate={af("date")}
          autoFillingDate={autoFilling?.date}
        />
      )
    case "HARVARD":
      return (
        <HarvardForm
          meta={meta}
          onChange={onChange}
          onGenerateAbstract={handlers.onGenerateAbstract}
          onGenerateKeywords={handlers.onGenerateKeywords}
          generatingAbstract={generating?.abstract}
          generatingKeywords={generating?.keywords}
          onAutoFillWordCount={af("wordCount")}
          onAutoFillDate={af("date")}
          autoFillingWordCount={autoFilling?.wordCount}
          autoFillingDate={autoFilling?.date}
        />
      )
    case "IEEE":
      return (
        <IeeeForm
          meta={meta}
          onChange={onChange}
          onGenerateAbstract={handlers.onGenerateAbstract}
          onGenerateIndexTerms={handlers.onGenerateIndexTerms}
          generatingAbstract={generating?.abstract}
          generatingIndexTerms={generating?.indexTerms}
        />
      )
    case "VANCOUVER":
      return (
        <VancouverForm
          meta={meta}
          onChange={onChange}
          onGenerateStructuredAbstract={handlers.onGenerateStructuredAbstract}
          onGenerateKeywords={handlers.onGenerateKeywords}
          generatingAbstract={generating?.structuredAbstract}
          generatingKeywords={generating?.keywords}
          onAutoFillWordCountAbstract={af("wordCountAbstract")}
          onAutoFillWordCountText={af("wordCountText")}
          onAutoFillTableCount={af("tableCount")}
          onAutoFillFigureCount={af("figureCount")}
          autoFillingWordCountAbstract={autoFilling?.wordCountAbstract}
          autoFillingWordCountText={autoFilling?.wordCountText}
          autoFillingTableCount={autoFilling?.tableCount}
          autoFillingFigureCount={autoFilling?.figureCount}
        />
      )
    case "AMA":
      return (
        <AmaForm
          meta={meta}
          onChange={onChange}
          onGenerateStructuredAbstract={handlers.onGenerateStructuredAbstract}
          onGenerateKeyPoints={handlers.onGenerateKeyPoints}
          onGenerateKeywords={handlers.onGenerateKeywords}
          generatingAbstract={generating?.structuredAbstract}
          generatingKeyPoints={generating?.keyPoints}
          generatingKeywords={generating?.keywords}
          onAutoFillWordCountAbstract={af("wordCountAbstract")}
          onAutoFillWordCountText={af("wordCountText")}
          autoFillingWordCountAbstract={autoFilling?.wordCountAbstract}
          autoFillingWordCountText={autoFilling?.wordCountText}
        />
      )
    case "ISNAD":
      return (
        <IsnadForm
          meta={meta}
          onChange={onChange}
          onGenerateAbstractTr={handlers.onGenerateAbstractTr}
          onGenerateAbstractEn={handlers.onGenerateAbstractEn}
          onGenerateKeywordsTr={handlers.onGenerateKeywordsTr}
          onGenerateKeywordsEn={handlers.onGenerateKeywordsEn}
          onAutoFillYear={af("year")}
          autoFillingYear={autoFilling?.year}
          generatingAbstractTr={generating?.abstractTr}
          generatingAbstractEn={generating?.abstractEn}
          generatingKeywordsTr={generating?.keywordsTr}
          generatingKeywordsEn={generating?.keywordsEn}
        />
      )
  }
}
