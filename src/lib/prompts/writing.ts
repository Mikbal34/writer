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
import type { CitationFormat } from '@prisma/client'

// ==================== MAIN EXPORTED FUNCTIONS ====================

/**
 * Builds the complete writing prompt from a WritingContext.
 * Returns { systemPrompt, userPrompt } ready to be sent to Claude.
 *
 * Usage:
 *   const { systemPrompt, userPrompt } = getWritingPrompt(context)
 *   for await (const chunk of streamChat([{ role: 'user', content: userPrompt }], systemPrompt)) {
 *     ...
 *   }
 */
export function getWritingPrompt(context: WritingContext): {
  systemPrompt: string
  userPrompt: string
} {
  const systemPrompt = buildSystemPrompt(
    context.styleProfile,
    context.citationFormat,
    context.writingGuidelines
  )

  const userPrompt = getSessionContextPrompt(
    context.subsection,
    context.chapter,
    context.section,
    context.position,
    { prev: context.prevSubsection, next: context.nextSubsection },
    context.styleProfile,
    context.citationFormat,
    context.sources
  )

  return { systemPrompt, userPrompt }
}

/**
 * Assembles the full user-facing context prompt for a writing session.
 * This is also useful standalone when you need to inspect the prompt without streaming.
 */
export function getSessionContextPrompt(
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
    parts.push(`**Target Length:** approximately ${subsection.estimatedPages} pages`)
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

  // --- 6. Sources ---
  if (sources.length > 0) {
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

  // --- 7. Citation instructions ---
  parts.push(`## Citation Instructions`)
  parts.push(buildCitationInstructions(citationFormat))
  parts.push('')

  // --- 8. Style reminders ---
  if (styleProfile && Object.keys(styleProfile).length > 0) {
    parts.push(`## Writing Style Reminders`)
    parts.push(buildStyleReminders(styleProfile))
    parts.push('')
  }

  // --- 9. Output format ---
  parts.push(`## Output`)
  parts.push(
    `Write the full academic text for subsection ${subsection.subsectionId}: "${subsection.title}".`
  )
  parts.push(
    `Aim for approximately ${subsection.estimatedPages ?? 3}–${(subsection.estimatedPages ?? 3) + 1} pages of academic prose.`
  )
  parts.push(
    `Do not include the subsection heading — just the body text with footnote markers indicated as [fn: citation text].`
  )
  parts.push(
    `Footnote format: Insert [fn: <citation>] immediately after the punctuation that follows the referenced claim.`
  )

  return parts.join('\n')
}

// ==================== PRIVATE HELPERS ====================

function buildSystemPrompt(
  styleProfile: Partial<StyleProfile> | null,
  citationFormat: CitationFormat,
  writingGuidelines: string | null
): string {
  const lines: string[] = []

  lines.push(
    `You are an expert academic ghostwriter assisting with a scholarly book. Your task is to write rigorous, well-argued academic prose for the subsection described in the user prompt.`
  )
  lines.push('')

  lines.push(`## Core Writing Rules`)
  lines.push(`- Academic register: objective, analytical, argument-driven.`)
  lines.push(`- Do NOT use first person ("I", "we") unless the project style requires it.`)
  lines.push(`- Every claim that draws on a source must have a footnote marker.`)
  lines.push(`- Define technical terms on their first occurrence.`)
  lines.push(`- Maintain dialogue between classical and modern scholarship.`)
  lines.push(`- Paragraphs should be well-structured with clear topic sentences.`)
  lines.push('')

  if (styleProfile) {
    const voiceNote =
      styleProfile.usesFirstPerson === false
        ? 'Avoid first person.'
        : styleProfile.usesFirstPerson === true
        ? 'First person is acceptable.'
        : ''
    if (voiceNote) lines.push(`- ${voiceNote}`)

    if (styleProfile.tone) {
      lines.push(`- Tone: ${styleProfile.tone}.`)
    }
    if (styleProfile.rhetoricalApproach) {
      lines.push(`- Rhetorical approach: ${styleProfile.rhetoricalApproach}.`)
    }
    lines.push('')
  }

  lines.push(`## Citation Format: ${citationFormat}`)
  lines.push(buildCitationSystemNote(citationFormat))
  lines.push('')

  if (writingGuidelines) {
    lines.push(`## Project-Specific Writing Guidelines`)
    lines.push(writingGuidelines)
    lines.push('')
  }

  return lines.join('\n')
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
  }
  return notes[citationFormat] ?? ''
}

function buildStyleReminders(styleProfile: Partial<StyleProfile>): string {
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
