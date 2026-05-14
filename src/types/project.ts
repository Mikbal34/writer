import type {
  Project,
  Chapter,
  Section,
  Subsection,
  SourceMapping,
  Bibliography,
  CitationFormat,
  ProjectType,
} from '@prisma/client'

// ==================== STYLE PROFILE ====================
//
// Style data is split into two layers:
//
//   1. WritingTwinProfile — the user's *personal* writing habits that
//      don't change across projects (sentence rhythm, paragraph reflex,
//      pet transitions, rhetorical leaning). Lives on UserStyleProfile,
//      reused across every project the author opens.
//
//   2. ProjectStyleOverrides — per-project rules that override the Twin
//      at writing time (tone, formality, 1st person, voice, terminology
//      density, paragraph length, block quotes, citation density).
//      A thesis and a popular essay share one Twin but their overrides
//      diverge sharply. Stored in Project.writingGuidelines.styleOverrides.
//
// Atıf placement (inline / parenthetical / endnote) used to live in the
// Twin but is now fully governed by Project.citationFormat (APA / ISNAD /
// MLA / Chicago) so we don't carry a redundant field.

export interface WritingTwinProfile {
  /** Average sentence length preference */
  sentenceLength?: 'short' | 'medium' | 'long' | 'varied'
  /** How paragraphs are structured */
  paragraphStructure?: 'topic-sentence-first' | 'inductive' | 'deductive' | 'mixed'
  /** Common transition patterns the author uses (e.g., ['furthermore', 'however', 'in contrast']) */
  transitionPatterns?: string[]
  /** Rhetorical approach */
  rhetoricalApproach?: 'argumentative' | 'descriptive' | 'analytical' | 'comparative'
  /** Additional style notes captured from sample analysis */
  additionalNotes?: string
}

export interface ProjectStyleOverrides {
  /** Overall tone for this project */
  tone?: 'formal' | 'semi-formal' | 'conversational'
  /** Overall formality level 1–10 */
  formality?: number
  /** Whether the AI should write in first person */
  usesFirstPerson?: boolean
  /** Grammatical voice preference */
  voicePreference?: 'active' | 'passive' | 'mixed'
  /** Density of domain-specific terminology */
  terminologyDensity?: 'low' | 'medium' | 'high'
  /** How many citations per paragraph the AI should target */
  citationDensity?: 'light' | 'normal' | 'dense'
  /** Typical paragraph length */
  paragraphLength?: 'short' | 'medium' | 'long'
  /** Whether the AI should set off long quotations as block quotes */
  usesBlockQuotes?: boolean
  /** Free-text notes the user wants the AI to honour for this project */
  notes?: string
}

/**
 * Deprecated unified shape. Older code reads this; new code should
 * pick `WritingTwinProfile` or `ProjectStyleOverrides` explicitly.
 * Kept as a wide union so persisted JSON (UserStyleProfile.profile /
 * Project.styleProfile) still parses without migration.
 */
export interface StyleProfile extends WritingTwinProfile, ProjectStyleOverrides {
  // ---- Narrative / Creative Writing Fields (CREATIVE) ----

  /** Narrative point of view */
  narrativePOV?: 'first_person' | 'second_person' | 'third_person_limited' | 'third_person_omniscient'
  /** Genre (e.g. "romance", "sci-fi", "mystery", "thriller", "fantasy", "historical") */
  genre?: string
  /** Dialogue density */
  dialogueStyle?: 'sparse' | 'moderate' | 'dialogue_heavy'
  /** Story pacing */
  pacing?: 'slow' | 'moderate' | 'fast'
  /** Mood / atmosphere description */
  moodAtmosphere?: string
  /** Target age group */
  targetAgeGroup?: 'children' | 'young_adult' | 'adult'
  /** Narrative style (e.g. "descriptive", "minimalist", "stream_of_consciousness", "epistolary") */
  narrativeStyle?: string
}

// ==================== PRISMA RELATION TYPES ====================

export type SubsectionFull = Subsection & {
  sourceMappings: (SourceMapping & {
    bibliography: Bibliography
  })[]
}

export type SectionWithSubsections = Section & {
  subsections: SubsectionFull[]
}

export type ChapterWithSections = Chapter & {
  sections: SectionWithSubsections[]
}

export type ProjectWithRelations = Project & {
  chapters: ChapterWithSections[]
}

// ==================== BOOK STRUCTURE (AI OUTPUT) ====================

export interface BookSubsection {
  id: string           // e.g. "1.1.1"
  title: string
  description: string
  whatToWrite: string
  keyPoints: string[]
  writingStrategy: string
  estimatedPages: number
  sources: {
    classical: BookSourceRef[]
    modern: BookSourceRef[]
  }
}

export interface BookSourceRef {
  author: string
  work: string
  relevance: string
  priority: 'primary' | 'supporting'
  howToUse?: string
  whereToFind?: string
  extractionGuide?: string
}

export interface BookSection {
  id: string           // e.g. "1.1"
  title: string
  keyConcepts: string[]
  subsections: BookSubsection[]
}

export interface BookChapter {
  id: number
  title: string
  purpose: string
  estimatedPages: number
  sections: BookSection[]
}

export interface BookStructure {
  title: string
  chapters: BookChapter[]
}

// ==================== WRITING CONTEXT ====================

export interface PositionInfo {
  /** This subsection is the first in its section */
  sectionFirst: boolean
  /** This subsection is the last in its section */
  sectionLast: boolean
  /** This subsection is the first in its chapter */
  chapterFirst: boolean
  /** This subsection is the last in its chapter */
  chapterLast: boolean
}

export interface PrevNextSubsection {
  subsectionId: string   // e.g. "1.1.1"
  title: string
  sectionTitle: string
  chapterTitle: string
}

export interface SourceMappingInfo {
  bibliographyId: string
  authorSurname: string
  authorName: string | null
  title: string
  shortTitle: string | null
  entryType: string
  year: string | null
  publisher: string | null
  publishPlace: string | null
  relevance: string | null
  priority: string
  howToUse: string | null
  whereToFind: string | null
  extractionGuide: string | null
}

export interface WritingContext {
  /** The subsection being written */
  subsection: SubsectionFull
  /** The section containing this subsection */
  section: SectionWithSubsections
  /** The chapter containing this section */
  chapter: ChapterWithSections
  /** Position of this subsection within the hierarchy */
  position: PositionInfo
  /** Previous subsection in the book (null if first) */
  prevSubsection: PrevNextSubsection | null
  /** Next subsection in the book (null if last) */
  nextSubsection: PrevNextSubsection | null
  /** Source mappings with full bibliography details */
  sources: SourceMappingInfo[]
  /** Citation format for the project */
  citationFormat: CitationFormat
  /** Project type: ACADEMIC or CREATIVE */
  projectType: ProjectType
  /** Style profile (may be partial) — Writing Twin (stable personal habits) */
  styleProfile: Partial<StyleProfile> | null
  /** Project-scoped style overrides — hard rules that win over the Twin */
  styleOverrides: Partial<ProjectStyleOverrides> | null
  /** Any other free-form writingGuidelines (non-styleOverrides namespace) */
  writingGuidelines: string | null
}
