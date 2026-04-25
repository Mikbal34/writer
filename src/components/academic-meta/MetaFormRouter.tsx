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
  const { meta, onChange, generating, ...handlers } = props

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
          generatingAbstractTr={generating?.abstractTr}
          generatingAbstractEn={generating?.abstractEn}
          generatingKeywordsTr={generating?.keywordsTr}
          generatingKeywordsEn={generating?.keywordsEn}
        />
      )
  }
}
