import type {
  Project,
  Chapter,
  Section,
  Subsection,
  SourceMapping,
  Bibliography,
  CitationFormat,
} from '@prisma/client'

// ==================== STYLE PROFILE ====================

export interface StyleProfile {
  /** Average sentence length preference: 'short' | 'medium' | 'long' | 'varied' */
  sentenceLength: 'short' | 'medium' | 'long' | 'varied'
  /** Overall tone: 'formal' | 'semi-formal' | 'conversational' */
  tone: 'formal' | 'semi-formal' | 'conversational'
  /** Density of domain-specific terminology: 'low' | 'medium' | 'high' */
  terminologyDensity: 'low' | 'medium' | 'high'
  /** Grammatical voice preference: 'active' | 'passive' | 'mixed' */
  voicePreference: 'active' | 'passive' | 'mixed'
  /** How paragraphs are structured: 'topic-sentence-first' | 'inductive' | 'deductive' | 'mixed' */
  paragraphStructure: 'topic-sentence-first' | 'inductive' | 'deductive' | 'mixed'
  /** Common transition patterns the author uses (e.g., ['furthermore', 'however', 'in contrast']) */
  transitionPatterns: string[]
  /** Overall formality level 1–10 */
  formality: number
  /** Whether the author uses first person */
  usesFirstPerson: boolean
  /** How the author handles citations in prose */
  citationStyle: 'inline-footnote' | 'parenthetical' | 'endnote-heavy' | 'light'
  /** Typical paragraph length: 'short' (1-3 sentences) | 'medium' (4-6) | 'long' (7+) */
  paragraphLength: 'short' | 'medium' | 'long'
  /** Whether the author uses block quotes for long citations */
  usesBlockQuotes: boolean
  /** Rhetorical approach: 'argumentative' | 'descriptive' | 'analytical' | 'comparative' */
  rhetoricalApproach: 'argumentative' | 'descriptive' | 'analytical' | 'comparative'
  /** Additional style notes captured from sample analysis */
  additionalNotes?: string
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
  /** Style profile (may be partial during onboarding) */
  styleProfile: Partial<StyleProfile> | null
  /** Any additional writing guidelines */
  writingGuidelines: string | null
}
