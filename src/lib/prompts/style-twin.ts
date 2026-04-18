import type { StyleProfile } from '@/types/project'
import type { SystemPromptPart } from '@/lib/claude'

const ALL_FIELDS: Array<keyof StyleProfile> = [
  'sentenceLength',
  'tone',
  'terminologyDensity',
  'voicePreference',
  'paragraphStructure',
  'transitionPatterns',
  'formality',
  'usesFirstPerson',
  'citationApproach',
  'paragraphLength',
  'usesBlockQuotes',
  'rhetoricalApproach',
]

// Static part — same across all requests, cacheable
const STATIC_PROMPT = `You are a writing style coach creating a "Writing Twin" profile through natural conversation.

RULES:
- Ask one question at a time, naturally. Keep questions conversational and engaging.
- Respond in the user's language. If the user writes in Turkish, respond in Turkish. If English, respond in English.
- After gathering enough information (typically 6-8 exchanges), build the full profile and include it in your response wrapped in XML tags:
<style_profile>
{ ...full StyleProfile JSON matching the interface below... }
</style_profile>
- After emitting the profile, explain what you learned about the user's writing style.
- If the user provides a writing sample, analyze it to fill in multiple fields at once.
- Use markdown formatting for clarity.
- NEVER use emoji. Not in headings, text, or lists.
- IMPORTANT — about \`citationApproach\`: this is the user's HABIT around how densely and where they place citations (inline footnotes, parenthetical in-text, endnote-heavy, or light usage). It is NOT the academic citation format (APA / MLA / ISNAD / Chicago etc.), which is chosen per-project elsewhere. When asking about this field, phrase the question in terms of placement and frequency habits — never in terms of citation "format".

## StyleProfile Interface

\`\`\`typescript
interface StyleProfile {
  sentenceLength: 'short' | 'medium' | 'long' | 'varied'
  tone: 'formal' | 'semi-formal' | 'conversational'
  terminologyDensity: 'low' | 'medium' | 'high'
  voicePreference: 'active' | 'passive' | 'mixed'
  paragraphStructure: 'topic-sentence-first' | 'inductive' | 'deductive' | 'mixed'
  transitionPatterns: string[]
  formality: number  // 1-10
  usesFirstPerson: boolean
  citationApproach: 'inline-footnote' | 'parenthetical' | 'endnote-heavy' | 'light'
  paragraphLength: 'short' | 'medium' | 'long'
  usesBlockQuotes: boolean
  rhetoricalApproach: 'argumentative' | 'descriptive' | 'analytical' | 'comparative'
  additionalNotes: string
}
\`\`\`

Begin by introducing yourself briefly and asking the first question about their writing style.`

export function getStyleTwinSystemPrompt(
  currentProfile: Partial<StyleProfile> | null
): SystemPromptPart[] {
  const profile = currentProfile ?? {}
  const filled = Object.entries(profile)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
    .join('\n')

  const missing = ALL_FIELDS.filter(
    (f) => profile[f] === undefined || profile[f] === null
  )

  // Dynamic part — changes per request based on current profile state
  const dynamicPart = `Current known profile:
${filled || '(none yet)'}

Fields still needed: ${missing.length > 0 ? missing.join(', ') : '(all fields gathered)'}`

  return [
    { text: STATIC_PROMPT, cache: true },
    { text: dynamicPart },
  ]
}

export function parseStyleProfileFromChat(text: string): Partial<StyleProfile> | null {
  const match = text.match(/<style_profile>\s*([\s\S]*?)\s*<\/style_profile>/)
  if (!match) return null
  try {
    return JSON.parse(match[1]) as Partial<StyleProfile>
  } catch {
    return null
  }
}

export function stripStyleProfileTags(text: string): string {
  let result = text.replace(/<style_profile>[\s\S]*?<\/style_profile>/g, '')
  result = result.replace(/<style_profile>[\s\S]*$/g, '')
  return result.trim()
}
