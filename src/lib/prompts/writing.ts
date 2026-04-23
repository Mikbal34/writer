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

  // Project-constant citation instructions + style reminders are now carried by
  // the cacheable system prompt. User prompt stays lean / per-subsection.

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
        parts.push(`- \`bibId: ${s.bibliographyId}\` — **${author}** — *${s.title}*`)
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
        parts.push(`- \`bibId: ${s.bibliographyId}\` — **${author}** — *${s.title}*`)
        if (s.relevance) parts.push(`  Relevance: ${s.relevance}`)
        if (s.howToUse) parts.push(`  How to use: ${s.howToUse}`)
        if (s.whereToFind) parts.push(`  Where to find: ${s.whereToFind}`)
        if (s.extractionGuide) parts.push(`  What to extract: ${s.extractionGuide}`)
      })
      parts.push('')
    }
  }

  // Citation instructions + style reminders moved to cacheable system block
  // (they are project-constant and waste tokens per call in user prompt).

  // --- 9. Output format (type-specific) ---
  parts.push(`## Output`)

  const wordTarget = (() => {
    const { wordsPerPage } = getFormatSettings(citationFormat)
    const pages = subsection.estimatedPages ?? 3
    const target = pages * wordsPerPage
    const tolerance = Math.round(wordsPerPage * 0.2)
    return `Write approximately ${target}–${target + tolerance} words.`
  })()

  if (projectType !== 'ACADEMIC') {
    parts.push(
      `Write the full text for subsection ${subsection.subsectionId}: "${subsection.title}".`
    )
    parts.push(wordTarget)
    parts.push(
      `Do not include the subsection heading — just the body text.`
    )
    parts.push(
      `Adapt your voice to the content: vivid sensory narrative where the subsection is scenic, clear engaging exposition where it explains. Do NOT include academic footnotes or citations.`
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
- **Bold** (\`**text**\`) for emphasis or key terms — reserve for conceptual markers, not decoration.
- *Italic* (\`*text*\`) for titles of works, foreign words, technical terms on first use, or light emphasis.
- Bullet lists (\`- item\`) when presenting genuinely parallel, comparable items.
- Numbered lists (\`1. item\`) when ordering matters (sequence, priority, rank).
- Tables (markdown table syntax) when comparing data across clear dimensions; avoid tables for narrative content.
- Blockquotes (\`> text\`) for direct quotations of significant length (40+ words) or highlighted passages from primary sources.
- Horizontal rules (\`---\`) for thematic breaks between major sections within a long subsection; use sparingly.
- Subheadings (\`## heading\` or \`### heading\`) only when the subsection is long enough to warrant internal structure — generally 1000+ words.
- Code fences (\`\`\`) for verbatim quotation of code, structured data, or precise technical notation.
Do NOT overuse formatting — prose should remain the primary medium. Use tables and lists only when they genuinely serve the content better than flowing text. Avoid stacking formatting (bold inside italic, italic inside links) unless semantically required.

## Writing Process
Approach the subsection as a small self-contained argument:
1. Orient the reader briefly (what is this subsection doing in the broader chapter?).
2. Present the main claim or question.
3. Develop the argument with evidence, examples, and citations where required.
4. Handle counter-arguments or alternative framings when the material calls for it.
5. Close with a sentence that completes the thought and, where appropriate, bridges to what comes next.
Avoid filler phrases ("It is important to note that...", "In conclusion..."). Every sentence should carry its own weight.

## Voice Discipline
- Sentence variety is a style concern as well as a rhythm concern: avoid three consecutive sentences of identical length or structure.
- Prefer active voice unless the subject is genuinely unknown or the receiver of the action is the topic of the sentence.
- Avoid nominalisations ("the implementation of...") when a verb form would be more direct ("implementing...").
- Replace vague intensifiers ("very", "quite", "really") with precise modifiers when you can.
- Resist hedging unless the evidence genuinely demands it. "May be" and "could be" should mark actual uncertainty, not politeness.
- Prefer concrete nouns over abstract ones. "The study measured a decline" beats "A decline was observed in the study's measurements".
- Watch for false parallels in lists — each bullet should share grammatical form and conceptual scope with its siblings.
- Resist tautologies ("end result", "advance planning", "past history") — they inflate sentences without adding meaning.
- Prefer "because" over "due to the fact that", "if" over "in the event that", "to" over "in order to" when the shorter form fits.

## Paragraph Architecture
A well-built paragraph usually has:
1. A topic sentence that announces the paragraph's single controlling idea.
2. Supporting sentences that develop the idea through evidence, analysis, or illustration.
3. A closing sentence that either completes the argument or bridges to the next paragraph.
When a paragraph starts to do two jobs at once, split it. When it is too short to stand on its own, consider whether its idea belongs inside a neighbouring paragraph. Avoid "walls of text": paragraphs over about twelve lines of running prose typically need structural help — an embedded list, a pause point, or a logical split.

## Evidence and Claims
- Separate observation ("X happened") from interpretation ("X happened because..."). Readers should always know which is which.
- When you introduce a quotation, frame it: tell the reader who is speaking, why it matters, and what the reader should take from it.
- When you summarise a source, keep the level of abstraction honest. Do not tighten a nuanced argument into a slogan; do not over-qualify a clear one.
- Counter-arguments are not decoration. If you raise an objection, engage with it seriously enough that the reader understands why your position still holds.
- Numbers, dates, and named entities are often silently wrong in generated prose. Flag any fact you are not confident about rather than committing to it.

## Transitions
Good transitions earn their place; they do not merely announce "next point". Use them to signal the logical relationship between ideas:
- **Addition / reinforcement:** moreover, furthermore, in addition, what is more.
- **Contrast / tension:** however, yet, by contrast, in spite of this, on the other hand.
- **Causation / consequence:** consequently, therefore, thus, as a result, hence.
- **Concession:** admittedly, granted, to be sure, although it is true that.
- **Exemplification:** for instance, to take one example, consider.
- **Sequence in argument:** first — second — finally; at the same time; at this stage.
Vary the transition family across consecutive paragraphs. Strings of "Moreover... Moreover... Moreover..." are a smell.

## Common Pitfalls to Avoid
- Opening every paragraph with a transition word. Start with substance first; let the transition come when it earns its place.
- "Definition-then-topic" openings that never finish defining. If you define a term, do something with the definition.
- Over-hedged prose: "It may perhaps be the case that in some instances..." — pick a position or name the uncertainty explicitly.
- The false summary — repeating the paragraph's claim in different words as if that were analysis.
- Decorative adjectives ("critical", "essential", "fundamental") that do not distinguish anything. Delete them unless the ranking they imply is earned.
- Mechanical bullet lists where flowing prose would show your thinking better.

## Quality Checklist
Before closing the subsection, run a mental pass through these points:
1. Does every paragraph have a single controlling idea that is visible from the topic sentence?
2. Do the transitions between paragraphs signal specific logical relationships, not just sequence?
3. Does every source-backed claim carry a footnote (or, for non-academic projects, an inline attribution where needed)?
4. Is there at least one sentence of fresh analysis in the subsection — not just paraphrase of sources?
5. Is the register consistent with the project's stated tone, and consistent within the subsection?
6. Are there opportunities to tighten — sentences that say the same thing twice, adjectives that could be deleted, nominalisations that could become verbs?
7. Does the closing sentence do more than echo the opening sentence of the subsection?
A passing answer to each of these is the implicit minimum bar.`

// ==================== PRIVATE HELPERS ====================

function buildSystemPromptParts(
  projectType: ProjectType,
  styleProfile: Partial<StyleProfile> | null,
  citationFormat: CitationFormat,
  writingGuidelines: string | null
): SystemPromptPart[] {
  // --- Part 1: Core rules (cacheable, same across project) ---
  const coreLines: string[] = []

  if (projectType !== 'ACADEMIC') {
    const fictionLeaning = Boolean(
      styleProfile?.narrativePOV ||
        styleProfile?.genre ||
        styleProfile?.dialogueStyle ||
        styleProfile?.moodAtmosphere
    )

    coreLines.push(
      `You are an expert creative writer. Your task is to write well-crafted, engaging prose for the section described in the user prompt. Adapt your technique to the material — lean into narrative and sensory craft when the content is scenic, and into clear accessible exposition when the content explains.`
    )
    coreLines.push('')
    coreLines.push(`## Core Writing Rules`)
    if (fictionLeaning) {
      coreLines.push(`- Write vivid, engaging prose with strong sensory details.`)
      coreLines.push(`- Develop characters through actions, dialogue, and internal thoughts.`)
      coreLines.push(`- Build atmosphere and tension appropriate to the scene.`)
      coreLines.push(`- Show, don't tell — convey emotions through behavior, not labels.`)
      coreLines.push(`- Maintain consistent voice and point of view throughout.`)
      coreLines.push(`- Create natural, believable dialogue that reveals character.`)
    } else {
      coreLines.push(`- Write in an accessible, engaging tone — informative but not academic.`)
      coreLines.push(`- Use concrete examples and anecdotes to illustrate points.`)
      coreLines.push(`- Structure arguments clearly with smooth transitions.`)
      coreLines.push(`- Define technical terms naturally within context.`)
      coreLines.push(`- Maintain a conversational yet authoritative voice.`)
      coreLines.push(`- Use analogies and metaphors to explain complex ideas.`)
    }
    coreLines.push(`- Use varied sentence structures for rhythm and pacing.`)
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

  // Project-stable style + guidelines also go in the cache block — they don't
  // change between subsection writes within the same project, so a shared
  // cache prefix yields cache_read_input_tokens on every subsequent call.
  if (styleProfile) {
    const voiceNote =
      styleProfile.usesFirstPerson === false
        ? 'Avoid first person.'
        : styleProfile.usesFirstPerson === true
        ? 'First person is acceptable.'
        : ''
    const styleBullets: string[] = []
    if (voiceNote) styleBullets.push(`- ${voiceNote}`)
    if (styleProfile.tone) styleBullets.push(`- Tone: ${styleProfile.tone}.`)
    if (styleProfile.rhetoricalApproach) {
      styleBullets.push(`- Rhetorical approach: ${styleProfile.rhetoricalApproach}.`)
    }
    if (styleBullets.length > 0) {
      coreLines.push('')
      coreLines.push(`## Voice`)
      coreLines.push(...styleBullets)
    }
  }

  if (writingGuidelines) {
    coreLines.push('')
    coreLines.push(`## Project-Specific Writing Guidelines`)
    coreLines.push(writingGuidelines)
  }

  if (projectType === 'ACADEMIC') {
    coreLines.push('')
    coreLines.push(`## Citation Instructions`)
    coreLines.push(buildCitationInstructions(citationFormat))
  }

  if (styleProfile && Object.keys(styleProfile).length > 0) {
    const reminders = buildStyleReminders(styleProfile, projectType)
    if (reminders) {
      coreLines.push('')
      coreLines.push(`## Writing Style Reminders`)
      coreLines.push(reminders)
    }
  }

  return [{ text: coreLines.join('\n'), cache: true }]
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
  const base = `You are writing in the ${citationFormat} citation format.

PREFERRED: Use structured inline citation markers. Immediately after the closing punctuation of a sentence that makes a cited claim, insert one of:

  [cite:<bibId>]              — no page
  [cite:<bibId>,p=45]         — single page
  [cite:<bibId>,pp=45-48]     — page range
  [cite:<bibId>,v=2,p=45]     — volume + page (multi-volume works)

The <bibId> MUST come from the "Sources for This Subsection" list above (the string after \`bibId:\`). The export pipeline resolves these markers into the correct ${citationFormat} in-text style, footnote, or numbered reference automatically — you do NOT need to format the citation yourself.

FALLBACK (only if you absolutely cannot use [cite:...]): write [fn: <fully-formatted citation>] yourself. Do NOT use markdown (*italic*, **bold**) inside [fn:] markers; the export keeps that text verbatim.`

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
