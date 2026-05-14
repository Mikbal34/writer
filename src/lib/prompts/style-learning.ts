import type { WritingTwinProfile } from '@/types/project'

// ==================== STYLE ANALYSIS ====================

/**
 * Builds a prompt that asks Claude to analyse a writing sample and extract
 * a WritingTwinProfile. The response is expected to be valid JSON.
 *
 * Only the *stable* parts of the author's voice are extracted here —
 * project-specific knobs like tone / formality / 1st-person / etc. live in
 * ProjectStyleOverrides and are gathered separately in project setup.
 *
 * Usage:
 *   const prompt = getStyleAnalysisPrompt(sampleText)
 *   const json   = await generateJSON<WritingTwinProfile>(prompt, STYLE_SYSTEM_PROMPT)
 */
export function getStyleAnalysisPrompt(sampleText: string): string {
  return `Analyse the following writing sample and extract the author's *stable* writing twin profile — only the parts that travel from project to project. Return a JSON object that strictly matches the TypeScript interface below.

## TypeScript Interface

\`\`\`typescript
interface WritingTwinProfile {
  sentenceLength: 'short' | 'medium' | 'long' | 'varied'
  paragraphStructure: 'topic-sentence-first' | 'inductive' | 'deductive' | 'mixed'
  transitionPatterns: string[]        // ~5–10 actual transition words/phrases the author reaches for
  rhetoricalApproach: 'argumentative' | 'descriptive' | 'analytical' | 'comparative'
  additionalNotes: string             // pet phrases, rhythm quirks, structural habits not captured above
}
\`\`\`

## Writing Sample

${sampleText}

## Instructions

- Infer \`sentenceLength\` from average words per sentence: short < 15, medium 15–25, long > 25.
- \`transitionPatterns\`: list up to 10 actual transition words or phrases observed in the sample.
- \`additionalNotes\`: describe distinctive rhetorical features, unusual punctuation habits, or patterns not captured by the structured fields.
- Do NOT include tone, formality, voice, terminology density, paragraph length, block quotes, or first-person usage — those are project-scoped and asked elsewhere.
- Return ONLY the JSON object. No markdown, no explanation.`
}

// ==================== STYLE INTERVIEW ====================

/**
 * Returns a prompt that asks Claude to identify the single most important
 * next question to ask the user in order to complete their Twin profile.
 *
 * Usage:
 *   const prompt = getStyleInterviewPrompt(partialProfile)
 *   const response = await generateJSON<{ question: string; field: keyof WritingTwinProfile }>(prompt)
 */
export function getStyleInterviewPrompt(
  currentProfile: Partial<WritingTwinProfile>
): string {
  const filled = Object.entries(currentProfile)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
    .join('\n')

  const allFields: Array<keyof WritingTwinProfile> = [
    'sentenceLength',
    'paragraphStructure',
    'transitionPatterns',
    'rhetoricalApproach',
    'additionalNotes',
  ]

  const missing = allFields.filter(
    (f) => currentProfile[f] === undefined || currentProfile[f] === null
  )

  return `You are helping a writer build their personal Writing Twin — only the stable, project-independent parts of their style.

## Already Known
${filled || '  (none yet)'}

## Missing
${missing.join(', ') || '(none)'}

## Task
Identify the single most important missing attribute and generate one natural, friendly question to ask the writer about it.

Return a JSON object in this exact shape:
{
  "field": "<attribute name from Missing>",
  "question": "<the question to ask the writer, phrased naturally in the language appropriate for an academic writer>",
  "options": ["<option1>", "<option2>", ...]   // optional: include if the answer choices are finite
}

Return ONLY the JSON. No markdown, no explanation.`
}

// ==================== PARSE STYLE PROFILE ====================

/**
 * Parses a Claude JSON response string into a WritingTwinProfile.
 * Handles both raw JSON and JSON wrapped in markdown code fences.
 * Legacy fields from the old 13-field StyleProfile shape are silently
 * dropped — only the 5 Twin fields are kept.
 *
 * Usage:
 *   const profile = parseStyleProfile(claudeResponseText)
 */
export function parseStyleProfile(response: string): WritingTwinProfile {
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

  const profile: WritingTwinProfile = {
    sentenceLength: (raw.sentenceLength as WritingTwinProfile['sentenceLength']) ?? 'varied',
    paragraphStructure:
      (raw.paragraphStructure as WritingTwinProfile['paragraphStructure']) ??
      'topic-sentence-first',
    transitionPatterns: Array.isArray(raw.transitionPatterns)
      ? (raw.transitionPatterns as string[])
      : [],
    rhetoricalApproach:
      (raw.rhetoricalApproach as WritingTwinProfile['rhetoricalApproach']) ?? 'analytical',
    additionalNotes:
      typeof raw.additionalNotes === 'string' ? raw.additionalNotes : undefined,
  }

  return profile
}

// ==================== SYSTEM PROMPT ====================

export const STYLE_SYSTEM_PROMPT = `You are an expert writing style analyst. Your task is to carefully examine writing samples and identify distinctive stylistic patterns. Be precise, evidence-based, and consistent in your analysis. Always respond with valid JSON only.`
