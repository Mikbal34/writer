import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { streamChatWithTools, type ChatMessage, type SystemPromptPart, type ToolDefinition } from '@/lib/claude'
import { compressHistory, type ChatType } from '@/lib/conversation'
import { checkCredits, deductCredits } from '@/lib/credits'
import { getFormatSettings } from '@/lib/constants'
import { findOrCreateBibliography } from '@/lib/bibliography'
import { startJob, completeJob, failJob } from '@/lib/jobs'
import {
  validateRoadmapBatch,
  formatValidationFeedback,
  type ValidatedSubsection,
  type SynthesisMode as VMode,
  type SectionGoal as VGoal,
} from '@/lib/roadmap-validator'
import type { Prisma } from '@prisma/client'

type RouteContext = { params: Promise<{ id: string }> }

// ---------------------------------------------------------------------------
// Build a compact roadmap representation for the system prompt
// ---------------------------------------------------------------------------
type ChapterInput = {
  id: string
  number: number
  title: string
  sections: Array<{
    id: string
    sectionId: string
    title: string
    subsections: Array<{
      id: string
      subsectionId: string
      title: string
      sourceMappings?: Array<{
        id: string
        sourceType: string
        priority: string
        relevance: string | null
        howToUse: string | null
        whereToFind: string | null
        extractionGuide: string | null
        bibliography: {
          authorSurname: string
          authorName: string | null
          title: string
        }
      }>
    }>
  }>
}

function buildCompactRoadmap(chapters: ChapterInput[]) {
  return chapters.map((ch) => ({
    dbId: ch.id,
    displayId: ch.number,
    title: ch.title,
    sections: ch.sections.map((sec) => ({
      dbId: sec.id,
      displayId: sec.sectionId,
      title: sec.title,
      subsections: sec.subsections.map((sub) => ({
        dbId: sub.id,
        displayId: sub.subsectionId,
        title: sub.title,
        sources: (sub.sourceMappings ?? []).map((sm) => ({
          mappingDbId: sm.id,
          author: sm.bibliography.authorName
            ? `${sm.bibliography.authorSurname}, ${sm.bibliography.authorName}`
            : sm.bibliography.authorSurname,
          work: sm.bibliography.title,
          sourceType: sm.sourceType,
          priority: sm.priority,
          howToUse: sm.howToUse,
          whereToFind: sm.whereToFind,
          extractionGuide: sm.extractionGuide,
        })),
      })),
    })),
  }))
}

// ---------------------------------------------------------------------------
// Build a lightweight roadmap index (titles + IDs + counts only)
// ---------------------------------------------------------------------------
function buildRoadmapIndex(chapters: ChapterInput[]) {
  // Richer-than-counts index: includes section and subsection IDs + titles so
  // the AI can target any node (add_source, update_subsection, etc.) without
  // calling get_chapter_detail just to discover structure. Full-text fields
  // (description, whatToWrite, writingStrategy, source-usage fields) are still
  // only available via get_chapter_detail on demand.
  return chapters.map((ch) => ({
    dbId: ch.id,
    number: ch.number,
    title: ch.title,
    sections: ch.sections.map((sec) => ({
      dbId: sec.id,
      displayId: sec.sectionId,
      title: sec.title,
      subsections: sec.subsections.map((sub) => ({
        dbId: sub.id,
        displayId: sub.subsectionId,
        title: sub.title,
        sourceCount: sub.sourceMappings?.length ?? 0,
      })),
    })),
  }))
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
function buildTools(isCreationMode: boolean, needsSources: boolean): ToolDefinition[] {
  const tools: ToolDefinition[] = []

  if (needsSources) {
    tools.push({
      name: 'get_library_entries',
      description: 'Search the user\'s source library. Returns ONLY entries that already have an attached PDF — metadata-only entries are excluded because they cannot be grounded during writing. Use this to find existing sources before suggesting new ones. Call without query to list recent entries.',
      input_schema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Search term (author name or title keyword). Omit to list recent entries.' },
          limit: { type: 'number', description: 'Max results to return (default 20, max 50)' },
        },
        required: [],
      },
    })
  }

  if (!isCreationMode) {
    tools.push({
      name: 'get_chapter_detail',
      description: `Get full details of a specific chapter including all sections, subsections${needsSources ? ', and their source mappings' : ''}. Use the chapter dbId from the roadmap index.`,
      input_schema: {
        type: 'object' as const,
        properties: {
          chapterDbId: { type: 'string', description: 'Database ID of the chapter to retrieve' },
        },
        required: ['chapterDbId'],
      },
    })
  }

  return tools
}

// ---------------------------------------------------------------------------
// Tool call handlers
// ---------------------------------------------------------------------------
async function handleToolCallFn(
  toolName: string,
  toolInput: Record<string, unknown>,
  projectId: string,
  userId: string
): Promise<string> {
  if (toolName === 'get_chapter_detail') {
    const chapterDbId = toolInput.chapterDbId as string
    if (!chapterDbId) return JSON.stringify({ error: 'chapterDbId is required' })

    const chapter = await prisma.chapter.findFirst({
      where: { id: chapterDbId, projectId },
      include: {
        sections: {
          orderBy: { sortOrder: 'asc' },
          include: {
            subsections: {
              orderBy: { sortOrder: 'asc' },
              select: {
                id: true,
                subsectionId: true,
                title: true,
                description: true,
                keyPoints: true,
                writingStrategy: true,
                estimatedPages: true,
                sourceMappings: {
                  select: {
                    id: true,
                    sourceType: true,
                    priority: true,
                    relevance: true,
                    howToUse: true,
                    whereToFind: true,
                    extractionGuide: true,
                    bibliography: {
                      select: { authorSurname: true, authorName: true, title: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!chapter) return JSON.stringify({ error: 'Chapter not found' })

    // Return compact representation
    const result = {
      dbId: chapter.id,
      number: chapter.number,
      title: chapter.title,
      purpose: chapter.purpose,
      sections: chapter.sections.map((sec) => ({
        dbId: sec.id,
        displayId: sec.sectionId,
        title: sec.title,
        subsections: sec.subsections.map((sub) => ({
          dbId: sub.id,
          displayId: sub.subsectionId,
          title: sub.title,
          description: sub.description,
          keyPoints: sub.keyPoints,
          writingStrategy: sub.writingStrategy,
          estimatedPages: sub.estimatedPages,
          sources: sub.sourceMappings.map((sm) => ({
            mappingDbId: sm.id,
            author: sm.bibliography.authorName
              ? `${sm.bibliography.authorSurname}, ${sm.bibliography.authorName}`
              : sm.bibliography.authorSurname,
            work: sm.bibliography.title,
            sourceType: sm.sourceType,
            priority: sm.priority,
            relevance: sm.relevance,
            howToUse: sm.howToUse,
          })),
        })),
      })),
    }
    return JSON.stringify(result)
  }

  if (toolName === 'get_library_entries') {
    const query = toolInput.query as string | undefined
    const limit = Math.min((toolInput.limit as number) || 20, 50)

    // Only surface library entries that have usable PDF content somewhere
    // — either a standalone file, a stored filePath, or at least one cilt
    // ready on a multi-volume parent (parents themselves carry no PDF).
    // Metadata-only entries stay filtered out to avoid hallucinated cites.
    const where: Record<string, unknown> = {
      userId,
      OR: [
        { pdfStatus: 'ready' },
        { filePath: { not: null } },
        { volumes: { some: { pdfStatus: 'ready' } } },
      ],
    }
    if (query) {
      where.AND = [
        {
          OR: [
            { authorSurname: { contains: query, mode: 'insensitive' } },
            { authorName: { contains: query, mode: 'insensitive' } },
            { title: { contains: query, mode: 'insensitive' } },
          ],
        },
      ]
    }

    const entries = await prisma.libraryEntry.findMany({
      where,
      select: {
        id: true,
        authorSurname: true,
        authorName: true,
        title: true,
        year: true,
        entryType: true,
        abstract: true,
      },
      take: limit,
      orderBy: { updatedAt: 'desc' },
    })

    return JSON.stringify(entries)
  }

  return JSON.stringify({ error: `Unknown tool: ${toolName}` })
}

// ---------------------------------------------------------------------------
// System prompt — creation mode vs modification mode
// ---------------------------------------------------------------------------
export type SourceDensity = 'low' | 'normal' | 'high'

const SOURCE_DENSITY_INSTRUCTIONS: Record<SourceDensity, string> = {
  low: 'Add at most 1 source per subsection. Only use the most essential primary source for each subsection.',
  normal: 'Add 2-3 sources per subsection. Balance between primary and supporting sources.',
  high: 'Add 4-5 sources per subsection. Include both classical and modern sources, primary and supporting.',
}

function buildSystemPrompt(
  roadmapIndex: ReturnType<typeof buildRoadmapIndex> | null,
  project: { title: string; topic: string | null; purpose: string | null; audience: string | null; language: string | null; citationFormat: string | null; projectType: string; writingGuidelines?: unknown },
  conversationSummary?: string | null,
  sourceDensity?: SourceDensity
): SystemPromptPart[] {
  const needsSources = project.projectType === 'ACADEMIC'
  const isCreationMode = !roadmapIndex || roadmapIndex.length === 0

  // --- STATIC PART (cacheable — same across all requests) ---
  const sourceCommandDocs = needsSources ? `
- {"action": "update_source", "sourceMappingDbId": "...", "fields": {"howToUse?": "...", "whereToFind?": "...", "extractionGuide?": "...", "relevance?": "...", "priority?": "primary|supporting"}}
- {"action": "add_source", "subsectionDbId": "...", "source": {"author": "Surname, Name", "work": "Work Title", "sourceType": "classical|modern", "priority": "primary|supporting", "relevance": "...", "howToUse": "...", "whereToFind": "...", "extractionGuide": "..."}}
- {"action": "remove_source", "sourceMappingDbId": "..."}` : ''

  const sourceRules = needsSources ? `

SOURCE RULES:
- In add_source commands AND in nested "sources" arrays on subsections, ALL of the following fields MUST be filled, none can be left empty: relevance, howToUse, whereToFind, extractionGuide. If information is missing, write your best estimate.
- When adding sources, PREFER sources from the user's library first. Use get_library_entries tool to search the library before suggesting your own sources.
- CRITICAL: When you create new subsections (via add_subsection, or nested under add_section/add_chapter), include the sources INLINE on each subsection using the "sources" array. Do NOT defer source attachment to a separate follow-up turn — attach them in the SAME batch as their subsection. The user expects sources to appear together with the new structure, not after a second prompt.
- Use add_source as a separate command ONLY when adding sources to a subsection that already exists in the roadmap.` : ''

  const commandDocs = `
Available commands:
- {"action": "update_subsection", "subsectionDbId": "...", "fields": {"title?": "...", "description?": "...", "whatToWrite?": "...", "keyPoints?": [...], "writingStrategy?": "...", "estimatedPages?": N, "synthesisMode?": "SPECIFIC|THEMATIC|COMPARATIVE|SYNTHESIS", "sectionGoal?": "DEFINE|CONTEXT|COMPARE|SYNTHESIZE|LITERATURE_GAP|THESIS_CONCLUSION", "analysisDepth?": 0-10}}
- {"action": "add_subsection", "sectionDbId": "...", "subsection": {"subsectionId": "1.1.4", "title": "...", "description": "...", "whatToWrite": "...", "keyPoints": [...], "writingStrategy": "...", "estimatedPages": N, "synthesisMode": "SPECIFIC|THEMATIC|COMPARATIVE|SYNTHESIS", "sectionGoal": "DEFINE|CONTEXT|COMPARE|SYNTHESIZE|LITERATURE_GAP|THESIS_CONCLUSION", "analysisDepth": 0-10${needsSources ? ', "sources": [{"author": "Surname, Name", "work": "Title", "sourceType": "classical|modern", "priority": "primary|supporting", "relevance": "...", "howToUse": "...", "whereToFind": "...", "extractionGuide": "..."}]' : ''}}}
- {"action": "remove_subsection", "subsectionDbId": "..."}
- {"action": "update_section", "sectionDbId": "...", "fields": {"title?": "...", "keyConcepts?": [...]}}
- {"action": "add_section", "chapterDbId": "...", "section": {"sectionId": "1.3", "title": "...", "keyConcepts": [...]}, "subsections": [{"subsectionId": "1.3.1", "title": "...", "description": "...", "whatToWrite": "...", "keyPoints": [...], "writingStrategy": "...", "estimatedPages": N, "synthesisMode": "SPECIFIC|THEMATIC|COMPARATIVE|SYNTHESIS", "sectionGoal": "DEFINE|CONTEXT|COMPARE|SYNTHESIZE|LITERATURE_GAP|THESIS_CONCLUSION", "analysisDepth": 0-10}]}
- {"action": "remove_section", "sectionDbId": "..."}
- {"action": "update_chapter", "chapterDbId": "...", "fields": {"title?": "...", "purpose?": "...", "estimatedPages?": N}}
- {"action": "add_chapter", "chapter": {"number": N, "title": "...", "purpose": "...", "estimatedPages": N}, "tempId": "__temp_ch_1", "sections": [{"sectionId": "1.1", "title": "...", "keyConcepts": [...], "tempId": "__temp_sec_1_1", "subsections": [{"subsectionId": "1.1.1", "title": "...", "description": "...", "whatToWrite": "...", "keyPoints": [...], "writingStrategy": "...", "estimatedPages": N, "synthesisMode": "SPECIFIC|THEMATIC|COMPARATIVE|SYNTHESIS", "sectionGoal": "DEFINE|CONTEXT|COMPARE|SYNTHESIZE|LITERATURE_GAP|THESIS_CONCLUSION", "analysisDepth": 0-10${needsSources ? ', "sources": [{"author": "Surname, Name", "work": "Title", "sourceType": "classical|modern", "priority": "primary|supporting", "relevance": "...", "howToUse": "...", "whereToFind": "...", "extractionGuide": "..."}]' : ''}}]}]}
- {"action": "remove_chapter", "chapterDbId": "..."}
- {"action": "move_section", "sectionDbId": "...", "targetChapterDbId": "..."}${sourceCommandDocs}
- {"action": "update_project", "fields": {"topic?": "...", "purpose?": "...", "audience?": "...", "styleProfile?": {"narrativePOV?": "...", "genre?": "...", "dialogueStyle?": "...", "pacing?": "...", "moodAtmosphere?": "...", "targetAgeGroup?": "...", "narrativeStyle?": "...", "tone?": "..."}}}${sourceRules}`

  const toolsSection = needsSources
    ? `TOOLS:
- Use get_library_entries to search the user's source library before adding sources. Always check the library first.
${isCreationMode ? '' : '- Use get_chapter_detail to retrieve full details of a specific chapter when you need to modify it. Only fetch chapters you need.\n'}
TOOL DISCIPLINE (CRITICAL — read carefully):
- When you tell the user you will search the library ("Şimdi tarayacağım", "Kütüphaneye bakıyorum", "Let me search", "I'll look up", etc.), you MUST emit the get_library_entries tool_use call IN THE SAME RESPONSE — not in the next one.
- NEVER promise a search in plain text and then end the turn without the actual tool call. That breaks the user's flow and forces them to ask again.
- If the user says "tara", "ara", "bul", "search", "find", "aratır mısın", "kütüphanede ne var" — call get_library_entries IMMEDIATELY in your next response. Do NOT prefix with prose like "Tabii, hemen tarıyorum…" — go straight to the tool call.
- If your previous reply said you would search but the actual search did not happen, your next reply MUST start with the tool call before any text.
`
    : isCreationMode ? '' : `TOOLS:
- Use get_chapter_detail to retrieve full details of a specific chapter when you need to modify it. Only fetch chapters you need.\n`

  const commonRules = `RULES:
1. First, briefly and clearly explain what you will do (in the project's language).
2. Then add commands in the following format:
<roadmap_commands>
[...commands JSON array...]
</roadmap_commands>

BATCH CREATION:
- When creating new chapters, give the add_chapter command a tempId (e.g., "__temp_ch_1").
- Sections and subsections within add_chapter are automatically created.
- You can reference tempIds in subsequent commands.

${commandDocs}

IMPORTANT:
- If the user is just asking questions or requesting information, do not add commands.
- If multiple changes are requested, combine them all in a single commands array.
${needsSources ? '- When adding sources, use author format "Surname, Name".\n' : ''}
${toolsSection}
FORMAT RULES:
- NEVER use emoji. Never. Not in headings, text, or lists.
- Use markdown formatting for lists, tables, and structural information (tables, headings, bullet points).${needsSources ? '\n- Use markdown tables for source lists and comparisons (| heading | heading | format).' : ''}

STRUCTURE DESIGN PRINCIPLES
When proposing or modifying a roadmap, apply these principles:
1. Progressive disclosure: early chapters establish context, vocabulary, and baseline facts; later chapters build on them with deeper analysis. A reader should be able to understand chapter N if they have read chapters 1..N-1 attentively.
2. Balance of scope: each chapter should feel like a meaningful unit of thought, not a grab-bag. If a chapter has one section with four subsections and another with one subsection, ask whether it is really one chapter or two.
3. Sectioning rhythm: sections inside a chapter are waypoints of the chapter's argument. Aim for 2-4 sections per chapter; fewer tends to undersell the chapter, more tends to fragment it.
4. Subsection granularity: a subsection is the smallest writable unit. 2-5 pages each is the right ballpark. Subsections shorter than 2 pages usually should be merged; longer than 6 pages usually should be split.
5. Titles carry weight: a chapter or section title is a promise to the reader about what they will get there. Prefer titles that name a claim or question over titles that name only a topic.
6. Avoid mirror-image sections: if two sections could reasonably be swapped without weakening the chapter, one of them is probably redundant.
7. First and last positions are privileged. A chapter's first section sets its frame; its last section should deliver the chapter's payoff. Neither is a filler slot.

ARGUMENT FLOW CHECKS
Before finalising a roadmap (or a significant modification), ask yourself:
- What is the book's single controlling question or thesis? A reader who read only the titles of chapters, sections, and subsections should be able to reconstruct it.
- Are there chapters whose only role seems to be "background"? If so, can their content be folded into the chapters that actually use it?
- Does the middle sag? Long books often have a strong opening, a strong conclusion, and an uncertain middle. Structurally, the middle should earn its pages.
- Is any chapter doing two fundamentally different jobs? Consider splitting.
- Is any chapter only a list of loosely related items? Consider restructuring around an argument, not an inventory.

WRITING HAND-OFF
Each subsection you describe will later become a writing-session prompt. Give the writer enough to act on:
- whatToWrite: a concrete brief ("Analyse the 1923-1930 archival letters, focusing on shifts in diplomatic tone"), not a label ("The letters").
- keyPoints: 2-5 bullets naming the ideas the subsection must cover. Each bullet should be concrete enough that a writer cannot reasonably miss its target.
- writingStrategy: one or two sentences on tone, structure, or pacing for this specific subsection — what makes THIS subsection different from its neighbours.
- estimatedPages: your best page-count estimate in whole pages.
- synthesisMode + sectionGoal + analysisDepth: pair them honestly per subsection. synthesisMode = epistemik YAPI (nasıl), sectionGoal = bölüm içindeki GÖREV (neden), depth = yorum yoğunluğu. Bu üç eksen ayrıdır; karıştırma. sectionGoal one of: DEFINE / CONTEXT / COMPARE / SYNTHESIZE / LITERATURE_GAP / THESIS_CONCLUSION. THESIS_CONCLUSION goal'ı tez başına 0-2 subsection — her chapter sonu THESIS_CONCLUSION DEĞİL.

METADATA DISCIPLINE (KRİTİK — automated quality gate aktiftir):
- DEFINE ve depth=3 SADECE şema default'larıdır; OTOMATİK seçim değil. Her subsection için ayrı düşün.
- Bir roadmap'te TÜM subsection'ların sectionGoal=DEFINE olması → roadmap REDDEDİLİR (kaydedilmez).
- Bir roadmap'te TÜM subsection'ların analysisDepth=3 olması → roadmap REDDEDİLİR.
- synthesisMode=COMPARATIVE subsection'larının goal'u GENELLİKLE COMPARE'dir (sentez ise SYNTHESIZE). 5+ COMPARATIVE varsa en az biri COMPARE olmazsa REDDEDİLİR.
- 20+ subsection üretildiyse en az 1 THESIS_CONCLUSION beklenir (tezin payoff'u). 3+ THEMATIC varsa en az biri SYNTHESIZE veya LITERATURE_GAP olmalıdır.
- BÖLÜM SONU subsection'larını özellikle incele: çoğunlukla SYNTHESIZE veya THESIS_CONCLUSION goal'u içerir; analysisDepth 7-9 aralığındadır. Mekanik DEFINE/3 atama burada kesin yanlıştır.
- Karşılaştırma bölümleri → COMPARE (depth 5-6). Literatür değerlendirmesi → LITERATURE_GAP (depth 5-7). Tarihsel/bağlamsal bölümler → CONTEXT (depth 3-5). Tek metin / tek kavram → DEFINE (depth 1-3). Tezin nihai sonucu → THESIS_CONCLUSION (depth 8-10).
   • SPECIFIC (depth 1-3): 1-3 sources, single-text / single-author analysis, introductions, definitions, narrow technical points. Default for routine subsections. Low depth tells the writer "stay descriptive, no interpretive padding".
   • THEMATIC (depth 5-7): the subsection must MAP A FIELD across 4+ sources — positions, common ground, divergences, possible historical shift. Use for "X tradition", "Y literature", "approaches to Z".
   • COMPARATIVE (depth 4-6): an explicit X-vs-Y framing (two thinkers, two schools, two positions). Title or description contains language like "fark", "vs", "karşılaştırma", "ayrılık", "difference", "compare". Triggers a downstream agent that builds the contrast skeleton (sideA / sideB / convergences / difference / significance / implications) before writing.
   • SYNTHESIS (depth 7-10): a chapter or part closing subsection whose PRIMARY job is implication, not summary — "Sentez", "Sonuç", "Synthesis", "Katkı" style. Description should be compressed; body is built around cause / consequence / literature_impact moves. Reserve for subsections that are explicitly meta-argument, not every section closer.
When you are not given enough information to fill a field responsibly, write your best estimate and flag the assumption; do not leave the field empty.

COMMON ROADMAP PITFALLS
- A chapter with five subsections all the same size is often a chapter that has not been thought through — real arguments have peaks and valleys.
- Subsections whose titles all follow the same template ("The X of Y") usually indicate a table of contents, not a structured argument.
- A section whose subsections repeat its own title in slight paraphrase ("Introduction to X" under a section called "X") adds no structure.
- Long chains of "Historical background" → "Theoretical background" → "Conceptual framework" before the argument actually starts: cut ruthlessly, push the background into the chapters that use it.
- Do not create a subsection that exists only because the section felt too short — either grow the section's real content or merge the section into its neighbour.
- Page estimates that match perfectly to the page target suggest the numbers were fit to the target, not derived from the content. Let your estimates reflect what each subsection actually demands.

COMMAND HYGIENE
When you issue a batch of commands:
- Group related commands. Do not split a single conceptual change across conversation turns when it can be issued as one batch.
- Prefer add_chapter with nested sections and subsections over a sequence of separate add_chapter/add_section/add_subsection commands when creating new content from scratch.
- Preserve stable IDs (the real dbIds) for anything you are modifying. Do not replace a modifiable unit with a fresh one when an update_* command would do the job.
- When adding a subsection to a section that already has subsections, position it by choosing its subsectionId ("1.2.3" — coming after "1.2.2") with care; the order matters for the flow of the section.`

  const projectTypeLabel = project.projectType === 'ACADEMIC' ? 'academic book' : 'creative writing project'

  // Pull the project-style overrides (set during the wizard's Step 4)
  // out of writingGuidelines and summarise so the AI honours them while
  // designing the roadmap — e.g. won't draft 1st-person subsection
  // descriptions when the project has usesFirstPerson=false.
  const overrides = (() => {
    const g = project.writingGuidelines
    if (!g || typeof g !== 'object') return null
    const o = (g as Record<string, unknown>).styleOverrides
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : null
  })()
  const styleOverridesBlock = overrides
    ? `\n\nPROJECT STYLE OVERRIDES (already set by the user — respect these when describing/drafting subsections):\n${Object.entries(overrides)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join('\n')}`
    : ''

  let staticPart: string
  if (isCreationMode) {
    const creativeWritingPrefsStep = project.projectType !== 'ACADEMIC' ? `
3. BEFORE creating the roadmap, ask the user about their writing preferences. Start by finding out whether this is fiction, non-fiction, or a blend (e.g., memoir, creative non-fiction), then ask the follow-up questions that fit:
   If the work is fiction-leaning:
   - **Point of view (POV):** First person, third person limited, third person omniscient, or second person?
   - **Genre:** Romance, sci-fi, mystery, thriller, fantasy, historical fiction, horror, literary fiction, etc.
   - **Dialogue density:** Sparse (mostly narrative), moderate, or dialogue-heavy?
   - **Pacing:** Slow/atmospheric, moderate, or fast/action-driven?
   - **Mood/Atmosphere:** e.g., dark, lighthearted, tense, melancholic, romantic, mysterious.
   - **Target audience:** Children, young adult, or adult.
   If the work is non-fiction-leaning:
   - **Tone:** Serious/professional, conversational, inspirational, or humorous?
   - **Target reader:** Expert, general reader, or student?
   - **Writing approach:** How-to/practical, anecdotal/story-driven, case studies, data-driven, or mixed?
   - **Pacing:** Detailed/thorough or concise/to-the-point?
   Always ask:
   - **Narrative style:** Descriptive, minimalist, stream of consciousness, epistolary, anecdotal, etc.
   Ask these naturally in conversation — you do not need to ask all at once. If the user says "you decide" or gives a short answer, make reasonable choices based on the project's concept.
4. After gathering preferences, SAVE them using this update_project command with the styleProfile field. Fill the fields that apply and leave others out. Examples:
   Fiction: {"action": "update_project", "fields": {"styleProfile": {"narrativePOV": "third_person_limited", "genre": "romantic thriller", "dialogueStyle": "dialogue_heavy", "pacing": "fast", "moodAtmosphere": "tense and mysterious", "targetAgeGroup": "adult", "narrativeStyle": "descriptive"}}}
   Non-fiction: {"action": "update_project", "fields": {"styleProfile": {"tone": "conversational", "targetAgeGroup": "adult", "pacing": "moderate", "narrativeStyle": "anecdotal"}}}
5. Then create a comprehensive roadmap (4-6 chapters, 2-3 sections per chapter, 2-3 subsections per section). Do NOT add any academic sources.
6. Use update_project to set topic/purpose/audience if not already specified.` : ''

    const sourceSteps = needsSources ? `
3. After gathering enough information about the book's content and structure, BEFORE creating the roadmap, ask the user about sources:
   - Do they have specific sources (books, articles, authors) they plan to use?
   - What are their source preferences? (classical vs modern, primary vs secondary)
   - How many sources per subsection do they want? (e.g., 2-3 sources)
   - Do they prefer a specific academic tradition or school of thought?
4. After gathering source information (or if the user says "you decide"), use get_library_entries to check available sources, then create a comprehensive roadmap (4-6 chapters, 2-3 sections per chapter, 2-3 subsections per section).
5. When creating the roadmap, attach sources to EVERY subsection via the inline "sources" array on each subsection (inside add_chapter / add_section / add_subsection). Do NOT defer to a follow-up turn. Use sources from the user's library first; suggest your own only for genuine gaps.

SOURCE DENSITY: ${SOURCE_DENSITY_INSTRUCTIONS[sourceDensity ?? 'normal']}
6. Use update_project command to update project information.` : creativeWritingPrefsStep || `
3. After gathering enough information, create a comprehensive roadmap (4-6 chapters, 2-3 sections per chapter, 2-3 subsections per section). Do NOT add any sources.
4. Use update_project command to update project information.`

    staticPart = `You are a ${projectTypeLabel} planning assistant. The user has created a new project with no roadmap yet.${styleOverridesBlock}

Your tasks:
1. If topic, purpose, or target audience are not specified, ask the user questions about the ${projectTypeLabel}.
2. Ask the user about desired length (total pages). This is important for distributing content proportionally.
${sourceSteps}

PAGE ESTIMATION RULES:
- 1 page = approximately ${getFormatSettings(project.citationFormat).wordsPerPage} words.
- Distribute the user's target page count proportionally across chapters and subsections.
- Each subsection should typically be 2-5 pages.
- The total of all subsection estimatedPages should roughly equal the user's target page count.
- If the user wants 300 pages and you create 60 subsections, each subsection should average ~5 pages.

${commonRules}`
  } else {
    staticPart = `You are a ${projectTypeLabel} planning assistant. The user wants to make changes to the existing roadmap.${styleOverridesBlock}

Your task: Understand the user's request, use get_chapter_detail to fetch the relevant chapter(s), then generate the commands to apply the changes.

${commonRules}

- Use real IDs from the existing roadmap for dbId fields.
- displayId fields use "1.1", "1.1.1" format.
- Do NOT guess chapter contents — always use get_chapter_detail to see current state before modifying.`
  }

  // --- DYNAMIC PART (changes per request) ---
  const summarySection = conversationSummary
    ? `\n\n## Previous Conversation Summary\n${conversationSummary}`
    : ''

  const languageLine = `Respond in the language specified by the project settings (Language: ${project.language ?? 'en'}). If the language is "tr", respond in Turkish. If "en", respond in English. Match the project language.`

  const parts: SystemPromptPart[] = [
    { text: staticPart, cache: true },
  ]

  if (isCreationMode) {
    parts.push({
      text: `${languageLine}

Project information:
- Title: ${project.title}
- Topic: ${project.topic ?? 'Not specified'}
- Purpose: ${project.purpose ?? 'Not specified'}
- Target Audience: ${project.audience ?? 'Not specified'}
- Language: ${project.language ?? 'en'}${summarySection}`,
    })
  } else {
    // Split the edit-mode dynamic section into two blocks:
    //  1. roadmap index — cacheable because it only changes when the roadmap is
    //     modified; stays identical across read-only Q&A turns, so subsequent
    //     questions about the same roadmap benefit from cache_read.
    //  2. language + summary — small and per-request, intentionally uncached.
    parts.push({
      text: `Roadmap index (use get_chapter_detail for full details):\n${JSON.stringify(roadmapIndex)}`,
      cache: true,
    })
    parts.push({
      text: `${languageLine}${summarySection}`,
    })
  }

  return parts
}

// ---------------------------------------------------------------------------
// Parse <roadmap_commands> from the AI response
// ---------------------------------------------------------------------------
// Batch'teki TÜM yeni subsection metadata'sını topla. Yeni eklenen
// (add_subsection / add_section.subsections / add_chapter.sections[].
// subsections) ve update_subsection.fields kapsam içinde. Eksik mode/
// goal/depth field'ları default'a düşer — bu, validator'un yakalamak
// istediği davranıştır.
function extractSubsectionsFromCommands(
  commands: Array<Record<string, unknown>>,
): ValidatedSubsection[] {
  const out: ValidatedSubsection[] = []
  const allowedModes: VMode[] = ['SPECIFIC', 'THEMATIC', 'COMPARATIVE', 'SYNTHESIS']
  const allowedGoals: VGoal[] = [
    'DEFINE',
    'CONTEXT',
    'COMPARE',
    'SYNTHESIZE',
    'LITERATURE_GAP',
    'THESIS_CONCLUSION',
  ]
  const push = (sub: Record<string, unknown>) => {
    if (!sub) return
    const rawMode = sub.synthesisMode
    const mode: VMode = allowedModes.includes(rawMode as VMode)
      ? (rawMode as VMode)
      : 'SPECIFIC'
    const rawGoal = sub.sectionGoal
    const goal: VGoal = allowedGoals.includes(rawGoal as VGoal)
      ? (rawGoal as VGoal)
      : 'DEFINE'
    const rawDepth = sub.analysisDepth
    const depth =
      typeof rawDepth === 'number'
        ? Math.min(10, Math.max(0, Math.round(rawDepth)))
        : 3
    out.push({
      subsectionId: typeof sub.subsectionId === 'string' ? sub.subsectionId : '',
      title: typeof sub.title === 'string' ? sub.title : '',
      synthesisMode: mode,
      sectionGoal: goal,
      analysisDepth: depth,
    })
  }
  for (const cmd of commands) {
    switch (cmd.action) {
      case 'add_subsection': {
        const sub = cmd.subsection as Record<string, unknown> | undefined
        if (sub) push(sub)
        break
      }
      case 'add_section': {
        const subs = cmd.subsections as Array<Record<string, unknown>> | undefined
        if (Array.isArray(subs)) subs.forEach(push)
        const sec = cmd.section as { subsections?: Array<Record<string, unknown>> } | undefined
        if (Array.isArray(sec?.subsections)) sec.subsections.forEach(push)
        break
      }
      case 'add_chapter': {
        const sections = cmd.sections as Array<{ subsections?: Array<Record<string, unknown>> }> | undefined
        if (Array.isArray(sections)) {
          for (const sec of sections) {
            if (Array.isArray(sec?.subsections)) sec.subsections.forEach(push)
          }
        }
        const chap = cmd.chapter as { sections?: Array<{ subsections?: Array<Record<string, unknown>> }> } | undefined
        if (Array.isArray(chap?.sections)) {
          for (const sec of chap.sections) {
            if (Array.isArray(sec?.subsections)) sec.subsections.forEach(push)
          }
        }
        break
      }
      case 'update_subsection': {
        const fields = cmd.fields as Record<string, unknown> | undefined
        // Update sadece tek subsection'ı etkiliyor — onun bütüncül
        // metadata'sını bilemediğimiz için "fields"ı subsection gibi
        // muamele edip validator'a sun (subId boş).
        if (fields) push(fields)
        break
      }
    }
  }
  return out
}

function parseCommands(text: string): Array<Record<string, unknown>> {
  const match = text.match(/<roadmap_commands>\s*([\s\S]*?)\s*<\/roadmap_commands>/)
  if (!match) return []
  try {
    const parsed = JSON.parse(match[1])
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Apply commands to the database
// ---------------------------------------------------------------------------
// Create SourceMappings for a freshly-created subsection from a nested
// `sources` array. Called from add_subsection / add_section / add_chapter
// so the AI can issue the whole roadmap (with sources) in one batch instead
// of needing a follow-up turn to attach sources.
async function createNestedSources(
  tx: Prisma.TransactionClient,
  projectId: string,
  userId: string | undefined,
  subsectionDbId: string,
  rawSources: unknown
): Promise<void> {
  if (!Array.isArray(rawSources) || rawSources.length === 0) return
  for (const raw of rawSources) {
    const src = raw as Record<string, unknown>
    if (!src || typeof src !== 'object') continue
    const author = src.author as string | undefined
    const work = src.work as string | undefined
    if (!author || !work) continue
    const biblio = await findOrCreateBibliography(tx, projectId, author, work, undefined, userId)
    await tx.sourceMapping.upsert({
      where: {
        subsectionId_bibliographyId: {
          subsectionId: subsectionDbId,
          bibliographyId: biblio.id,
        },
      },
      create: {
        subsectionId: subsectionDbId,
        bibliographyId: biblio.id,
        sourceType: (src.sourceType as string) ?? 'modern',
        priority: (src.priority as string) ?? 'supporting',
        relevance: (src.relevance as string) ?? null,
        howToUse: (src.howToUse as string) ?? null,
        whereToFind: (src.whereToFind as string) ?? null,
        extractionGuide: (src.extractionGuide as string) ?? null,
      },
      update: {
        sourceType: (src.sourceType as string) ?? 'modern',
        priority: (src.priority as string) ?? 'supporting',
        relevance: (src.relevance as string) ?? null,
        howToUse: (src.howToUse as string) ?? null,
        whereToFind: (src.whereToFind as string) ?? null,
        extractionGuide: (src.extractionGuide as string) ?? null,
      },
    })
  }
}

async function applyCommands(
  tx: Prisma.TransactionClient,
  projectId: string,
  commands: Array<Record<string, unknown>>,
  userId?: string
) {
  const tempIdMap = new Map<string, string>()

  function resolveId(id: string): string {
    if (id && id.startsWith('__temp_')) {
      return tempIdMap.get(id) ?? id
    }
    return id
  }

  for (const cmd of commands) {
    const action = cmd.action as string

    switch (action) {
      case 'update_subsection': {
        const fields = cmd.fields as Record<string, unknown> | undefined
        if (!fields || !cmd.subsectionDbId) break
        await tx.subsection.update({
          where: { id: resolveId(cmd.subsectionDbId as string) },
          data: {
            ...(fields.title !== undefined && { title: fields.title as string }),
            ...(fields.description !== undefined && { description: fields.description as string }),
            ...(fields.whatToWrite !== undefined && { whatToWrite: fields.whatToWrite as string }),
            ...(fields.keyPoints !== undefined && { keyPoints: fields.keyPoints as string[] }),
            ...(fields.writingStrategy !== undefined && { writingStrategy: fields.writingStrategy as string }),
            ...(fields.estimatedPages !== undefined && { estimatedPages: fields.estimatedPages as number }),
            ...(typeof fields.synthesisMode === 'string' &&
              (fields.synthesisMode === 'THEMATIC' ||
                fields.synthesisMode === 'COMPARATIVE' ||
                fields.synthesisMode === 'SPECIFIC' ||
                fields.synthesisMode === 'SYNTHESIS') && {
                synthesisMode: fields.synthesisMode,
              }),
            ...(typeof fields.sectionGoal === 'string' &&
              (fields.sectionGoal === 'DEFINE' ||
                fields.sectionGoal === 'CONTEXT' ||
                fields.sectionGoal === 'COMPARE' ||
                fields.sectionGoal === 'SYNTHESIZE' ||
                fields.sectionGoal === 'LITERATURE_GAP' ||
                fields.sectionGoal === 'THESIS_CONCLUSION') && {
                sectionGoal: fields.sectionGoal,
              }),
            ...(typeof fields.analysisDepth === 'number' && {
              analysisDepth: Math.min(10, Math.max(0, Math.round(fields.analysisDepth as number))),
            }),
          },
        })
        break
      }

      case 'add_subsection': {
        const sectionDbId = resolveId(cmd.sectionDbId as string)
        const sub = cmd.subsection as Record<string, unknown>
        if (!sectionDbId || !sub) break
        // Auto-generate subsectionId from parent section's display id +
        // next available trailing suffix. Ignoring LLM-supplied subsectionId
        // prevents (sectionId, subsectionId) P2002 collisions.
        const parentSection = await tx.section.findUnique({
          where: { id: sectionDbId },
          select: { sectionId: true },
        })
        const siblings = await tx.subsection.findMany({
          where: { sectionId: sectionDbId },
          select: { subsectionId: true, sortOrder: true },
        })
        const maxSuffix = siblings.reduce((m, s) => {
          const match = s.subsectionId.match(/\.(\d+)$/)
          return match ? Math.max(m, parseInt(match[1], 10)) : m
        }, 0)
        const nextOrder = siblings.reduce((m, s) => Math.max(m, s.sortOrder), -1) + 1
        const newSubId = parentSection
          ? `${parentSection.sectionId}.${maxSuffix + 1}`
          : `${maxSuffix + 1}`
        const subSm = sub.synthesisMode
        const subsection = await tx.subsection.create({
          data: {
            sectionId: sectionDbId,
            subsectionId: newSubId,
            title: (sub.title as string) ?? '',
            description: (sub.description as string) ?? null,
            whatToWrite: (sub.whatToWrite as string) ?? null,
            keyPoints: (sub.keyPoints as string[]) ?? [],
            writingStrategy: (sub.writingStrategy as string) ?? null,
            estimatedPages: (sub.estimatedPages as number) ?? null,
            synthesisMode:
              subSm === 'THEMATIC' || subSm === 'COMPARATIVE' ? subSm : 'SPECIFIC',
            sortOrder: nextOrder,
            status: 'pending',
          },
        })
        if (cmd.tempId) tempIdMap.set(cmd.tempId as string, subsection.id)
        await createNestedSources(tx, projectId, userId, subsection.id, sub.sources)
        break
      }

      case 'remove_subsection': {
        if (!cmd.subsectionDbId) break
        await tx.subsection.delete({ where: { id: resolveId(cmd.subsectionDbId as string) } })
        break
      }

      case 'update_section': {
        const fields = cmd.fields as Record<string, unknown> | undefined
        if (!fields || !cmd.sectionDbId) break
        await tx.section.update({
          where: { id: resolveId(cmd.sectionDbId as string) },
          data: {
            ...(fields.title !== undefined && { title: fields.title as string }),
            ...(fields.keyConcepts !== undefined && { keyConcepts: fields.keyConcepts as string[] }),
          },
        })
        break
      }

      case 'add_section': {
        const chapterDbId = resolveId(cmd.chapterDbId as string)
        const sec = cmd.section as Record<string, unknown>
        if (!chapterDbId || !sec) break
        // Auto-generate sectionId from parent chapter's number + next free
        // suffix. Ignoring LLM-supplied sectionId prevents
        // (chapterId, sectionId) P2002 collisions.
        const parentChapter = await tx.chapter.findUnique({
          where: { id: chapterDbId },
          select: { number: true },
        })
        const siblings = await tx.section.findMany({
          where: { chapterId: chapterDbId },
          select: { sectionId: true, sortOrder: true },
        })
        const maxSecSuffix = siblings.reduce((m, s) => {
          const match = s.sectionId.match(/\.(\d+)$/)
          return match ? Math.max(m, parseInt(match[1], 10)) : m
        }, 0)
        const nextOrder = siblings.reduce((m, s) => Math.max(m, s.sortOrder), -1) + 1
        const newSectionId = parentChapter
          ? `${parentChapter.number}.${maxSecSuffix + 1}`
          : `${maxSecSuffix + 1}`
        const section = await tx.section.create({
          data: {
            chapterId: chapterDbId,
            sectionId: newSectionId,
            title: (sec.title as string) ?? '',
            keyConcepts: (sec.keyConcepts as string[]) ?? [],
            sortOrder: nextOrder,
          },
        })
        if (cmd.tempId) tempIdMap.set(cmd.tempId as string, section.id)
        if (sec.tempId) tempIdMap.set(sec.tempId as string, section.id)

        // Auto-create subsections if provided inline. New section has no
        // existing children, so subsection ids start at .1 and increment.
        const subsections = (cmd.subsections ?? sec.subsections) as Array<Record<string, unknown>> | undefined
        if (subsections && Array.isArray(subsections)) {
          for (const [subIdx, sub] of subsections.entries()) {
            const sm = sub.synthesisMode
            const subsec = await tx.subsection.create({
              data: {
                sectionId: section.id,
                subsectionId: `${newSectionId}.${subIdx + 1}`,
                title: (sub.title as string) ?? '',
                description: (sub.description as string) ?? null,
                whatToWrite: (sub.whatToWrite as string) ?? null,
                keyPoints: (sub.keyPoints as string[]) ?? [],
                writingStrategy: (sub.writingStrategy as string) ?? null,
                estimatedPages: (sub.estimatedPages as number) ?? null,
                synthesisMode:
                sm === 'THEMATIC' || sm === 'COMPARATIVE' || sm === 'SYNTHESIS'
                  ? sm
                  : 'SPECIFIC',
              ...((sub.sectionGoal === 'CONTEXT' ||
                sub.sectionGoal === 'COMPARE' ||
                sub.sectionGoal === 'SYNTHESIZE' ||
                sub.sectionGoal === 'LITERATURE_GAP' ||
                sub.sectionGoal === 'THESIS_CONCLUSION' ||
                sub.sectionGoal === 'DEFINE') && {
                sectionGoal: sub.sectionGoal,
              }),
              ...(typeof sub.analysisDepth === 'number' && {
                analysisDepth: Math.min(10, Math.max(0, Math.round(sub.analysisDepth as number))),
              }),
                sortOrder: subIdx,
                status: 'pending',
              },
            })
            if (sub.tempId) tempIdMap.set(sub.tempId as string, subsec.id)
            await createNestedSources(tx, projectId, userId, subsec.id, sub.sources)
          }
        }
        break
      }

      case 'remove_section': {
        if (!cmd.sectionDbId) break
        await tx.section.delete({ where: { id: resolveId(cmd.sectionDbId as string) } })
        break
      }

      case 'update_chapter': {
        const fields = cmd.fields as Record<string, unknown> | undefined
        if (!fields || !cmd.chapterDbId) break
        await tx.chapter.update({
          where: { id: resolveId(cmd.chapterDbId as string) },
          data: {
            ...(fields.title !== undefined && { title: fields.title as string }),
            ...(fields.purpose !== undefined && { purpose: fields.purpose as string }),
            ...(fields.estimatedPages !== undefined && { estimatedPages: fields.estimatedPages as number }),
          },
        })
        break
      }

      case 'add_chapter': {
        const ch = cmd.chapter as Record<string, unknown>
        if (!ch) break
        // Compute number from current max — ignore LLM-supplied number,
        // since it routinely collides with an existing chapter and trips the
        // (projectId, number) unique constraint (P2002).
        const existing = await tx.chapter.findMany({
          where: { projectId },
          orderBy: { number: 'desc' },
          take: 1,
        })
        const nextNumber = existing.length > 0 ? existing[0].number + 1 : 1
        const sortAgg = await tx.chapter.aggregate({
          where: { projectId },
          _max: { sortOrder: true },
        })
        const nextOrder = (sortAgg._max.sortOrder ?? -1) + 1
        const chapter = await tx.chapter.create({
          data: {
            projectId,
            number: nextNumber,
            title: (ch.title as string) ?? '',
            purpose: (ch.purpose as string) ?? null,
            estimatedPages: (ch.estimatedPages as number) ?? null,
            sortOrder: nextOrder,
          },
        })
        if (cmd.tempId) tempIdMap.set(cmd.tempId as string, chapter.id)

        // Auto-create sections + subsections if provided inline. Chapter
        // is brand new, so we generate display ids deterministically from
        // chapter.number to keep the format consistent (1.1, 1.1.1, …).
        const sections = (cmd.sections ?? ch.sections) as Array<Record<string, unknown>> | undefined
        if (sections && Array.isArray(sections)) {
          for (const [secIdx, sec] of sections.entries()) {
            const generatedSectionId = `${chapter.number}.${secIdx + 1}`
            const section = await tx.section.create({
              data: {
                chapterId: chapter.id,
                sectionId: generatedSectionId,
                title: (sec.title as string) ?? '',
                keyConcepts: (sec.keyConcepts as string[]) ?? [],
                sortOrder: secIdx,
              },
            })
            if (sec.tempId) tempIdMap.set(sec.tempId as string, section.id)

            const subsections = sec.subsections as Array<Record<string, unknown>> | undefined
            if (subsections && Array.isArray(subsections)) {
              for (const [subIdx, sub] of subsections.entries()) {
                const sm = sub.synthesisMode
                const subsec = await tx.subsection.create({
                  data: {
                    sectionId: section.id,
                    subsectionId: `${generatedSectionId}.${subIdx + 1}`,
                    title: (sub.title as string) ?? '',
                    description: (sub.description as string) ?? null,
                    whatToWrite: (sub.whatToWrite as string) ?? null,
                    keyPoints: (sub.keyPoints as string[]) ?? [],
                    writingStrategy: (sub.writingStrategy as string) ?? null,
                    estimatedPages: (sub.estimatedPages as number) ?? null,
                    synthesisMode:
                      sm === 'THEMATIC' || sm === 'COMPARATIVE' ? sm : 'SPECIFIC',
                    sortOrder: subIdx,
                    status: 'pending',
                  },
                })
                if (sub.tempId) tempIdMap.set(sub.tempId as string, subsec.id)
                await createNestedSources(tx, projectId, userId, subsec.id, sub.sources)
              }
            }
          }
        }
        break
      }

      case 'remove_chapter': {
        if (!cmd.chapterDbId) break
        await tx.chapter.delete({ where: { id: resolveId(cmd.chapterDbId as string) } })
        break
      }

      case 'move_section': {
        const sectionDbId = resolveId(cmd.sectionDbId as string)
        const targetChapterDbId = resolveId(cmd.targetChapterDbId as string)
        if (!sectionDbId || !targetChapterDbId) break
        const existing = await tx.section.findMany({
          where: { chapterId: targetChapterDbId },
          orderBy: { sortOrder: 'desc' },
          take: 1,
        })
        const nextOrder = existing.length > 0 ? existing[0].sortOrder + 1 : 0
        await tx.section.update({
          where: { id: sectionDbId },
          data: { chapterId: targetChapterDbId, sortOrder: nextOrder },
        })
        break
      }

      case 'update_source': {
        const fields = cmd.fields as Record<string, unknown> | undefined
        if (!fields || !cmd.sourceMappingDbId) break
        await tx.sourceMapping.update({
          where: { id: cmd.sourceMappingDbId as string },
          data: {
            ...(fields.howToUse !== undefined && { howToUse: fields.howToUse as string }),
            ...(fields.whereToFind !== undefined && { whereToFind: fields.whereToFind as string }),
            ...(fields.extractionGuide !== undefined && { extractionGuide: fields.extractionGuide as string }),
            ...(fields.relevance !== undefined && { relevance: fields.relevance as string }),
            ...(fields.priority !== undefined && { priority: fields.priority as string }),
          },
        })
        break
      }

      case 'add_source': {
        const src = cmd.source as Record<string, unknown> | undefined
        let subsectionDbId = resolveId(cmd.subsectionDbId as string)
        if (!src || !subsectionDbId) break

        // Fallback: if subsectionDbId looks like a displayId (e.g. "1.1.1"), resolve it
        if (!subsectionDbId.startsWith('c') || subsectionDbId.includes('.')) {
          const found = await tx.subsection.findFirst({
            where: {
              subsectionId: subsectionDbId,
              section: { chapter: { projectId } },
            },
            select: { id: true },
          })
          if (found) subsectionDbId = found.id
          else break // subsection not found, skip
        }

        const biblio = await findOrCreateBibliography(
          tx,
          projectId,
          src.author as string,
          src.work as string,
          undefined,
          userId
        )
        await tx.sourceMapping.upsert({
          where: {
            subsectionId_bibliographyId: {
              subsectionId: subsectionDbId,
              bibliographyId: biblio.id,
            },
          },
          create: {
            subsectionId: subsectionDbId,
            bibliographyId: biblio.id,
            sourceType: (src.sourceType as string) ?? 'modern',
            priority: (src.priority as string) ?? 'supporting',
            relevance: (src.relevance as string) ?? null,
            howToUse: (src.howToUse as string) ?? null,
            whereToFind: (src.whereToFind as string) ?? null,
            extractionGuide: (src.extractionGuide as string) ?? null,
          },
          update: {
            sourceType: (src.sourceType as string) ?? 'modern',
            priority: (src.priority as string) ?? 'supporting',
            relevance: (src.relevance as string) ?? null,
            howToUse: (src.howToUse as string) ?? null,
            whereToFind: (src.whereToFind as string) ?? null,
            extractionGuide: (src.extractionGuide as string) ?? null,
          },
        })
        break
      }

      case 'remove_source': {
        if (!cmd.sourceMappingDbId) break
        // Get bibliography id before deleting the mapping
        const mapping = await tx.sourceMapping.findUnique({
          where: { id: cmd.sourceMappingDbId as string },
          select: { bibliographyId: true },
        })
        await tx.sourceMapping.delete({ where: { id: cmd.sourceMappingDbId as string } })

        // If no other mappings reference this bibliography, delete it too
        if (mapping) {
          const remaining = await tx.sourceMapping.count({
            where: { bibliographyId: mapping.bibliographyId },
          })
          if (remaining === 0) {
            await tx.bibliography.delete({ where: { id: mapping.bibliographyId } })
          }
        }
        break
      }

      case 'update_project': {
        const fields = cmd.fields as Record<string, unknown> | undefined
        if (!fields) break

        // If styleProfile is provided, merge with existing profile
        let styleProfileUpdate: object | undefined
        if (fields.styleProfile !== undefined) {
          const existing = await tx.project.findUnique({
            where: { id: projectId },
            select: { styleProfile: true },
          })
          const existingProfile = (existing?.styleProfile as Record<string, unknown>) ?? {}
          styleProfileUpdate = { ...existingProfile, ...(fields.styleProfile as Record<string, unknown>) }
        }

        await tx.project.update({
          where: { id: projectId },
          data: {
            ...(fields.topic !== undefined && { topic: fields.topic as string }),
            ...(fields.purpose !== undefined && { purpose: fields.purpose as string }),
            ...(fields.audience !== undefined && { audience: fields.audience as string }),
            ...(styleProfileUpdate !== undefined && { styleProfile: styleProfileUpdate }),
          },
        })
        break
      }
    }
  }
}

// ---------------------------------------------------------------------------
// POST /api/projects/[id]/roadmap/chat
// SSE streaming endpoint for AI chat about roadmap
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id: projectId } = await ctx.params

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: session.user.id },
      select: { id: true, title: true, topic: true, purpose: true, audience: true, language: true, citationFormat: true, projectType: true, writingGuidelines: true },
    })

    if (!project) {
      return new Response(JSON.stringify({ error: 'Project not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json()
    const messages = (body.messages ?? []) as ChatMessage[]
    const sessionId = (body.sessionId ?? '') as string
    const sourceDensity = (body.sourceDensity ?? 'normal') as SourceDensity
    const userContent = messages.length > 0 ? messages[messages.length - 1].content : ''

    // Fetch current roadmap structure with source data
    const chapters = await prisma.chapter.findMany({
      where: { projectId },
      orderBy: { sortOrder: 'asc' },
      include: {
        sections: {
          orderBy: { sortOrder: 'asc' },
          include: {
            subsections: {
              orderBy: { sortOrder: 'asc' },
              select: {
                id: true,
                subsectionId: true,
                title: true,
                sourceMappings: {
                  select: {
                    id: true,
                    sourceType: true,
                    priority: true,
                    relevance: true,
                    howToUse: true,
                    whereToFind: true,
                    extractionGuide: true,
                    bibliography: {
                      select: { authorSurname: true, authorName: true, title: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })

    const isCreationMode = chapters.length === 0
    const needsSources = project.projectType === 'ACADEMIC'
    const roadmapIndex = isCreationMode ? null : buildRoadmapIndex(chapters)
    const tools = buildTools(isCreationMode, needsSources)

    // Trim long assistant messages before compression to reduce token usage
    const trimmedMessages = (messages as Array<{ role: 'user' | 'assistant'; content: string }>).map((m) => ({
      role: m.role,
      content: m.role === 'assistant' && m.content.length > 800
        ? m.content.slice(0, 800) + '\n[...truncated]'
        : m.content,
    }))

    // Compress conversation history — token-based with structured roadmap prompt.
    // Roadmap index is carried by buildSystemPrompt as its own cacheable block,
    // so we don't re-inject it into the compressed summary (was a duplicate).
    const { messages: compressedMessages, summary: conversationSummary } =
      await compressHistory(trimmedMessages, {
        chatType: 'roadmap' as ChatType,
        maxTokens: 40000,
        keepRecent: 4,
      })

    const systemPrompt = buildSystemPrompt(roadmapIndex, project, conversationSummary, sourceDensity)

    // Credit check — use density-aware cost for creation mode
    const creditOperation = isCreationMode
      ? (needsSources ? `roadmap_chat_create_${sourceDensity}` : 'roadmap_chat_create_no_sources')
      : 'roadmap_chat'
    const credits = await checkCredits(session.user.id, creditOperation)
    if (!credits.allowed) {
      return new Response(
        JSON.stringify({ error: 'Insufficient credits', balance: credits.balance, cost: credits.estimatedCost }),
        { status: 402, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Surface in the navbar bell.
    const jobId = await startJob({
      userId: session.user.id,
      type: 'roadmap',
      title: project.title,
      projectId,
      resultUrl: `/projects/${projectId}/roadmap`,
      message: isCreationMode ? 'Roadmap oluşturuluyor…' : 'Roadmap güncelleniyor…',
    })

    // Buffered events the SSE poller forwards to the client. Each entry is
    // already-encoded SSE payload ("data: ...\n\n").
    const events: string[] = []
    let workDone = false
    let workError: string | null = null

    // Signal-based coordination so chunks reach the client immediately
    // instead of waiting for the next poll tick.
    let wakeResolve: (() => void) | null = null
    const wake = () => {
      const r = wakeResolve
      wakeResolve = null
      if (r) r()
    }
    const waitForUpdate = (maxMs: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          wakeResolve = null
          resolve()
        }, maxMs)
        wakeResolve = () => {
          clearTimeout(timer)
          resolve()
        }
      })

    const enqueueEvent = (payload: unknown) => {
      events.push(`data: ${JSON.stringify(payload)}\n\n`)
      wake()
    }

    // Tool-choice nudge: if the user's last turn clearly asks for a
    // library search (or AI promised one in its previous turn), force
    // Sonnet to call get_library_entries on the first iteration.
    // Otherwise leave tool_choice unset ("auto") so the model decides.
    const libSearchPattern =
      /\b(tara|tarayın|tarayın\s*mı|tarama|aratır|aratırsın|aratayım|ara|bul|search|find|look\s*up|kütüphan|library)\b/i
    const lastUserMessage = [...compressedMessages]
      .reverse()
      .find((m) => m.role === 'user')
    const lastAssistantMessage = [...compressedMessages]
      .reverse()
      .find((m) => m.role === 'assistant')
    const promisedSearch =
      typeof lastAssistantMessage?.content === 'string' &&
      /(şimdi\s*tarayacağım|kütüphane(ni)?z(?:i)?\s*tar|let\s*me\s*search|i'?ll\s*search)/i.test(
        lastAssistantMessage.content,
      )
    const userAsksSearch =
      typeof lastUserMessage?.content === 'string' &&
      libSearchPattern.test(lastUserMessage.content)
    const hasLibraryTool = tools.some((t) => t.name === 'get_library_entries')
    const initialToolChoice: { type: 'tool'; name: string } | undefined =
      hasLibraryTool && (userAsksSearch || promisedSearch)
        ? { type: 'tool', name: 'get_library_entries' }
        : undefined

    // Detached LLM worker — survives client disconnect.
    const workPromise = (async () => {
      try {
        const result = await streamChatWithTools(
          compressedMessages,
          systemPrompt,
          tools,
          (toolName, toolInput) => handleToolCallFn(toolName, toolInput, projectId, session.user.id),
          (chunk) => enqueueEvent({ chunk }),
          (toolName) => enqueueEvent({ step: 'thinking', tool: toolName }),
          { cacheTools: true, ...(initialToolChoice && { initialToolChoice }) }
        )

        const { newBalance, creditsUsed } = await deductCredits(
          session.user.id,
          'roadmap_chat',
          result.inputTokens,
          result.outputTokens,
          'sonnet',
          { projectId },
          { read: result.cacheReadTokens, creation: result.cacheCreationTokens }
        )

        const commands = parseCommands(result.fullText)
        let commandsApplied = false

        if (commands.length > 0) {
          // Quality gate — extract all subsection metadata from the batch
          // and run the V4 validator. Reject blocks the transaction and
          // surfaces actionable feedback so the user sees why nothing
          // was saved.
          const batchSubs = extractSubsectionsFromCommands(commands)
          const validation = validateRoadmapBatch(batchSubs)

          if (!validation.ok) {
            const feedback = formatValidationFeedback(validation)
            console.warn(
              `[roadmap/chat] Validation REJECTED. subs=${batchSubs.length} rejects=${validation.rejects.length} warns=${validation.warnings.length}`,
            )
            enqueueEvent({
              chunk: `\n\n[Roadmap kalite kontrolünden geçemedi — kaydedilmedi.]\n\n${feedback}`,
            })
            enqueueEvent({ step: 'applied' })
          } else {
            if (validation.warnings.length > 0) {
              console.warn(
                `[roadmap/chat] Validation warnings: ${validation.warnings.join(' | ')}`,
              )
              enqueueEvent({
                chunk: `\n\n[Uyarı] ${validation.warnings.join(' ')}`,
              })
            }
            enqueueEvent({ step: 'applying' })
            try {
              await prisma.$transaction(async (tx) => {
                await applyCommands(tx, projectId, commands, session.user.id)
              })
              commandsApplied = true
              // Bust the App Router cache for every page under /projects/[id]
              // (write, preview, design, sources, …) so they re-fetch the
              // freshly mutated chapter/section/subsection rows on next nav.
              revalidatePath(`/projects/${projectId}`, 'layout')
            } catch (cmdErr) {
              console.error('[roadmap/chat] Failed to apply commands:', cmdErr)
              enqueueEvent({
                chunk: '\n\n[An error occurred while applying commands. Please try again.]',
              })
            }
            enqueueEvent({ step: 'applied' })
          }
        }

        enqueueEvent({
          done: true,
          commandsApplied,
          commandCount: commands.length,
          creditsUsed,
          balance: newBalance,
        })

        const strippedContent = result.fullText
          .replace(/<roadmap_commands>[\s\S]*?<\/roadmap_commands>/g, '')
          .replace(/<roadmap_commands>[\s\S]*$/g, '')
          .replace(/<roadmap_c[^>]*$/g, '')
          .trim()
        try {
          await prisma.roadmapChatMessage.createMany({
            data: [
              { projectId, sessionId, role: 'user', content: userContent },
              {
                projectId,
                sessionId,
                role: 'assistant',
                content: strippedContent,
                commands:
                  commands.length > 0 ? (commands as unknown as Prisma.InputJsonValue) : undefined,
                commandsApplied,
              },
            ],
          })
        } catch (saveErr) {
          console.error('[roadmap/chat] Failed to save chat messages:', saveErr)
        }

        events.push('data: [DONE]\n\n')

        await completeJob(jobId, {
          message: commandsApplied
            ? `${commands.length} değişiklik uygulandı`
            : isCreationMode
            ? 'Roadmap oluşturuldu'
            : 'Güncelleme hazır',
        })
      } catch (err) {
        workError = err instanceof Error ? err.message : String(err)
        console.error('[roadmap/chat] Stream error:', err)
        enqueueEvent({ error: 'Stream failed' })
        await failJob(jobId, workError).catch(() => {})
      } finally {
        workDone = true
        wake()
      }
    })()
    workPromise.catch((err) => console.error('[roadmap/chat] detached worker:', err))

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        let sentCount = 0
        let connected = true
        const tryEnqueue = (payload: string): boolean => {
          if (!connected) return false
          try {
            controller.enqueue(encoder.encode(payload))
            return true
          } catch {
            connected = false
            return false
          }
        }

        while (connected) {
          while (sentCount < events.length) {
            if (!tryEnqueue(events[sentCount])) break
            sentCount++
          }
          if (workDone) break
          await waitForUpdate(500)
        }

        if (connected) {
          // Drain any final events written after the loop exit.
          while (sentCount < events.length) {
            if (!tryEnqueue(events[sentCount])) break
            sentCount++
          }
          try {
            controller.close()
          } catch {
            // already closed
          }
        }
        // If !connected, work continues; the bell will announce completion.
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    console.error('[POST /api/projects/[id]/roadmap/chat]', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
