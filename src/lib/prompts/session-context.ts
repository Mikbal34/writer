/**
 * Session Context Builder
 *
 * Ported from: tez/scripts/oturum_baslat.py
 *
 * Determines the structural position of a subsection (is it first/last in
 * its section or chapter?), finds the adjacent subsections for transition
 * guidance, and assembles the full WritingContext.
 */

import { prisma } from '@/lib/db'
import type {
  WritingContext,
  PositionInfo,
  PrevNextSubsection,
  SourceMappingInfo,
  SubsectionFull,
  SectionWithSubsections,
  ChapterWithSections,
} from '@/types/project'
import type { StyleProfile } from '@/types/project'
import type { CitationFormat } from '@prisma/client'

// ==================== MAIN EXPORTED FUNCTION ====================

/**
 * Builds the complete WritingContext for a subsection.
 * Performs all necessary DB queries in one call.
 *
 * Usage:
 *   const ctx = await buildSessionContext(subsectionId)
 *   const { systemPrompt, userPrompt } = getWritingPrompt(ctx)
 */
export async function buildSessionContext(
  subsectionId: string
): Promise<WritingContext> {
  // --- Load the target subsection with source mappings ---
  const subsection = await prisma.subsection.findUniqueOrThrow({
    where: { id: subsectionId },
    include: {
      sourceMappings: {
        include: { bibliography: true },
        orderBy: { priority: 'asc' },
      },
    },
  })

  // --- Load the section ---
  const section = await prisma.section.findUniqueOrThrow({
    where: { id: subsection.sectionId },
    include: {
      subsections: {
        orderBy: { sortOrder: 'asc' },
        include: {
          sourceMappings: {
            include: { bibliography: true },
          },
        },
      },
    },
  })

  // --- Load the chapter ---
  const chapter = await prisma.chapter.findUniqueOrThrow({
    where: { id: section.chapterId },
    include: {
      sections: {
        orderBy: { sortOrder: 'asc' },
        include: {
          subsections: {
            orderBy: { sortOrder: 'asc' },
            include: {
              sourceMappings: {
                include: { bibliography: true },
              },
            },
          },
        },
      },
    },
  })

  // --- Load the project for style/citation settings ---
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: chapter.projectId },
  })

  // --- Build position info ---
  const position = determinePosition(subsection, section, chapter)

  // --- Get all subsections in the project (ordered) for prev/next ---
  const allSubsections = await getAllSubsectionsOrdered(chapter.projectId)
  const { prev, next } = getPrevNext(allSubsections, subsection.id)

  // --- Build source mapping info ---
  const sources = buildSourceMappings(subsection as SubsectionFull)

  return {
    subsection: subsection as SubsectionFull,
    section: section as SectionWithSubsections,
    chapter: chapter as ChapterWithSections,
    position,
    prevSubsection: prev,
    nextSubsection: next,
    sources,
    citationFormat: project.citationFormat as CitationFormat,
    projectType: project.projectType,
    styleProfile: project.styleProfile
      ? (project.styleProfile as Partial<StyleProfile>)
      : null,
    writingGuidelines: project.writingGuidelines
      ? JSON.stringify(project.writingGuidelines)
      : null,
  }
}

// ==================== POSITION DETERMINATION ====================

/**
 * Determines the structural position of a subsection within its section and chapter.
 *
 * Usage:
 *   const pos = determinePosition(subsection, section, chapter)
 *   // { sectionFirst: true, sectionLast: false, chapterFirst: true, chapterLast: false }
 */
export function determinePosition(
  subsection: { id: string },
  section: { subsections: Array<{ id: string }> },
  chapter: {
    sections: Array<{
      subsections: Array<{ id: string }>
    }>
  }
): PositionInfo {
  const sectionSubIds = section.subsections.map((s) => s.id)
  const sectionFirst = sectionSubIds[0] === subsection.id
  const sectionLast = sectionSubIds[sectionSubIds.length - 1] === subsection.id

  const firstSectionSubIds = chapter.sections[0]?.subsections.map((s) => s.id) ?? []
  const lastSection = chapter.sections[chapter.sections.length - 1]
  const lastSectionSubIds = lastSection?.subsections.map((s) => s.id) ?? []

  const chapterFirst =
    firstSectionSubIds.length > 0 && firstSectionSubIds[0] === subsection.id
  const chapterLast =
    lastSectionSubIds.length > 0 &&
    lastSectionSubIds[lastSectionSubIds.length - 1] === subsection.id

  return { sectionFirst, sectionLast, chapterFirst, chapterLast }
}

// ==================== PREV / NEXT ====================

interface SubsectionListItem {
  id: string
  subsectionId: string
  title: string
  sectionTitle: string
  chapterTitle: string
}

async function getAllSubsectionsOrdered(
  projectId: string
): Promise<SubsectionListItem[]> {
  const chapters = await prisma.chapter.findMany({
    where: { projectId },
    orderBy: { sortOrder: 'asc' },
    include: {
      sections: {
        orderBy: { sortOrder: 'asc' },
        include: {
          subsections: {
            orderBy: { sortOrder: 'asc' },
          },
        },
      },
    },
  })

  const result: SubsectionListItem[] = []
  for (const ch of chapters) {
    for (const sec of ch.sections) {
      for (const sub of sec.subsections) {
        result.push({
          id: sub.id,
          subsectionId: sub.subsectionId,
          title: sub.title,
          sectionTitle: sec.title,
          chapterTitle: ch.title,
        })
      }
    }
  }
  return result
}

function getPrevNext(
  all: SubsectionListItem[],
  currentId: string
): { prev: PrevNextSubsection | null; next: PrevNextSubsection | null } {
  const idx = all.findIndex((s) => s.id === currentId)
  if (idx === -1) return { prev: null, next: null }

  const toPrevNext = (item: SubsectionListItem): PrevNextSubsection => ({
    subsectionId: item.subsectionId,
    title: item.title,
    sectionTitle: item.sectionTitle,
    chapterTitle: item.chapterTitle,
  })

  return {
    prev: idx > 0 ? toPrevNext(all[idx - 1]) : null,
    next: idx < all.length - 1 ? toPrevNext(all[idx + 1]) : null,
  }
}

// ==================== SOURCE MAPPINGS ====================

function buildSourceMappings(subsection: SubsectionFull): SourceMappingInfo[] {
  return subsection.sourceMappings.map((mapping) => {
    const bib = mapping.bibliography
    return {
      bibliographyId: bib.id,
      authorSurname: bib.authorSurname,
      authorName: bib.authorName,
      title: bib.title,
      shortTitle: bib.shortTitle,
      entryType: bib.entryType,
      year: bib.year,
      publisher: bib.publisher,
      publishPlace: bib.publishPlace,
      relevance: mapping.relevance,
      priority: mapping.priority,
      howToUse: mapping.howToUse,
      whereToFind: mapping.whereToFind,
      extractionGuide: mapping.extractionGuide,
    }
  })
}
