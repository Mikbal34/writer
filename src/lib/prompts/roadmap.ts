import type { ProjectWithRelations } from '@/types/project'
import type { BookStructure } from '@/types/project'

// ==================== ROADMAP GENERATION PROMPT ====================

/**
 * Builds the prompt that asks Claude to generate a complete book structure
 * (chapters → sections → subsections) from the project info.
 *
 * The response must be valid JSON matching BookStructure.
 *
 * Usage:
 *   const prompt = getRoadmapGenerationPrompt(project)
 *   const structure = await generateJSON<BookStructure>(prompt, ROADMAP_SYSTEM_PROMPT)
 */
export function getRoadmapGenerationPrompt(project: ProjectWithRelations): string {
  const meta = [
    `Title: ${project.title}`,
    project.description ? `Description: ${project.description}` : null,
    project.topic ? `Topic/Subject: ${project.topic}` : null,
    project.purpose ? `Purpose / Research Question: ${project.purpose}` : null,
    project.audience ? `Target Audience: ${project.audience}` : null,
    `Language: ${project.language}`,
    `Citation Format: ${project.citationFormat}`,
  ]
    .filter(Boolean)
    .join('\n')

  return `You are a scholarly book planning assistant. Generate a detailed, academically rigorous book structure (table of contents with metadata) based on the following project information.

## Project Information

${meta}

## Output Format

Return a JSON object that strictly matches the TypeScript interface below. Do not include any text outside the JSON.

\`\`\`typescript
interface BookSubsection {
  id: string           // "X.Y.Z" format, e.g. "1.1.1"
  title: string        // Concise subsection heading
  description: string  // 2–3 sentences explaining what this subsection covers
  whatToWrite: string  // Specific writing instructions for the author
  keyPoints: string[]  // 3–6 key arguments or points to make
  writingStrategy: string  // How to approach writing this subsection
  estimatedPages: number   // Realistic page estimate (typically 2–5)
  sources: {
    classical: Array<{ author: string; work: string; relevance: string; priority: 'primary' | 'supporting' }>
    modern:    Array<{ author: string; work: string; relevance: string; priority: 'primary' | 'supporting' }>
  }
}

interface BookSection {
  id: string           // "X.Y" format, e.g. "1.1"
  title: string
  keyConcepts: string[]  // 3–8 key concepts or terms introduced in this section
  subsections: BookSubsection[]
}

interface BookChapter {
  id: number
  title: string
  purpose: string      // One sentence stating the chapter's scholarly purpose
  estimatedPages: number
  sections: BookSection[]
}

interface BookStructure {
  title: string
  chapters: BookChapter[]
}
\`\`\`

## Requirements

- Produce a coherent, logically ordered structure that builds the argument progressively.
- Each chapter should have 2–4 sections; each section should have 2–4 subsections.
- Subsection IDs must follow the "chapter.section.subsection" numbering convention (e.g., 1.1.1, 1.1.2, 1.2.1).
- Section IDs must follow "chapter.section" (e.g., 1.1, 1.2).
- Include an introductory chapter (Chapter 1) and a conclusion chapter as appropriate.
- Source suggestions should be realistic for the topic — use well-known scholars and works where possible.
- Return ONLY the JSON object. No markdown fences, no preamble.`
}

// ==================== PARSE BOOK STRUCTURE ====================

/**
 * Parses a Claude response string into a validated BookStructure.
 * Strips markdown code fences if present and validates the top-level shape.
 *
 * Usage:
 *   const structure = parseBookStructure(claudeResponseText)
 */
export function parseBookStructure(response: string): BookStructure {
  const clean = response
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  let raw: unknown
  try {
    raw = JSON.parse(clean)
  } catch {
    throw new Error(
      `Failed to parse book structure JSON.\nRaw response (first 500 chars):\n${response.slice(0, 500)}`
    )
  }

  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Book structure response is not a JSON object.')
  }

  const obj = raw as Record<string, unknown>

  if (typeof obj.title !== 'string' || obj.title.trim() === '') {
    throw new Error('Book structure missing required "title" field.')
  }

  if (!Array.isArray(obj.chapters) || obj.chapters.length === 0) {
    throw new Error('Book structure missing or empty "chapters" array.')
  }

  // Validate each chapter minimally
  const chapters = obj.chapters as Array<Record<string, unknown>>
  for (const ch of chapters) {
    if (typeof ch.id !== 'number') {
      throw new Error(`Chapter missing numeric "id": ${JSON.stringify(ch)}`)
    }
    if (typeof ch.title !== 'string') {
      throw new Error(`Chapter ${ch.id} missing "title".`)
    }
    if (!Array.isArray(ch.sections)) {
      throw new Error(`Chapter ${ch.id} missing "sections" array.`)
    }
    for (const sec of ch.sections as Array<Record<string, unknown>>) {
      if (typeof sec.id !== 'string') {
        throw new Error(`Section in chapter ${ch.id} missing "id".`)
      }
      if (!Array.isArray(sec.subsections)) {
        throw new Error(`Section ${sec.id} missing "subsections" array.`)
      }
    }
  }

  return raw as BookStructure
}

// ==================== SYSTEM PROMPT ====================

export const ROADMAP_SYSTEM_PROMPT = `You are an expert academic book planner and structural editor. You produce detailed, well-organised book outlines that follow sound scholarly methodology. You respond with valid JSON only.`
