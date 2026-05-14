import type { WritingTwinProfile } from '@/types/project'
import type { SystemPromptPart } from '@/lib/claude'

/**
 * Writing Twin prompt builder.
 *
 * Twin only collects the *stable* parts of a writer's voice — what stays
 * the same whether they're writing a thesis or a popular essay. The
 * project-specific knobs (tone, formality, 1st-person, voice preference,
 * terminology density, paragraph length, block quotes, citation density)
 * are gathered separately during the project setup step and stored under
 * `Project.writingGuidelines.styleOverrides` — see prompts/project-style.ts.
 */

const ALL_FIELDS: Array<keyof WritingTwinProfile> = [
  'sentenceLength',
  'paragraphStructure',
  'transitionPatterns',
  'rhetoricalApproach',
  'additionalNotes',
]

// Static part — same across all requests, cacheable
const STATIC_PROMPT = `You are a writing style coach creating a "Writing Twin" profile through natural conversation.

The Writing Twin captures the *stable* parts of someone's writing voice —
the bits that travel with the author from project to project. Things like
tone, formality, first-person usage, citation density, terminology
density, paragraph length, voice (active/passive), and block-quote habit
are NOT collected here — those shift per project and get gathered later
in the project setup flow. Do not ask about them.

RULES:
- Ask one question at a time, naturally. Keep questions conversational and engaging.
- Respond in the user's language. If the user writes in Turkish, respond in Turkish. If English, respond in English.
- Cover the five Twin fields below — typically 4-6 exchanges is enough.
- After gathering enough information, build the full profile and include it in your response wrapped in XML tags:
<style_profile>
{ ...WritingTwinProfile JSON matching the interface below... }
</style_profile>
- After emitting the profile, explain what you learned about the user's writing style.
- If the user provides a writing sample, analyze it to fill in multiple fields at once.
- Use markdown formatting for clarity.
- NEVER use emoji. Not in headings, text, or lists.

## WritingTwinProfile Interface

\`\`\`typescript
interface WritingTwinProfile {
  sentenceLength: 'short' | 'medium' | 'long' | 'varied'
  paragraphStructure: 'topic-sentence-first' | 'inductive' | 'deductive' | 'mixed'
  transitionPatterns: string[]   // ~5 phrases the author reaches for
  rhetoricalApproach: 'argumentative' | 'descriptive' | 'analytical' | 'comparative'
  additionalNotes: string         // any quirks: pet phrases, sentence rhythm, structural habits
}
\`\`\`

Begin by introducing yourself briefly and asking the first question about their writing style.`

export function getStyleTwinSystemPrompt(
  currentProfile: Partial<WritingTwinProfile> | null
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

export function parseStyleProfileFromChat(text: string): Partial<WritingTwinProfile> | null {
  const match = text.match(/<style_profile>\s*([\s\S]*?)\s*<\/style_profile>/)
  if (!match) return null
  try {
    return JSON.parse(match[1]) as Partial<WritingTwinProfile>
  } catch {
    return null
  }
}

export function stripStyleProfileTags(text: string): string {
  let result = text.replace(/<style_profile>[\s\S]*?<\/style_profile>/g, '')
  result = result.replace(/<style_profile>[\s\S]*$/g, '')
  return result.trim()
}
