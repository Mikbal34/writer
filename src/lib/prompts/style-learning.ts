import type { StyleProfile } from '@/types/project'

// ==================== STYLE ANALYSIS ====================

/**
 * Builds a prompt that asks Claude to analyse a writing sample and extract
 * a StyleProfile. The response is expected to be valid JSON.
 *
 * Usage:
 *   const prompt = getStyleAnalysisPrompt(sampleText)
 *   const json   = await generateJSON<StyleProfile>(prompt, STYLE_SYSTEM_PROMPT)
 */
export function getStyleAnalysisPrompt(sampleText: string): string {
  return `Analyse the following writing sample and extract a detailed style profile. Return a JSON object that strictly matches the TypeScript interface below.

## TypeScript Interface

\`\`\`typescript
interface StyleProfile {
  sentenceLength: 'short' | 'medium' | 'long' | 'varied'
  tone: 'formal' | 'semi-formal' | 'conversational'
  terminologyDensity: 'low' | 'medium' | 'high'
  voicePreference: 'active' | 'passive' | 'mixed'
  paragraphStructure: 'topic-sentence-first' | 'inductive' | 'deductive' | 'mixed'
  transitionPatterns: string[]        // Array of transition words/phrases the author uses
  formality: number                   // 1 (very informal) to 10 (very formal)
  usesFirstPerson: boolean
  citationStyle: 'inline-footnote' | 'parenthetical' | 'endnote-heavy' | 'light'
  paragraphLength: 'short' | 'medium' | 'long'
  usesBlockQuotes: boolean
  rhetoricalApproach: 'argumentative' | 'descriptive' | 'analytical' | 'comparative'
  additionalNotes: string             // Free-form observations about distinctive features
}
\`\`\`

## Writing Sample

${sampleText}

## Instructions

- Infer \`sentenceLength\` from average words per sentence: short < 15, medium 15–25, long > 25.
- \`terminologyDensity\` refers to domain-specific or technical vocabulary frequency.
- \`transitionPatterns\`: list up to 10 actual transition words or phrases observed in the sample.
- \`formality\`: score 1–10 based on vocabulary complexity, sentence structure, and register.
- \`additionalNotes\`: describe any distinctive rhetorical features, unusual punctuation habits, or patterns not captured by the structured fields.
- Return ONLY the JSON object. No markdown, no explanation.`
}

// ==================== STYLE INTERVIEW ====================

/**
 * Returns a prompt that asks Claude to identify the single most important
 * next question to ask the user in order to complete their style profile.
 *
 * Usage:
 *   const prompt = getStyleInterviewPrompt(partialProfile)
 *   const response = await generateJSON<{ question: string; field: keyof StyleProfile }>(prompt)
 */
export function getStyleInterviewPrompt(
  currentProfile: Partial<StyleProfile>
): string {
  const filled = Object.entries(currentProfile)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
    .join('\n')

  const allFields: Array<keyof StyleProfile> = [
    'sentenceLength',
    'tone',
    'terminologyDensity',
    'voicePreference',
    'paragraphStructure',
    'transitionPatterns',
    'formality',
    'usesFirstPerson',
    'citationStyle',
    'paragraphLength',
    'usesBlockQuotes',
    'rhetoricalApproach',
  ]

  const missing = allFields.filter(
    (f) => currentProfile[f] === undefined || currentProfile[f] === null
  )

  return `You are helping a writer build their personal style profile for an AI writing assistant.

## Already Known Style Attributes
${filled || '  (none yet)'}

## Missing Attributes
${missing.join(', ')}

## Task
Identify the single most important missing attribute and generate one natural, friendly question to ask the writer about it.

Return a JSON object in this exact shape:
{
  "field": "<attribute name from Missing Attributes>",
  "question": "<the question to ask the writer, phrased naturally in the language appropriate for an academic writer>",
  "options": ["<option1>", "<option2>", ...]   // optional: include if the answer choices are finite
}

Return ONLY the JSON. No markdown, no explanation.`
}

// ==================== PARSE STYLE PROFILE ====================

/**
 * Parses a Claude JSON response string into a StyleProfile.
 * Handles both raw JSON and JSON wrapped in markdown code fences.
 *
 * Usage:
 *   const profile = parseStyleProfile(claudeResponseText)
 */
export function parseStyleProfile(response: string): StyleProfile {
  const clean = response
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(clean)
  } catch {
    throw new Error(`Failed to parse style profile JSON.\nRaw:\n${response}`)
  }

  // Apply defaults for any missing optional fields
  const profile: StyleProfile = {
    sentenceLength: (raw.sentenceLength as StyleProfile['sentenceLength']) ?? 'varied',
    tone: (raw.tone as StyleProfile['tone']) ?? 'formal',
    terminologyDensity:
      (raw.terminologyDensity as StyleProfile['terminologyDensity']) ?? 'medium',
    voicePreference:
      (raw.voicePreference as StyleProfile['voicePreference']) ?? 'mixed',
    paragraphStructure:
      (raw.paragraphStructure as StyleProfile['paragraphStructure']) ??
      'topic-sentence-first',
    transitionPatterns: Array.isArray(raw.transitionPatterns)
      ? (raw.transitionPatterns as string[])
      : [],
    formality: typeof raw.formality === 'number' ? raw.formality : 7,
    usesFirstPerson:
      typeof raw.usesFirstPerson === 'boolean' ? raw.usesFirstPerson : false,
    citationStyle:
      (raw.citationStyle as StyleProfile['citationStyle']) ?? 'inline-footnote',
    paragraphLength:
      (raw.paragraphLength as StyleProfile['paragraphLength']) ?? 'medium',
    usesBlockQuotes:
      typeof raw.usesBlockQuotes === 'boolean' ? raw.usesBlockQuotes : false,
    rhetoricalApproach:
      (raw.rhetoricalApproach as StyleProfile['rhetoricalApproach']) ?? 'analytical',
    additionalNotes:
      typeof raw.additionalNotes === 'string' ? raw.additionalNotes : undefined,
  }

  return profile
}

// ==================== SYSTEM PROMPT ====================

export const STYLE_SYSTEM_PROMPT = `You are an expert writing style analyst. Your task is to carefully examine writing samples and identify distinctive stylistic patterns. Be precise, evidence-based, and consistent in your analysis. Always respond with valid JSON only.`
