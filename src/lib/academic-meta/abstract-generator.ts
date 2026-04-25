/**
 * Format-aware AI abstract generator.
 *
 * The caller picks a `target` (flat abstract, Vancouver 4-section,
 * AMA 9-section, AMA key points, IEEE index terms, plain keywords, or
 * ISNAD dual-language). This module builds the appropriate system +
 * user prompt, calls Claude, and returns a typed result that matches
 * the shape the form will splice back into AcademicMeta.
 */

import { streamChatWithUsage, SONNET } from '@/lib/claude'
import type { AcademicFormat } from './schemas'

/** Raw text assembled from the project's written subsections. */
export interface SourceText {
  title: string
  language: string
  body: string
}

export type AbstractTarget =
  | 'abstract'            // flat abstract (APA, MLA, Chicago, Turabian, Harvard)
  | 'structuredAbstract'  // Vancouver 4-section or AMA 9-section (dispatched by format)
  | 'keyPoints'           // AMA only
  | 'indexTerms'          // IEEE only (alphabetical 4-8 terms)
  | 'keywords'            // generic keyword list for other formats
  | 'abstractTr'          // ISNAD Turkish özet
  | 'abstractEn'          // ISNAD English abstract
  | 'keywordsTr'          // ISNAD Turkish anahtar kelimeler
  | 'keywordsEn'          // ISNAD English keywords

export type AbstractResult =
  | { kind: 'text'; text: string }
  | { kind: 'keywords'; terms: string[] }
  | {
      kind: 'vancouverStructured'
      background: string
      methods: string
      results: string
      conclusions: string
    }
  | {
      kind: 'amaStructured'
      importance: string
      objective: string
      designSettingParticipants: string
      interventions: string
      mainOutcomesAndMeasures: string
      results: string
      conclusionsAndRelevance: string
      trialRegistration: string
    }
  | {
      kind: 'keyPoints'
      question: string
      findings: string
      meaning: string
    }

// =================================================================
//  Prompt builders
// =================================================================

const BASE_RULES = [
  'You are an academic writing assistant.',
  'Write in third person. No meta-commentary, no preambles, no "here is" framing.',
  'Return ONLY the requested content, nothing else.',
  'Never fabricate citations, numbers, or findings that are not present in the source.',
].join(' ')

function flatAbstractPrompt(
  format: AcademicFormat,
  wordLimit: number,
  language: 'en' | 'tr'
): string {
  const languageName = language === 'tr' ? 'Turkish' : 'English'
  return [
    BASE_RULES,
    `Produce a single-paragraph abstract in ${languageName}, no more than ${wordLimit} words.`,
    `Follow ${format} conventions: state problem, approach, key findings, and significance.`,
    'Output plain prose only. No heading, no label, no bullet points.',
  ].join(' ')
}

const VANCOUVER_STRUCTURED_PROMPT = [
  BASE_RULES,
  'Produce a Vancouver-style structured abstract with exactly four labelled sections:',
  'Background, Methods, Results, Conclusions.',
  'Each section 40–70 words. Total no more than 250 words.',
  'Output as JSON with keys: background, methods, results, conclusions. No other text.',
].join(' ')

const AMA_STRUCTURED_PROMPT = [
  BASE_RULES,
  'Produce an AMA-style structured abstract with the following nine labelled sections:',
  'Importance, Objective, Design/Setting/Participants, Interventions, Main Outcomes and Measures, Results, Conclusions and Relevance, Trial Registration.',
  'Each section 25–50 words. Total no more than 350 words.',
  'If trial registration does not apply, return an empty string for that field.',
  'Output as JSON with keys: importance, objective, designSettingParticipants, interventions, mainOutcomesAndMeasures, results, conclusionsAndRelevance, trialRegistration. No other text.',
].join(' ')

const AMA_KEY_POINTS_PROMPT = [
  BASE_RULES,
  'Produce an AMA "Key Points" box — a short pre-abstract summary.',
  'Three fields:',
  '  question: one sentence, the research question.',
  '  findings: one sentence, the primary result.',
  '  meaning: one sentence, the clinical or scientific implication.',
  'Total 50–75 words across all three fields.',
  'Output as JSON with keys: question, findings, meaning. No other text.',
].join(' ')

const IEEE_INDEX_TERMS_PROMPT = [
  BASE_RULES,
  'Produce 4–8 IEEE "Index Terms" in alphabetical order.',
  'Each term is a short noun phrase, lower-case unless a proper noun.',
  'Output as a JSON array of strings. No other text.',
].join(' ')

const KEYWORDS_PROMPT = [
  BASE_RULES,
  'Produce 3–5 keywords describing the paper.',
  'Each keyword is a short noun phrase.',
  'Output as a JSON array of strings. No other text.',
].join(' ')

// =================================================================
//  Prompt dispatcher
// =================================================================

function buildSystemPrompt(
  format: AcademicFormat,
  target: AbstractTarget
): { prompt: string; expects: 'text' | 'json-object' | 'json-array' } {
  switch (target) {
    case 'abstract': {
      const limits: Record<AcademicFormat, number> = {
        APA: 250,
        MLA: 250,
        CHICAGO: 300,
        TURABIAN: 350,
        HARVARD: 250,
        IEEE: 250,
        VANCOUVER: 250,
        AMA: 350,
        ISNAD: 250,
      }
      return {
        prompt: flatAbstractPrompt(format, limits[format], 'en'),
        expects: 'text',
      }
    }
    case 'abstractTr':
      return { prompt: flatAbstractPrompt(format, 250, 'tr'), expects: 'text' }
    case 'abstractEn':
      return { prompt: flatAbstractPrompt(format, 250, 'en'), expects: 'text' }
    case 'structuredAbstract':
      if (format === 'AMA') {
        return { prompt: AMA_STRUCTURED_PROMPT, expects: 'json-object' }
      }
      return { prompt: VANCOUVER_STRUCTURED_PROMPT, expects: 'json-object' }
    case 'keyPoints':
      return { prompt: AMA_KEY_POINTS_PROMPT, expects: 'json-object' }
    case 'indexTerms':
      return { prompt: IEEE_INDEX_TERMS_PROMPT, expects: 'json-array' }
    case 'keywords':
    case 'keywordsTr':
    case 'keywordsEn':
      return { prompt: KEYWORDS_PROMPT, expects: 'json-array' }
  }
}

// =================================================================
//  Source-text compression
// =================================================================

/**
 * Hard cap on the user-message character count. Claude's context window
 * is much larger but for abstract generation the opener + middle + close
 * of each chapter is enough — full-book concatenation wastes tokens.
 */
const MAX_CHARS = 60_000

/**
 * Strips markdown formatting and truncates long bodies so the prompt
 * stays focused on content. If the book is longer than MAX_CHARS we
 * sample front/middle/back thirds.
 */
function compressSource(body: string): string {
  const stripped = body
    .replace(/^#+\s+/gm, '')
    .replace(/\[\^[^\]]+\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (stripped.length <= MAX_CHARS) return stripped

  const third = Math.floor(MAX_CHARS / 3)
  const front = stripped.slice(0, third)
  const mid = stripped.slice(
    Math.floor(stripped.length / 2) - Math.floor(third / 2),
    Math.floor(stripped.length / 2) + Math.floor(third / 2)
  )
  const back = stripped.slice(-third)
  return `${front}\n\n[...]\n\n${mid}\n\n[...]\n\n${back}`
}

// =================================================================
//  Public entry point
// =================================================================

export async function generateAbstract(params: {
  format: AcademicFormat
  target: AbstractTarget
  source: SourceText
}): Promise<AbstractResult> {
  const { format, target, source } = params
  const { prompt, expects } = buildSystemPrompt(format, target)

  const compressed = compressSource(source.body)
  if (!compressed) {
    throw new Error('Project has no written content to summarise yet.')
  }

  const userMessage = [
    `Title: ${source.title}`,
    `Language: ${source.language}`,
    '',
    'Manuscript text:',
    compressed,
  ].join('\n')

  const { fullText } = await streamChatWithUsage(
    [{ role: 'user', content: userMessage }],
    prompt,
    undefined,
    { model: SONNET }
  )

  return coerceResult(target, expects, fullText)
}

// =================================================================
//  Response coercion
// =================================================================

function stripJsonFences(s: string): string {
  return s
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()
}

function coerceResult(
  target: AbstractTarget,
  expects: 'text' | 'json-object' | 'json-array',
  raw: string
): AbstractResult {
  if (expects === 'text') {
    return { kind: 'text', text: raw.trim() }
  }

  const cleaned = stripJsonFences(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`Model returned invalid JSON for target "${target}"`)
  }

  if (expects === 'json-array') {
    if (!Array.isArray(parsed)) {
      throw new Error(`Expected an array for "${target}"`)
    }
    return {
      kind: 'keywords',
      terms: (parsed as unknown[])
        .filter((x): x is string => typeof x === 'string')
        .map((s) => s.trim())
        .filter(Boolean),
    }
  }

  const obj = parsed as Record<string, unknown>
  const getStr = (k: string) =>
    typeof obj[k] === 'string' ? (obj[k] as string).trim() : ''

  if (target === 'keyPoints') {
    return {
      kind: 'keyPoints',
      question: getStr('question'),
      findings: getStr('findings'),
      meaning: getStr('meaning'),
    }
  }

  if (target === 'structuredAbstract') {
    // Distinguish AMA (9 keys) vs Vancouver (4 keys).
    if ('importance' in obj || 'conclusionsAndRelevance' in obj) {
      return {
        kind: 'amaStructured',
        importance: getStr('importance'),
        objective: getStr('objective'),
        designSettingParticipants: getStr('designSettingParticipants'),
        interventions: getStr('interventions'),
        mainOutcomesAndMeasures: getStr('mainOutcomesAndMeasures'),
        results: getStr('results'),
        conclusionsAndRelevance: getStr('conclusionsAndRelevance'),
        trialRegistration: getStr('trialRegistration'),
      }
    }
    return {
      kind: 'vancouverStructured',
      background: getStr('background'),
      methods: getStr('methods'),
      results: getStr('results'),
      conclusions: getStr('conclusions'),
    }
  }

  throw new Error(`Unhandled target "${target}"`)
}
