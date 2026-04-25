/**
 * Legacy column adapter.
 *
 * The old export pipeline reads flat academic columns directly off the
 * Project row (`author`, `institution`, `abstractTr`, etc.). Until the
 * export builders move to the discriminated AcademicMeta shape, we
 * flatten the new structure back into those columns on every save so
 * exports keep working.
 *
 * The flattening is lossy — per-author affiliations in IEEE, structured
 * abstract sections in Vancouver/AMA, key points, etc. are projected
 * down to the subset the old schema supports. The authoritative copy
 * lives in `ProjectAcademicMeta.meta`; this function produces the
 * shadow copy used by legacy code paths.
 */

import type { AcademicMeta as StructuralAcademicMeta } from '@/lib/export/docx-structural'
import type { AcademicMeta } from './schemas'

export interface LegacyProjectColumns {
  author: string | null
  institution: string | null
  department: string | null
  advisor: string | null
  abstractTr: string | null
  abstractEn: string | null
  keywordsTr: string[]
  keywordsEn: string[]
  acknowledgments: string | null
  dedication: string | null
}

/**
 * Joins a Vancouver / AMA structured abstract into a single paragraph
 * for the flat abstract column. Labelled sections are separated by
 * blank lines so the prose remains readable even in the legacy export.
 */
function joinStructured(sections: Array<[string, string | null]>): string | null {
  const parts = sections
    .filter(([, body]) => body && body.trim().length > 0)
    .map(([label, body]) => `${label}. ${(body ?? '').trim()}`)
  return parts.length > 0 ? parts.join('\n\n') : null
}

export function projectColumnsFromMeta(
  meta: AcademicMeta
): LegacyProjectColumns {
  switch (meta.format) {
    case 'APA':
    case 'MLA':
    case 'CHICAGO':
    case 'TURABIAN':
    case 'HARVARD': {
      const advisor =
        meta.format === 'TURABIAN'
          ? meta.advisor
          : meta.format === 'HARVARD'
          ? meta.supervisor
          : meta.format === 'CHICAGO' && meta.variant === 'student'
          ? [meta.instructorTitle, meta.instructorName].filter(Boolean).join(' ') || null
          : meta.format === 'APA' && meta.variant === 'student'
          ? [meta.instructorTitle, meta.instructorName].filter(Boolean).join(' ') || null
          : meta.format === 'MLA'
          ? [meta.instructorTitle, meta.instructorName].filter(Boolean).join(' ') || null
          : null
      return {
        author: meta.author || null,
        institution: meta.format === 'MLA' ? null : meta.institution,
        department: meta.format === 'MLA' || meta.format === 'HARVARD'
          ? null
          : meta.department,
        advisor,
        abstractTr: null,
        abstractEn: meta.abstract,
        keywordsTr: [],
        keywordsEn: meta.keywords,
        acknowledgments: meta.acknowledgments,
        dedication: meta.dedication,
      }
    }

    case 'IEEE': {
      const primary = meta.authors[0]
      const authorNames = meta.authors
        .map((a) => a.name.trim())
        .filter(Boolean)
        .join(', ') || null
      return {
        author: authorNames,
        institution: primary?.institution ?? null,
        department: primary?.department ?? null,
        advisor: null,
        abstractTr: null,
        abstractEn: meta.abstract,
        keywordsTr: [],
        keywordsEn: meta.indexTerms,
        acknowledgments: meta.acknowledgments,
        dedication: null,
      }
    }

    case 'VANCOUVER': {
      const primary = meta.authors[0]
      const authorNames = meta.authors
        .map((a) => a.name.trim())
        .filter(Boolean)
        .join(', ') || null
      const abstract = joinStructured([
        ['Background', meta.structuredAbstract.background],
        ['Methods', meta.structuredAbstract.methods],
        ['Results', meta.structuredAbstract.results],
        ['Conclusions', meta.structuredAbstract.conclusions],
      ])
      return {
        author: authorNames,
        institution: primary?.institution ?? null,
        department: primary?.department ?? null,
        advisor: null,
        abstractTr: null,
        abstractEn: abstract,
        keywordsTr: [],
        keywordsEn: meta.keywords,
        acknowledgments: meta.acknowledgments,
        dedication: null,
      }
    }

    case 'AMA': {
      const primary = meta.authors[0]
      const authorName = (name: string, degrees: string[]) =>
        degrees.length > 0 ? `${name.trim()} ${degrees.join(', ')}` : name.trim()
      const authorNames = meta.authors
        .map((a) => authorName(a.name, a.degrees))
        .filter(Boolean)
        .join(', ') || null
      const abstract = joinStructured([
        ['Importance', meta.structuredAbstract.importance],
        ['Objective', meta.structuredAbstract.objective],
        ['Design, Setting, and Participants', meta.structuredAbstract.designSettingParticipants],
        ['Interventions', meta.structuredAbstract.interventions],
        ['Main Outcomes and Measures', meta.structuredAbstract.mainOutcomesAndMeasures],
        ['Results', meta.structuredAbstract.results],
        ['Conclusions and Relevance', meta.structuredAbstract.conclusionsAndRelevance],
        ['Trial Registration', meta.structuredAbstract.trialRegistration],
      ])
      return {
        author: authorNames,
        institution: primary?.institution ?? null,
        department: primary?.department ?? null,
        advisor: null,
        abstractTr: null,
        abstractEn: abstract,
        keywordsTr: [],
        keywordsEn: meta.keywords,
        acknowledgments: meta.acknowledgments,
        dedication: null,
      }
    }

    case 'ISNAD': {
      return {
        author: meta.author || null,
        institution: meta.institution,
        department: meta.department,
        advisor: meta.advisor,
        abstractTr: meta.abstractTr,
        abstractEn: meta.abstractEn,
        keywordsTr: meta.keywordsTr,
        keywordsEn: meta.keywordsEn,
        acknowledgments: meta.acknowledgments,
        dedication: meta.dedication,
      }
    }
  }
}

// =================================================================
//  Structural-input adapter
// =================================================================

const ISNAD_DEGREE_LABELS: Record<string, string> = {
  yuksek_lisans: 'Yüksek Lisans Tezi',
  doktora: 'Doktora Tezi',
  tezsiz_yuksek_lisans: 'Tezsiz Yüksek Lisans',
  sanatta_yeterlik: 'Sanatta Yeterlik Tezi',
}

interface StructuralProjectContext {
  title: string
  language: string | null
}

/**
 * Converts the typed AcademicMeta into the flat shape consumed by the
 * structural export builders (`pdf-structural`, `docx-structural`). The
 * export pipeline pre-dates the discriminated-union design; this adapter
 * preserves every field the builders can render today, including
 * format-specific fields like course/instructor/city/degreeType that
 * the legacy Project columns never carried.
 *
 * Lossy points (acceptable for now; tracked for follow-up):
 *  - IEEE / Vancouver / AMA collapse the multi-author array to the
 *    first author.
 *  - Vancouver structured abstract → joined paragraph.
 *  - AMA structured abstract + key points → joined paragraph; key
 *    points box is not rendered.
 */
export function structuralAcademicFromMeta(
  meta: AcademicMeta,
  ctx: StructuralProjectContext,
  blindReview: boolean
): StructuralAcademicMeta {
  // Author label localisation: ISNAD title pages already use Turkish;
  // every other format renders English title pages and should say
  // "Advisor:" rather than the Turkish "Danışman:".
  const advisorLabel = meta.format === 'ISNAD' ? 'Danışman:' : 'Advisor:'
  const today = new Date()
  const fallbackDate = String(today.getFullYear())

  // Pull a primary author across the variants.
  const primaryAuthor = (() => {
    if (
      meta.format === 'IEEE' ||
      meta.format === 'VANCOUVER' ||
      meta.format === 'AMA'
    ) {
      const a = meta.authors[0]
      if (!a) return null
      const degrees = meta.format === 'AMA' && a.degrees.length > 0
        ? ` ${a.degrees.join(', ')}`
        : ''
      return a.name ? `${a.name}${degrees}` : null
    }
    return meta.author || null
  })()

  // Pull primary affiliation (department / institution) from the same source.
  const primary = (() => {
    if (
      meta.format === 'IEEE' ||
      meta.format === 'VANCOUVER' ||
      meta.format === 'AMA'
    ) {
      const a = meta.authors[0]
      return {
        institution: a?.institution ?? null,
        department: a?.department ?? null,
      }
    }
    return {
      institution: 'institution' in meta ? meta.institution ?? null : null,
      department: 'department' in meta ? meta.department ?? null : null,
    }
  })()

  // Flat string abstract — flatten structured abstracts to a single
  // paragraph series so the existing builders can still render them.
  const flatAbstract = (() => {
    if (meta.format === 'VANCOUVER') {
      return joinStructured([
        ['Background', meta.structuredAbstract.background],
        ['Methods', meta.structuredAbstract.methods],
        ['Results', meta.structuredAbstract.results],
        ['Conclusions', meta.structuredAbstract.conclusions],
      ])
    }
    if (meta.format === 'AMA') {
      return joinStructured([
        ['Importance', meta.structuredAbstract.importance],
        ['Objective', meta.structuredAbstract.objective],
        ['Design, Setting, and Participants', meta.structuredAbstract.designSettingParticipants],
        ['Interventions', meta.structuredAbstract.interventions],
        ['Main Outcomes and Measures', meta.structuredAbstract.mainOutcomesAndMeasures],
        ['Results', meta.structuredAbstract.results],
        ['Conclusions and Relevance', meta.structuredAbstract.conclusionsAndRelevance],
        ['Trial Registration', meta.structuredAbstract.trialRegistration],
      ])
    }
    if (meta.format === 'ISNAD') return null // dual handled below
    if (meta.format === 'IEEE') return meta.abstract
    if (meta.format === 'MLA') return meta.abstract
    return meta.abstract
  })()

  // Flat keyword list — IEEE → indexTerms, others → keywords.
  const flatKeywords = (() => {
    if (meta.format === 'IEEE') return meta.indexTerms
    if (meta.format === 'ISNAD') return meta.keywordsEn
    if ('keywords' in meta) return meta.keywords
    return []
  })()

  // Date / city / degree type / course / instructor — only populated
  // when the format actually carries them.
  const date = (() => {
    if (meta.format === 'ISNAD') return meta.year || fallbackDate
    if (meta.format === 'TURABIAN' || meta.format === 'CHICAGO' || meta.format === 'MLA' || meta.format === 'APA')
      return meta.format === 'APA' && meta.variant === 'student'
        ? meta.dueDate || fallbackDate
        : meta.format === 'CHICAGO' || meta.format === 'TURABIAN' || meta.format === 'MLA'
        ? (meta as { date: string | null }).date || fallbackDate
        : fallbackDate
    if (meta.format === 'HARVARD') return meta.dateOfSubmission || fallbackDate
    return fallbackDate
  })()

  const degreeType = (() => {
    if (meta.format === 'ISNAD' && meta.degreeType)
      return ISNAD_DEGREE_LABELS[meta.degreeType] ?? null
    if (meta.format === 'TURABIAN') return meta.degreeType
    if (meta.format === 'CHICAGO' && meta.variant === 'thesis')
      return meta.degreeType
    return null
  })()

  const course = (() => {
    if (meta.format === 'APA' && meta.variant === 'student') {
      return [meta.courseNumber, meta.courseName].filter(Boolean).join(' — ') || null
    }
    if (meta.format === 'CHICAGO' && meta.variant === 'student') return meta.courseName
    if (meta.format === 'MLA') return meta.courseName
    return null
  })()

  const instructor = (() => {
    const join = (title: string | null, name: string | null) =>
      [title, name].filter(Boolean).join(' ').trim() || null
    if (meta.format === 'APA' && meta.variant === 'student') {
      return join(meta.instructorTitle, meta.instructorName)
    }
    if (meta.format === 'CHICAGO' && meta.variant === 'student') {
      return join(meta.instructorTitle, meta.instructorName)
    }
    if (meta.format === 'MLA') {
      return join(meta.instructorTitle, meta.instructorName)
    }
    return null
  })()

  const city = (() => {
    if (meta.format === 'ISNAD') return meta.city
    if (meta.format === 'TURABIAN') return meta.city
    if (meta.format === 'CHICAGO' && meta.variant === 'thesis') return meta.city
    return null
  })()

  // Advisor: ISNAD/Turabian/Harvard/Chicago-thesis carry an explicit one.
  const advisor = (() => {
    if (meta.format === 'ISNAD') return meta.advisor
    if (meta.format === 'TURABIAN') return meta.advisor
    if (meta.format === 'HARVARD') return meta.supervisor
    return null
  })()

  // Subtitle is now a real meta field across most formats.
  const subtitle = (() => {
    if ('subtitle' in meta) return (meta as { subtitle: string | null }).subtitle ?? null
    return null
  })()

  // Acknowledgments / dedication may not exist on every variant.
  const acknowledgments = 'acknowledgments' in meta ? meta.acknowledgments ?? null : null
  const dedication = 'dedication' in meta ? meta.dedication ?? null : null

  const isStateUniversity = meta.format === 'ISNAD' ? meta.isStateUniversity : undefined

  return {
    title: ctx.title,
    subtitle,
    author: blindReview ? null : primaryAuthor,
    institution: blindReview ? null : primary.institution,
    department: blindReview ? null : primary.department,
    advisor: blindReview ? null : advisor,
    abstractTr: meta.format === 'ISNAD' ? meta.abstractTr : null,
    abstractEn:
      meta.format === 'ISNAD' ? meta.abstractEn : flatAbstract,
    keywordsTr: meta.format === 'ISNAD' ? meta.keywordsTr : [],
    keywordsEn: meta.format === 'ISNAD' ? meta.keywordsEn : flatKeywords,
    acknowledgments: blindReview ? null : acknowledgments,
    dedication: blindReview ? null : dedication,
    language: ctx.language,
    date,
    degreeType,
    course,
    instructor,
    city,
    isStateUniversity,
    advisorLabel,
  }
}
