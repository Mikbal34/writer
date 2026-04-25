/**
 * Public entry point for the academic-meta module. Exports the Zod
 * schemas, inferred types, and a small set of helpers that every
 * consumer (API, form, export builder, AI prompt) uses to move between
 * raw DB JSON and the typed discriminated union.
 */

import type { CitationFormat } from '@prisma/client'
import { ZodError } from 'zod'
import {
  AcademicMetaSchema,
  type AcademicMeta,
  type AcademicFormat,
  type ApaMeta,
  type ChicagoMeta,
  type MlaMeta,
  type TurabianMeta,
  type HarvardMeta,
  type IeeeMeta,
  type VancouverMeta,
  type AmaMeta,
  type IsnadMeta,
} from './schemas'

export * from './schemas'

// =================================================================
//  Format capability
// =================================================================

/** Prisma `CitationFormat` values that have a typed academic-meta shape. */
const ACADEMIC_FORMATS: readonly AcademicFormat[] = [
  'APA',
  'MLA',
  'CHICAGO',
  'TURABIAN',
  'HARVARD',
  'IEEE',
  'VANCOUVER',
  'AMA',
  'ISNAD',
] as const

/**
 * Every current `CitationFormat` has an academic-meta variant. This
 * helper exists so callers can narrow ahead of adding non-academic
 * formats later (e.g., a creative-only format).
 */
export function isAcademicFormat(
  format: CitationFormat
): format is AcademicFormat {
  return (ACADEMIC_FORMATS as readonly string[]).includes(format)
}

// =================================================================
//  Parsing
// =================================================================

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ZodError }

/**
 * Parses an arbitrary value against the AcademicMeta schema. Accepts
 * anything — including the raw Prisma JSON column value — and returns
 * a discriminated result. Callers must narrow on `ok`.
 */
export function parseAcademicMeta(input: unknown): ParseResult<AcademicMeta> {
  const result = AcademicMetaSchema.safeParse(input)
  if (result.success) return { ok: true, data: result.data }
  return { ok: false, error: result.error }
}

/**
 * Same as `parseAcademicMeta` but also asserts that the parsed format
 * matches `expected`. Useful at API boundaries where the project's
 * citationFormat drives which schema we accept.
 */
export function parseAcademicMetaForFormat(
  input: unknown,
  expected: CitationFormat
): ParseResult<AcademicMeta> {
  const parsed = parseAcademicMeta(input)
  if (!parsed.ok) return parsed
  if (parsed.data.format !== expected) {
    // Build a synthetic ZodError so the caller can handle this the same
    // way as any other validation failure.
    return {
      ok: false,
      error: new ZodError([
        {
          code: 'custom',
          path: ['format'],
          message: `Expected format "${expected}" but payload was "${parsed.data.format}"`,
          input,
        } as never,
      ]),
    }
  }
  return parsed
}

// =================================================================
//  Empty-meta factories — one per format
// =================================================================

function emptyApa(variant: ApaMeta['variant'] = 'student'): ApaMeta {
  return {
    format: 'APA',
    schemaVersion: 1,
    variant,
    subtitle: null,
    author: '',
    institution: null,
    department: null,
    courseNumber: null,
    courseName: null,
    instructorTitle: null,
    instructorName: null,
    dueDate: null,
    authorNote: null,
    shortTitle: null,
    abstract: null,
    keywords: [],
    acknowledgments: null,
    dedication: null,
  }
}

function emptyMla(): MlaMeta {
  return {
    format: 'MLA',
    schemaVersion: 1,
    subtitle: null,
    author: '',
    instructorTitle: null,
    instructorName: null,
    courseName: null,
    date: null,
    abstract: null,
    keywords: [],
    acknowledgments: null,
    dedication: null,
  }
}

function emptyChicago(variant: ChicagoMeta['variant'] = 'thesis'): ChicagoMeta {
  return {
    format: 'CHICAGO',
    schemaVersion: 1,
    variant,
    subtitle: null,
    author: '',
    institution: null,
    department: null,
    courseName: null,
    instructorTitle: null,
    instructorName: null,
    degreeType: null,
    city: null,
    committeeMembers: [],
    date: null,
    abstract: null,
    keywords: [],
    acknowledgments: null,
    dedication: null,
  }
}

function emptyTurabian(): TurabianMeta {
  return {
    format: 'TURABIAN',
    schemaVersion: 1,
    subtitle: null,
    author: '',
    institution: null,
    department: null,
    degreeType: null,
    advisor: null,
    committeeMembers: [],
    city: null,
    date: null,
    abstract: null,
    keywords: [],
    acknowledgments: null,
    dedication: null,
  }
}

function emptyHarvard(): HarvardMeta {
  return {
    format: 'HARVARD',
    schemaVersion: 1,
    subtitle: null,
    author: '',
    studentId: null,
    moduleCode: null,
    moduleName: null,
    institution: null,
    supervisor: null,
    wordCount: null,
    dateOfSubmission: null,
    abstract: null,
    keywords: [],
    acknowledgments: null,
    dedication: null,
  }
}

function emptyIeee(): IeeeMeta {
  return {
    format: 'IEEE',
    schemaVersion: 1,
    subtitle: null,
    authors: [
      {
        name: '',
        degrees: [],
        department: null,
        institution: null,
        city: null,
        country: null,
        email: null,
        orcid: null,
      },
    ],
    abstract: null,
    indexTerms: [],
    correspondingAuthorIndex: null,
    acknowledgments: null,
  }
}

function emptyVancouver(): VancouverMeta {
  return {
    format: 'VANCOUVER',
    schemaVersion: 1,
    shortTitle: null,
    authors: [
      {
        name: '',
        degrees: [],
        department: null,
        institution: null,
        city: null,
        country: null,
        email: null,
        orcid: null,
      },
    ],
    correspondingAuthor: {
      name: null,
      email: null,
      phone: null,
      address: null,
    },
    structuredAbstract: {
      background: null,
      methods: null,
      results: null,
      conclusions: null,
    },
    keywords: [],
    wordCountAbstract: null,
    wordCountText: null,
    tableCount: null,
    figureCount: null,
    conflictOfInterest: null,
    funding: null,
    trialRegistration: null,
    acknowledgments: null,
  }
}

function emptyAma(): AmaMeta {
  return {
    format: 'AMA',
    schemaVersion: 1,
    shortTitle: null,
    authors: [
      {
        name: '',
        degrees: [],
        department: null,
        institution: null,
        city: null,
        country: null,
        email: null,
        orcid: null,
      },
    ],
    correspondingAuthor: {
      name: null,
      email: null,
      phone: null,
      address: null,
    },
    structuredAbstract: {
      importance: null,
      objective: null,
      designSettingParticipants: null,
      interventions: null,
      mainOutcomesAndMeasures: null,
      results: null,
      conclusionsAndRelevance: null,
      trialRegistration: null,
    },
    keyPoints: {
      question: null,
      findings: null,
      meaning: null,
    },
    keywords: [],
    wordCountAbstract: null,
    wordCountText: null,
    conflictOfInterest: null,
    funding: null,
    acknowledgments: null,
  }
}

function emptyIsnad(): IsnadMeta {
  return {
    format: 'ISNAD',
    schemaVersion: 1,
    isStateUniversity: true,
    institution: null,
    institute: null,
    department: null,
    subtitle: null,
    author: '',
    degreeType: null,
    advisor: null,
    coAdvisor: null,
    city: null,
    year: null,
    abstractTr: null,
    abstractEn: null,
    keywordsTr: [],
    keywordsEn: [],
    acknowledgments: null,
    dedication: null,
  }
}

/**
 * Returns an empty, fully-populated AcademicMeta for the given format.
 * Used when a project has no stored meta yet — the form loads this as
 * its initial state so every field is controlled.
 */
export function emptyMetaFor(format: AcademicFormat): AcademicMeta {
  switch (format) {
    case 'APA':
      return emptyApa()
    case 'MLA':
      return emptyMla()
    case 'CHICAGO':
      return emptyChicago()
    case 'TURABIAN':
      return emptyTurabian()
    case 'HARVARD':
      return emptyHarvard()
    case 'IEEE':
      return emptyIeee()
    case 'VANCOUVER':
      return emptyVancouver()
    case 'AMA':
      return emptyAma()
    case 'ISNAD':
      return emptyIsnad()
  }
}

// =================================================================
//  Abstract-shape helpers — used by the AI generator
// =================================================================

/**
 * Distilled shape of the abstract block a given format expects. The AI
 * generator reads this to decide which prompt variant to run and how to
 * splice the result back into the meta object.
 */
export type AbstractShape =
  | { kind: 'none' }
  | { kind: 'flat'; wordLimit: number; keywordsField: 'keywords' | 'indexTerms' }
  | { kind: 'structured-vancouver'; wordLimit: number }
  | { kind: 'structured-ama'; wordLimit: number }
  | { kind: 'dual-tr-en'; wordLimit: number } // ISNAD

export function abstractShapeFor(format: AcademicFormat): AbstractShape {
  switch (format) {
    case 'APA':
      return { kind: 'flat', wordLimit: 250, keywordsField: 'keywords' }
    case 'MLA':
      return { kind: 'none' }
    case 'CHICAGO':
      return { kind: 'flat', wordLimit: 300, keywordsField: 'keywords' }
    case 'TURABIAN':
      return { kind: 'flat', wordLimit: 350, keywordsField: 'keywords' }
    case 'HARVARD':
      return { kind: 'flat', wordLimit: 250, keywordsField: 'keywords' }
    case 'IEEE':
      return { kind: 'flat', wordLimit: 250, keywordsField: 'indexTerms' }
    case 'VANCOUVER':
      return { kind: 'structured-vancouver', wordLimit: 250 }
    case 'AMA':
      return { kind: 'structured-ama', wordLimit: 350 }
    case 'ISNAD':
      return { kind: 'dual-tr-en', wordLimit: 250 }
  }
}
