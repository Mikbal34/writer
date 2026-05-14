import type { ProjectStyleOverrides } from '@/types/project'

/**
 * Project-style chat prompt builder.
 *
 * Per-project knobs that override the Writing Twin during writing:
 * tone, formality, 1st-person, voice, terminology density, citation
 * density, paragraph length, block quotes. Smart defaults are inferred
 * from the project basics (type, language, audience) and surfaced up
 * front so the user can accept with one click or tweak via chat.
 */

export interface ProjectBasics {
  projectType: 'ACADEMIC' | 'CREATIVE' | string
  language: string
  audience?: string | null
  topic?: string | null
  citationFormat?: string | null
}

/**
 * Heuristic defaults: a Turkish academic thesis should default to a
 * very different style than an English popular essay. Audience phrases
 * shift the values further. Callers can use these as initial values to
 * one-click-accept; the chat can refine from there.
 */
export function inferProjectStyleDefaults(basics: ProjectBasics): ProjectStyleOverrides {
  const isAcademic = basics.projectType === 'ACADEMIC'
  const isTurkish = basics.language?.toLowerCase().startsWith('tr')
  const audienceHint = (basics.audience ?? '').toLowerCase()
  const isPopular =
    /halk|genel|popüler|popular|general|public/.test(audienceHint)

  let defaults: ProjectStyleOverrides

  if (isAcademic) {
    defaults = {
      tone: 'formal',
      formality: isTurkish ? 9 : 8,
      usesFirstPerson: false,
      voicePreference: isTurkish ? 'passive' : 'mixed',
      terminologyDensity: 'high',
      citationDensity: 'dense',
      paragraphLength: 'medium',
      usesBlockQuotes: true,
      notes: '',
    }
  } else {
    // CREATIVE / NESIR / web / anything non-academic
    defaults = {
      tone: 'semi-formal',
      formality: 5,
      usesFirstPerson: true,
      voicePreference: 'active',
      terminologyDensity: 'low',
      citationDensity: 'light',
      paragraphLength: 'medium',
      usesBlockQuotes: false,
      notes: '',
    }
  }

  // Audience override: writing for the general public softens academic
  // defaults — drop formality two points and ease the terminology load.
  if (isPopular) {
    defaults.formality = Math.max(1, (defaults.formality ?? 5) - 2)
    if (defaults.terminologyDensity === 'high') defaults.terminologyDensity = 'medium'
    if (defaults.tone === 'formal') defaults.tone = 'semi-formal'
  }

  return defaults
}

export interface ProjectStyleChatTurn {
  done: boolean
  reply: string
  styleOverrides?: ProjectStyleOverrides
}

/**
 * System prompt for the project-setup chat. Mirrors the style-interview
 * shape: single-shot per turn, returns JSON the frontend feeds back as
 * conversation. Defaults block tells the LLM what to suggest if the user
 * is undecided so the chat ends in 2–3 turns rather than 6–8.
 */
export function getProjectStyleSystemPrompt(
  basics: ProjectBasics,
  defaults: ProjectStyleOverrides,
  current: Partial<ProjectStyleOverrides> | null,
): string {
  const lang = basics.language?.toLowerCase().startsWith('tr') ? 'Turkish' : 'the user\'s language'

  const currentSummary = current
    ? Object.entries(current)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
        .join('\n') || '  (none yet)'
    : '  (none yet)'

  return `You are a writing coach helping the author tune *project-specific* style
preferences for ONE manuscript. These overrides ride on top of the user's
stable Writing Twin and only apply to this project.

## Project basics
- type: ${basics.projectType}
- language: ${basics.language}
- audience: ${basics.audience ?? '(unspecified)'}
- topic: ${basics.topic ?? '(unspecified)'}
- citation format: ${basics.citationFormat ?? '(unspecified)'}

## Smart defaults for this project type
${JSON.stringify(defaults, null, 2)}

## What the user has set so far
${currentSummary}

## Fields to gather (8 total)
- tone: 'formal' | 'semi-formal' | 'conversational'
- formality: integer 1–10
- usesFirstPerson: boolean
- voicePreference: 'active' | 'passive' | 'mixed'
- terminologyDensity: 'low' | 'medium' | 'high'
- citationDensity: 'light' | 'normal' | 'dense'   // citations per paragraph the AI should target
- paragraphLength: 'short' | 'medium' | 'long'
- usesBlockQuotes: boolean
(Plus an optional free-text 'notes' field at the end.)

## Behaviour
- Respond in ${lang}.
- Ask one focused question at a time. Reference the defaults to anchor:
  e.g. "Tezlerde tipik olarak 2-3 atıf/paragraf yoğunluğu olur. Sen daha
  yoğun mu, daha hafif mi tercih edersin?"
- If the user says "olduğu gibi bırak", "default", "skip", "sen karar
  ver", or similar — finalise immediately with the defaults.
- After 3–4 exchanges (or sooner if the user delegated), return the full
  styleOverrides object and set done=true.
- NEVER use emoji.

## Response shape (JSON only — no markdown fences, no explanation)

While interviewing:
{ "done": false, "reply": "<your next question in ${lang}>" }

When finalising:
{ "done": true, "reply": "<short confirmation in ${lang}>", "styleOverrides": { ...full ProjectStyleOverrides... } }`
}

/**
 * Convert the AI's per-turn JSON into the same shape the frontend can
 * stitch back into a chat thread. Tolerates the model returning slightly
 * out-of-shape JSON.
 */
export function normaliseProjectStyleTurn(
  raw: unknown,
): ProjectStyleChatTurn {
  if (typeof raw !== 'object' || raw === null) {
    return { done: false, reply: 'Devam edelim — bir sonraki soruyu kaçırdım.' }
  }
  const r = raw as Record<string, unknown>
  const done = Boolean(r.done)
  const reply = typeof r.reply === 'string' ? r.reply : ''
  if (!done) return { done: false, reply }
  const overrides = (r.styleOverrides as ProjectStyleOverrides) ?? undefined
  return { done: true, reply, styleOverrides: overrides }
}
