/**
 * Writing Session Prompts
 *
 * Ported from: tez/scripts/oturum_prompt_sablonu.md
 *
 * Builds the full system + user prompt for a single writing session
 * (one subsection of the book).
 */

import type {
  WritingContext,
  StyleProfile,
  SubsectionFull,
  SectionWithSubsections,
  ChapterWithSections,
  PositionInfo,
  PrevNextSubsection,
  SourceMappingInfo,
} from '@/types/project'
import type { CitationFormat, ProjectType } from '@prisma/client'
import type { SystemPromptPart } from '@/lib/claude'
import { getFormatSettings } from '@/lib/constants'

// ==================== MAIN EXPORTED FUNCTIONS ====================

/**
 * Builds the complete writing prompt from a WritingContext.
 * Returns { systemPromptParts, userPrompt } ready to be sent to Claude.
 *
 * systemPromptParts uses cache_control for the static core rules portion.
 */
export function getWritingPrompt(context: WritingContext): {
  systemPromptParts: SystemPromptPart[]
  userPrompt: string
} {
  const systemPromptParts = buildSystemPromptParts(
    context.projectType,
    context.styleProfile,
    context.citationFormat,
    context.writingGuidelines
  )

  const userPrompt = getSessionContextPrompt(
    context.projectType,
    context.subsection,
    context.chapter,
    context.section,
    context.position,
    { prev: context.prevSubsection, next: context.nextSubsection },
    context.styleProfile,
    context.citationFormat,
    context.sources
  )

  return { systemPromptParts, userPrompt }
}

/**
 * Assembles the full user-facing context prompt for a writing session.
 * This is also useful standalone when you need to inspect the prompt without streaming.
 */
export function getSessionContextPrompt(
  projectType: ProjectType,
  subsection: SubsectionFull,
  chapter: ChapterWithSections,
  section: SectionWithSubsections,
  position: PositionInfo,
  prevNext: { prev: PrevNextSubsection | null; next: PrevNextSubsection | null },
  styleProfile: Partial<StyleProfile> | null,
  citationFormat: CitationFormat,
  sources: SourceMappingInfo[]
): string {
  const parts: string[] = []

  // --- 1. Task header ---
  parts.push(`# Writing Session: ${subsection.subsectionId}`)
  parts.push('')

  // --- 2. Hierarchy info ---
  parts.push(`## Book Position`)
  parts.push(`- **Chapter ${chapter.number}:** ${chapter.title}`)
  parts.push(`- **Section ${section.sectionId}:** ${section.title}`)
  parts.push(`- **Subsection ${subsection.subsectionId}:** ${subsection.title}`)
  parts.push('')

  // --- 3. What to write ---
  parts.push(`## Subsection Details`)
  if (subsection.description) {
    parts.push(`**Description:** ${subsection.description}`)
  }
  if (subsection.whatToWrite) {
    parts.push(`**What to Write:** ${subsection.whatToWrite}`)
  }
  if (subsection.keyPoints && subsection.keyPoints.length > 0) {
    parts.push(`**Key Points to Cover:**`)
    subsection.keyPoints.forEach((kp) => parts.push(`  - ${kp}`))
  }
  if (subsection.writingStrategy) {
    parts.push(`**Writing Strategy:** ${subsection.writingStrategy}`)
  }
  if (subsection.estimatedPages) {
    const { wordsPerPage } = getFormatSettings(citationFormat)
    const targetWords = subsection.estimatedPages * wordsPerPage
    parts.push(`**Target Length:** approximately ${targetWords}–${targetWords + Math.round(wordsPerPage * 0.2)} words (${subsection.estimatedPages} pages, ~${wordsPerPage} words/page)`)
  }
  parts.push('')

  // --- 4. Position instructions ---
  parts.push(`## Position Instructions`)
  const positionNotes = buildPositionInstructions(position)
  if (positionNotes.length > 0) {
    positionNotes.forEach((note) => parts.push(note))
  } else {
    parts.push('- This is an intermediate subsection. No special opening or closing required.')
  }
  parts.push('')

  // --- 5. Transition context ---
  parts.push(`## Transition Context`)
  if (prevNext.prev) {
    parts.push(
      `- **Previous subsection (${prevNext.prev.subsectionId}):** ${prevNext.prev.title}`
    )
    parts.push(`  → End with a transition sentence that flows naturally from this.`)
  } else {
    parts.push('- **Previous:** (none — this is the very first subsection of the book)')
  }
  if (prevNext.next) {
    parts.push(
      `- **Next subsection (${prevNext.next.subsectionId}):** ${prevNext.next.title}`
    )
    parts.push(
      `  → Close in a way that creates a natural lead-in to the next subsection.`
    )
  } else {
    parts.push('- **Next:** (none — this is the final subsection of the book)')
  }
  parts.push('')

  // --- 6. Sources (ACADEMIC only) ---
  if (projectType === 'ACADEMIC' && sources.length > 0) {
    parts.push(`## Sources for This Subsection`)
    parts.push('')

    const primary = sources.filter((s) => s.priority === 'primary')
    const supporting = sources.filter((s) => s.priority === 'supporting')

    if (primary.length > 0) {
      parts.push(`### Primary Sources`)
      primary.forEach((s) => {
        const author = s.authorName
          ? `${s.authorSurname}, ${s.authorName}`
          : s.authorSurname
        parts.push(`- **${author}** — *${s.title}*`)
        if (s.relevance) parts.push(`  Relevance: ${s.relevance}`)
        if (s.howToUse) parts.push(`  How to use: ${s.howToUse}`)
        if (s.whereToFind) parts.push(`  Where to find: ${s.whereToFind}`)
        if (s.extractionGuide) parts.push(`  What to extract: ${s.extractionGuide}`)
      })
      parts.push('')
    }

    if (supporting.length > 0) {
      parts.push(`### Supporting Sources`)
      supporting.forEach((s) => {
        const author = s.authorName
          ? `${s.authorSurname}, ${s.authorName}`
          : s.authorSurname
        parts.push(`- **${author}** — *${s.title}*`)
        if (s.relevance) parts.push(`  Relevance: ${s.relevance}`)
        if (s.howToUse) parts.push(`  How to use: ${s.howToUse}`)
        if (s.whereToFind) parts.push(`  Where to find: ${s.whereToFind}`)
        if (s.extractionGuide) parts.push(`  What to extract: ${s.extractionGuide}`)
      })
      parts.push('')
    }
  }

  // --- 7. Citation instructions (ACADEMIC only) ---
  if (projectType === 'ACADEMIC') {
    parts.push(`## Citation Instructions`)
    parts.push(buildCitationInstructions(citationFormat))
    parts.push('')
  }

  // --- 8. Style reminders ---
  if (styleProfile && Object.keys(styleProfile).length > 0) {
    parts.push(`## Writing Style Reminders`)
    parts.push(buildStyleReminders(styleProfile, projectType))
    parts.push('')
  }

  // --- 9. Output format (type-specific) ---
  parts.push(`## Output`)

  const wordTarget = (() => {
    const { wordsPerPage } = getFormatSettings(citationFormat)
    const pages = subsection.estimatedPages ?? 3
    const target = pages * wordsPerPage
    const tolerance = Math.round(wordsPerPage * 0.2)
    return `Write approximately ${target}–${target + tolerance} words.`
  })()

  if (projectType === 'STORY') {
    parts.push(
      `Write the full narrative text for subsection ${subsection.subsectionId}: "${subsection.title}".`
    )
    parts.push(wordTarget)
    parts.push(
      `Do not include the subsection heading — just the narrative body.`
    )
    parts.push(
      `Focus on storytelling: scene-setting, character development, dialogue, and emotional resonance. Do NOT include academic footnotes or citations.`
    )
  } else if (projectType === 'BOOK') {
    parts.push(
      `Write the full text for subsection ${subsection.subsectionId}: "${subsection.title}".`
    )
    parts.push(wordTarget)
    parts.push(
      `Do not include the subsection heading — just the body text.`
    )
    parts.push(
      `Write in an engaging, informative style. Do NOT include academic footnotes or citations.`
    )
  } else {
    // ACADEMIC
    parts.push(
      `Write the full academic text for subsection ${subsection.subsectionId}: "${subsection.title}".`
    )
    parts.push(
      (() => {
        const { wordsPerPage } = getFormatSettings(citationFormat)
        const pages = subsection.estimatedPages ?? 3
        const target = pages * wordsPerPage
        const tolerance = Math.round(wordsPerPage * 0.2)
        return `Write approximately ${target}–${target + tolerance} words (${pages} academic pages, ~${wordsPerPage} words/page for ${citationFormat} format). This word count is important — do not write significantly more or less.`
      })()
    )
    parts.push(
      `Do not include the subsection heading — just the body text with footnote markers indicated as [fn: citation text].`
    )
    parts.push(
      `Footnote format: Insert [fn: <citation>] immediately after the punctuation that follows the referenced claim.`
    )
  }

  return parts.join('\n')
}

// ==================== CONSTANTS ====================

const FORMATTING_RULES = `## Formatting
You may use standard markdown formatting when it improves clarity:
- **Bold** (\`**text**\`) for emphasis or key terms.
- *Italic* (\`*text*\`) for titles, foreign words, or light emphasis.
- Bullet lists (\`- item\`) and numbered lists (\`1. item\`) when presenting multiple points, steps, or comparisons.
- Tables (markdown table syntax) when comparing data, listing attributes, or presenting structured information.
- Blockquotes (\`> text\`) for direct quotations or highlighted passages.
- Horizontal rules (\`---\`) for thematic breaks between major sections within the subsection.
- Subheadings (\`## heading\` or \`### heading\`) only when the subsection is long enough to warrant internal structure.
Do NOT overuse formatting — prose should remain the primary medium. Use tables and lists only when they genuinely serve the content better than flowing text.`

// ==================== PRIVATE HELPERS ====================

function buildSystemPromptParts(
  projectType: ProjectType,
  styleProfile: Partial<StyleProfile> | null,
  citationFormat: CitationFormat,
  writingGuidelines: string | null
): SystemPromptPart[] {
  // --- Part 1: Core rules (cacheable, same across project) ---
  const coreLines: string[] = []

  if (projectType === 'STORY') {
    coreLines.push(
      `You are an expert fiction writer and storytelling craftsman. Your task is to write compelling, immersive narrative prose for the section described in the user prompt.`
    )
    coreLines.push('')
    coreLines.push(`## Core Writing Rules`)
    coreLines.push(`- Write vivid, engaging prose with strong sensory details.`)
    coreLines.push(`- Develop characters through actions, dialogue, and internal thoughts.`)
    coreLines.push(`- Build atmosphere and tension appropriate to the scene.`)
    coreLines.push(`- Use varied sentence structures for rhythm and pacing.`)
    coreLines.push(`- Show, don't tell — convey emotions through behavior, not labels.`)
    coreLines.push(`- Maintain consistent voice and point of view throughout.`)
    coreLines.push(`- Create natural, believable dialogue that reveals character.`)
    coreLines.push(`- Use scene transitions that maintain narrative flow.`)
    coreLines.push(`- Do NOT include academic footnotes, citations, or references.`)
    coreLines.push('')
    coreLines.push(FORMATTING_RULES)

    // Inject narrative preferences from styleProfile
    const narrativePrefs = buildNarrativePreferences(styleProfile)
    if (narrativePrefs) {
      coreLines.push('')
      coreLines.push(`## Narrative Preferences`)
      coreLines.push(narrativePrefs)
    }
  } else if (projectType === 'BOOK') {
    coreLines.push(
      `You are an expert non-fiction writer and communicator. Your task is to write clear, engaging, and informative prose for the section described in the user prompt.`
    )
    coreLines.push('')
    coreLines.push(`## Core Writing Rules`)
    coreLines.push(`- Write in an accessible, engaging tone — informative but not academic.`)
    coreLines.push(`- Use concrete examples and anecdotes to illustrate points.`)
    coreLines.push(`- Structure arguments clearly with smooth transitions.`)
    coreLines.push(`- Define technical terms naturally within context.`)
    coreLines.push(`- Maintain a conversational yet authoritative voice.`)
    coreLines.push(`- Use analogies and metaphors to explain complex ideas.`)
    coreLines.push(`- Keep the reader engaged with varied paragraph structures.`)
    coreLines.push(`- Do NOT include academic footnotes, citations, or references.`)
    coreLines.push('')
    coreLines.push(FORMATTING_RULES)

    const narrativePrefs = buildNarrativePreferences(styleProfile)
    if (narrativePrefs) {
      coreLines.push('')
      coreLines.push(`## Writing Preferences`)
      coreLines.push(narrativePrefs)
    }
  } else {
    // ACADEMIC — original prompt
    coreLines.push(
      `You are an expert academic ghostwriter assisting with a scholarly book. Your task is to write rigorous, well-argued academic prose for the subsection described in the user prompt.`
    )
    coreLines.push('')
    coreLines.push(`## Core Writing Rules`)
    coreLines.push(`- Academic register: objective, analytical, argument-driven.`)
    coreLines.push(`- Do NOT use first person ("I", "we") unless the project style requires it.`)
    coreLines.push(`- Every claim that draws on a source must have a footnote marker.`)
    coreLines.push(`- Define technical terms on their first occurrence.`)
    coreLines.push(`- Maintain dialogue between classical and modern scholarship.`)
    coreLines.push(`- Paragraphs should be well-structured with clear topic sentences.`)
    coreLines.push('')
    coreLines.push(FORMATTING_RULES)
    coreLines.push('')
    coreLines.push(`## Citation Format: ${citationFormat}`)
    coreLines.push(buildCitationSystemNote(citationFormat))
  }

  // --- Part 2: Style profile + writing guidelines (dynamic, project-specific) ---
  const dynamicLines: string[] = []

  if (styleProfile) {
    const voiceNote =
      styleProfile.usesFirstPerson === false
        ? 'Avoid first person.'
        : styleProfile.usesFirstPerson === true
        ? 'First person is acceptable.'
        : ''
    if (voiceNote) dynamicLines.push(`- ${voiceNote}`)

    if (styleProfile.tone) {
      dynamicLines.push(`- Tone: ${styleProfile.tone}.`)
    }
    if (styleProfile.rhetoricalApproach) {
      dynamicLines.push(`- Rhetorical approach: ${styleProfile.rhetoricalApproach}.`)
    }
  }

  if (writingGuidelines) {
    dynamicLines.push('')
    dynamicLines.push(`## Project-Specific Writing Guidelines`)
    dynamicLines.push(writingGuidelines)
  }

  const parts: SystemPromptPart[] = [
    { text: coreLines.join('\n'), cache: true },
  ]

  if (dynamicLines.length > 0) {
    parts.push({ text: dynamicLines.join('\n') })
  }

  return parts
}

function buildPositionInstructions(position: PositionInfo): string[] {
  const notes: string[] = []

  if (position.chapterFirst) {
    notes.push(
      `- **CHAPTER OPENING**: This is the first subsection of the chapter. Write a brief chapter introduction paragraph (1–2 paragraphs) before the subsection content that outlines the chapter's scope and purpose.`
    )
  }
  if (position.sectionFirst && !position.chapterFirst) {
    notes.push(
      `- **SECTION OPENING**: This is the first subsection of its section. Begin with a short section-opening sentence that signals what this section will explore.`
    )
  }
  if (position.sectionLast && !position.chapterLast) {
    notes.push(
      `- **SECTION CLOSING**: This is the last subsection of its section. End with a brief summary sentence or transition that closes the section and leads into the next.`
    )
  }
  if (position.chapterLast) {
    notes.push(
      `- **CHAPTER CLOSING**: This is the final subsection of the chapter. Conclude with a chapter summary paragraph (1 paragraph) that synthesises the chapter's findings and points toward the next chapter.`
    )
  }

  return notes
}

function buildCitationInstructions(citationFormat: CitationFormat): string {
  const base = `Use the ${citationFormat} citation format. Mark footnotes inline as [fn: <formatted citation>] immediately after the closing punctuation of the sentence that contains the cited claim.`

  const specifics: Partial<Record<CitationFormat, string>> = {
    ISNAD: `ISNAD 2. Baskı kuralları:
- Dipnotta yazar adı NORMAL sırada: Adı Soyadı (NOT Soyadı, Adı)
- Parçalar virgülle ayrılır (nokta DEĞİL)
- Yayınevi bilgisi parantez içinde: (Yer: Yayınevi, Yıl)
- age/agm KULLANILMAZ, tekrarlayan atıflarda kısa başlık kullanılır
- İlk atıf: Adı Soyadı, Başlık (Yer: Yayınevi, Yıl), Sayfa.
- Sonraki atıf: Soyadı, KısaBaşlık, Sayfa.
- Do NOT use markdown (*italic*, **bold**) inside [fn:] markers. Write plain text only.`,
    APA: `APA 7: Use (Author, Year, p. X) style markers in place of footnote markers.`,
    CHICAGO: `Chicago 17 Notes-Bibliography: Full citation on first use, short title on subsequent uses.`,
    MLA: `MLA 9: Use (Author Page) style in-text citations. No comma between author and page number.`,
    HARVARD: `Harvard (Cite Them Right) rules:
- In-text citation format: (Surname Year, p. X) — e.g., (Smith 2023, p. 45)
- Two authors: (Smith and Jones 2023)
- Three or more authors: (Smith et al. 2023)
- Multiple works: (Smith 2020; Jones 2023)
- Direct quote: include page number (Smith 2023, p. 45)
- Paraphrase: page number optional (Smith 2023)
- Do NOT use markdown (*italic*, **bold**) inside [fn:] markers. Write plain text only.`,
    VANCOUVER: `Vancouver/ICMJE rules:
- Use numbered references in order of first appearance
- Mark with superscript or bracketed numbers: [fn: 1], [fn: 2]
- Reuse the SAME number when citing the same source again
- Do NOT start a new number for a repeated source
- Author format: Surname Initials (no periods) — e.g., Smith AB
- List up to 6 authors, then "et al."
- Do NOT use markdown inside [fn:] markers. Write plain text only.`,
    IEEE: `IEEE citation rules:
- Use numbered references in square brackets: [fn: [1]], [fn: [2]]
- Number by order of first appearance; reuse same number for repeated citations
- Author format: Initial(s). Surname — e.g., A. B. Smith
- Article: A. B. Smith, "Article title," Journal Abbrev., vol. X, no. Y, pp. Z-W, Year.
- Book: A. B. Smith, Book Title, Edition. City: Publisher, Year.
- 3+ authors: first author et al.
- Do NOT use markdown inside [fn:] markers. Write plain text only.`,
    AMA: `AMA 11th edition rules:
- Use superscript numbered references: [fn: 1], [fn: 2]
- Number by order of first appearance; reuse same number
- Place superscript after periods and commas, before colons and semicolons
- Author format: Surname Initials (no periods) — e.g., Smith AB
- List up to 6 authors, then "et al"
- Journal: Author(s). Title. Journal Abbrev. Year;Vol(Issue):Pages. doi:
- Do NOT use markdown inside [fn:] markers. Write plain text only.`,
    TURABIAN: `Turabian 9th edition (Notes-Bibliography) rules:
- First use: Firstname Lastname, Title (Place: Publisher, Year), Page.
- Subsequent: Lastname, Short Title, Page.
- Bibliography: Lastname, Firstname. Title. Place: Publisher, Year.
- Very similar to Chicago but simplified for student papers
- Do NOT use markdown (*italic*, **bold**) inside [fn:] markers. Write plain text only.`,
  }

  const specific = specifics[citationFormat]
  return specific ? `${base}\n${specific}` : base
}

function buildCitationSystemNote(citationFormat: CitationFormat): string {
  const notes: Partial<Record<CitationFormat, string>> = {
    ISNAD: `When writing [fn:] markers, use the format:
  First use (kitap):     [fn: Adı Soyadı, Kitap Başlığı (Yer: Yayınevi, Yıl), Sayfa.]
  First use (makale):    [fn: Adı Soyadı, "Makale Başlığı", Dergi Cilt/Sayı (Yıl), Sayfa.]
  First use (neşir):     [fn: Adı Soyadı, Kitap Başlığı, nşr. Editör Adı Soyadı (Yer: Yayınevi, Yıl), Sayfa.]
  First use (çeviri):    [fn: Adı Soyadı, Kitap Başlığı, çev. Çevirmen Adı Soyadı (Yer: Yayınevi, Yıl), Sayfa.]
  First use (tez):       [fn: Adı Soyadı, "Tez Başlığı" (Doktora Tezi, Üniversite, Yıl), Sayfa.]
  First use (ansiklop.): [fn: Adı Soyadı, "Madde Adı", Ansiklopedi Cilt (Yer: Yayınevi, Yıl), Sayfa.]
  First use (web):       [fn: Adı Soyadı, "Başlık" (Erişim Yıl).]
  Subsequent:            [fn: Soyadı, KısaBaşlık, Sayfa.]
Rules:
  - Dipnotta yazar adı NORMAL sırada: Adı Soyadı (NOT Soyadı, Adı)
  - Parçalar virgülle ayrılır (nokta DEĞİL)
  - Yayınevi bilgisi parantez içinde: (Yer: Yayınevi, Yıl)
  - age/agm KULLANILMAZ, kısa başlık kullanılır
  - Kitap/eser adları italik DEĞİL, düz yazılır (markdown kullanma)
  - Do NOT use markdown formatting (*italic*, **bold**) inside [fn:] markers. Write plain text only.`,
    APA: `In-text citation markers: (Author, Year, p. X).`,
    CHICAGO: `Footnote markers:\n  First use:  [fn: Firstname Lastname, Title (Place: Publisher, Year), Page.]\n  Subsequent: [fn: Lastname, ShortTitle, Page.]`,
    MLA: `In-text citation markers: (Author Page).\n  Example: (Smith 45)`,
    HARVARD: `When writing [fn:] markers, use parenthetical format:
  Single author:  [fn: (Smith 2023, p. 45)]
  Two authors:    [fn: (Smith and Jones 2023, p. 12)]
  3+ authors:     [fn: (Smith et al. 2023)]
  No page (paraphrase): [fn: (Smith 2023)]
  Multiple works: [fn: (Smith 2020; Jones 2023)]`,
    VANCOUVER: `When writing [fn:] markers, use numbered format:
  [fn: 1] [fn: 2] [fn: 3]
  Reuse the same number for repeated citations of the same source.
  Reference list format:
  Journal: Surname AB, Surname CD. Title. J Abbrev. Year;Vol(Issue):Pages.
  Book: Surname AB. Title. Edition. Place: Publisher; Year.`,
    IEEE: `When writing [fn:] markers, use bracketed number format:
  [fn: [1]] [fn: [2]] [fn: [3]]
  Reuse the same number for repeated citations.
  Reference format:
  Journal: [1] A. B. Smith, "Title," J. Abbrev., vol. X, no. Y, pp. Z-W, Year.
  Book: [1] A. B. Smith, Book Title, Xth ed. City: Publisher, Year.`,
    AMA: `When writing [fn:] markers, use superscript number format:
  [fn: 1] [fn: 2] [fn: 3]
  Reuse the same number for repeated citations.
  Reference format:
  Journal: Surname AB, Surname CD. Title. J Abbrev. Year;Vol(Issue):Pages.
  Book: Surname AB. Title. Xth ed. Publisher; Year.`,
    TURABIAN: `When writing [fn:] markers, use notes format:
  First use (book):    [fn: Firstname Lastname, Book Title (Place: Publisher, Year), Page.]
  First use (article): [fn: Firstname Lastname, "Article Title," Journal Vol, no. Issue (Year): Page.]
  Subsequent:          [fn: Lastname, Short Title, Page.]`,
  }
  return notes[citationFormat] ?? ''
}

function buildNarrativePreferences(styleProfile: Partial<StyleProfile> | null): string | null {
  if (!styleProfile) return null
  const prefs: string[] = []

  const povLabels: Record<string, string> = {
    first_person: 'First person narration',
    second_person: 'Second person narration',
    third_person_limited: 'Third person limited POV',
    third_person_omniscient: 'Third person omniscient POV',
  }
  if (styleProfile.narrativePOV) {
    prefs.push(`- **Point of View:** ${povLabels[styleProfile.narrativePOV] ?? styleProfile.narrativePOV}`)
  }
  if (styleProfile.genre) {
    prefs.push(`- **Genre:** ${styleProfile.genre}`)
  }
  if (styleProfile.dialogueStyle) {
    const dlgLabels: Record<string, string> = {
      sparse: 'Minimal dialogue, mostly narrative prose',
      moderate: 'Balanced mix of dialogue and narrative',
      dialogue_heavy: 'Dialogue-heavy, characters drive the story through conversation',
    }
    prefs.push(`- **Dialogue:** ${dlgLabels[styleProfile.dialogueStyle] ?? styleProfile.dialogueStyle}`)
  }
  if (styleProfile.pacing) {
    const paceLabels: Record<string, string> = {
      slow: 'Slow, atmospheric pacing with detailed descriptions',
      moderate: 'Moderate pacing balancing action and reflection',
      fast: 'Fast-paced, action-driven with short scenes',
    }
    prefs.push(`- **Pacing:** ${paceLabels[styleProfile.pacing] ?? styleProfile.pacing}`)
  }
  if (styleProfile.moodAtmosphere) {
    prefs.push(`- **Mood / Atmosphere:** ${styleProfile.moodAtmosphere}`)
  }
  if (styleProfile.targetAgeGroup) {
    const ageLabels: Record<string, string> = {
      children: 'Children (simple language, age-appropriate content)',
      young_adult: 'Young adult (accessible language, coming-of-age themes)',
      adult: 'Adult (mature themes, complex language)',
    }
    prefs.push(`- **Target Audience:** ${ageLabels[styleProfile.targetAgeGroup] ?? styleProfile.targetAgeGroup}`)
  }
  if (styleProfile.narrativeStyle) {
    prefs.push(`- **Narrative Style:** ${styleProfile.narrativeStyle}`)
  }

  return prefs.length > 0 ? prefs.join('\n') : null
}

function buildStyleReminders(styleProfile: Partial<StyleProfile>, projectType?: ProjectType): string {
  const reminders: string[] = []

  if (styleProfile.sentenceLength) {
    const desc: Record<string, string> = {
      short: 'Keep sentences concise (under 15 words on average).',
      medium: 'Aim for medium-length sentences (15–25 words on average).',
      long: 'Longer, more complex sentences are appropriate (25+ words).',
      varied: 'Vary sentence length for rhythm and emphasis.',
    }
    reminders.push(desc[styleProfile.sentenceLength] ?? '')
  }

  if (styleProfile.paragraphLength) {
    const desc: Record<string, string> = {
      short: 'Keep paragraphs short (1–3 sentences).',
      medium: 'Use medium-length paragraphs (4–6 sentences).',
      long: 'Longer, more developed paragraphs (7+ sentences) are expected.',
    }
    reminders.push(desc[styleProfile.paragraphLength] ?? '')
  }

  if (styleProfile.transitionPatterns && styleProfile.transitionPatterns.length > 0) {
    reminders.push(
      `Preferred transition words: ${styleProfile.transitionPatterns.slice(0, 6).join(', ')}.`
    )
  }

  if (styleProfile.usesBlockQuotes === true) {
    reminders.push(
      'Long quotations (40+ words) should be formatted as block quotes (indent, no quotation marks).'
    )
  }

  if (styleProfile.additionalNotes) {
    reminders.push(`Additional style notes: ${styleProfile.additionalNotes}`)
  }

  return reminders.filter(Boolean).join('\n')
}
