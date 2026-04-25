/**
 * Academic metadata — Zod schemas + inferred TypeScript types.
 *
 * Single source of truth for the shape of the `ProjectAcademicMeta.meta`
 * JSON column. Every form, API handler, and export builder parses
 * incoming data through these schemas; no consumer touches the raw JSON.
 *
 * Design notes:
 *
 *  - `z.discriminatedUnion('format', [...])` keys each variant by the
 *    format literal, so a single parse call returns the correctly-typed
 *    object (e.g., `meta.format === 'IEEE'` narrows `meta.authors` to
 *    the IEEE author array).
 *
 *  - APA (student/professional) and Chicago (student/thesis) use an
 *    inner `variant` field rather than separate top-level discriminators
 *    so the existing Prisma `CitationFormat` enum stays unchanged.
 *
 *  - `schemaVersion` is stamped literal-1 everywhere today. When a style
 *    manual update forces a field change we bump the literal and add a
 *    migration function.
 *
 *  - Empty string fields are normalised to `null` on parse so the DB
 *    JSON stays deterministic and form state can rely on `??` checks.
 *
 *  - Arrays default to `[]`. Numeric fields default to `null`.
 */

import { z } from 'zod'

// =================================================================
//  Shared atoms
// =================================================================

/** Trim + map empty string → null. Used for every optional text field. */
const nullableText = z
  .union([z.string(), z.null()])
  .transform((v) => {
    if (v === null) return null
    const trimmed = v.trim()
    return trimmed.length === 0 ? null : trimmed
  })
  .nullable()
  .default(null)

/** Required non-empty trimmed string (author name, title, etc.). */
const requiredText = z
  .string()
  .trim()
  .min(1, 'Required')

/** Array of trimmed non-empty strings; empty input → []. */
const keywordList = z
  .array(z.string().trim().min(1))
  .default([])

/** Non-negative int or null; useful for wordCount / tableCount. */
const nullableNonNegInt = z
  .union([z.number().int().nonnegative(), z.null()])
  .nullable()
  .default(null)

/**
 * Author block used by formats with per-author affiliation (IEEE,
 * Vancouver, AMA).
 */
export const AuthorBlockSchema = z.object({
  name: requiredText,
  degrees: z.array(z.string().trim().min(1)).default([]),
  department: nullableText,
  institution: nullableText,
  city: nullableText,
  country: nullableText,
  email: nullableText,
  orcid: nullableText,
})

/** Corresponding-author contact block (Vancouver, AMA). */
export const CorrespondingAuthorSchema = z.object({
  name: nullableText,
  email: nullableText,
  phone: nullableText,
  address: nullableText,
})

// =================================================================
//  APA 7
// =================================================================

export const ApaMetaSchema = z.object({
  format: z.literal('APA'),
  schemaVersion: z.literal(1),
  variant: z.enum(['student', 'professional']),

  subtitle: nullableText,
  author: requiredText,
  institution: nullableText,
  department: nullableText,

  // Student variant
  courseNumber: nullableText,
  courseName: nullableText,
  instructorTitle: nullableText,
  instructorName: nullableText,
  dueDate: nullableText,

  // Professional variant
  authorNote: nullableText,
  /** Printed ALL CAPS as the running head, max 50 chars. */
  shortTitle: z
    .union([z.string().max(50), z.null()])
    .transform((v) => (v ? v.trim() || null : null))
    .nullable()
    .default(null),

  abstract: nullableText,
  keywords: keywordList,
  acknowledgments: nullableText,
  dedication: nullableText,
})

// =================================================================
//  MLA 9
// =================================================================

export const MlaMetaSchema = z.object({
  format: z.literal('MLA'),
  schemaVersion: z.literal(1),

  subtitle: nullableText,
  author: requiredText,
  instructorTitle: nullableText,
  instructorName: nullableText,
  courseName: nullableText,
  /** MLA prescribes "DD Month YYYY". */
  date: nullableText,

  abstract: nullableText,
  keywords: keywordList,
  acknowledgments: nullableText,
  dedication: nullableText,
})

// =================================================================
//  Chicago 17 (Notes-Bibliography)
// =================================================================

export const ChicagoMetaSchema = z.object({
  format: z.literal('CHICAGO'),
  schemaVersion: z.literal(1),
  variant: z.enum(['student', 'thesis']),

  subtitle: nullableText,
  author: requiredText,
  institution: nullableText,
  department: nullableText,

  // Student variant
  courseName: nullableText,
  instructorTitle: nullableText,
  instructorName: nullableText,

  // Thesis variant
  degreeType: nullableText,
  city: nullableText,
  committeeMembers: z.array(z.string().trim().min(1)).default([]),

  date: nullableText,
  abstract: nullableText,
  keywords: keywordList,
  acknowledgments: nullableText,
  dedication: nullableText,
})

// =================================================================
//  Turabian 9
// =================================================================

export const TurabianMetaSchema = z.object({
  format: z.literal('TURABIAN'),
  schemaVersion: z.literal(1),

  subtitle: nullableText,
  author: requiredText,
  institution: nullableText,
  department: nullableText,
  degreeType: nullableText,
  advisor: nullableText,
  committeeMembers: z.array(z.string().trim().min(1)).default([]),
  city: nullableText,
  date: nullableText,

  abstract: nullableText,
  keywords: keywordList,
  acknowledgments: nullableText,
  dedication: nullableText,
})

// =================================================================
//  Harvard (Cite Them Right)
// =================================================================

export const HarvardMetaSchema = z.object({
  format: z.literal('HARVARD'),
  schemaVersion: z.literal(1),

  subtitle: nullableText,
  author: requiredText,
  studentId: nullableText,
  moduleCode: nullableText,
  moduleName: nullableText,
  institution: nullableText,
  supervisor: nullableText,
  wordCount: nullableNonNegInt,
  dateOfSubmission: nullableText,

  abstract: nullableText,
  keywords: keywordList,
  acknowledgments: nullableText,
  dedication: nullableText,
})

// =================================================================
//  IEEE
// =================================================================

export const IeeeMetaSchema = z.object({
  format: z.literal('IEEE'),
  schemaVersion: z.literal(1),

  subtitle: nullableText,
  authors: z.array(AuthorBlockSchema).min(1, 'At least one author'),
  /** Single paragraph, rendered with bold "Abstract—" prefix. */
  abstract: nullableText,
  /** Alphabetised 4-8 terms; IEEE calls these "Index Terms". */
  indexTerms: keywordList,
  /** Null → first author is corresponding. */
  correspondingAuthorIndex: z
    .union([z.number().int().nonnegative(), z.null()])
    .nullable()
    .default(null),
  acknowledgments: nullableText,
})

// =================================================================
//  Vancouver / ICMJE
// =================================================================

export const VancouverStructuredAbstractSchema = z.object({
  background: nullableText,
  methods: nullableText,
  results: nullableText,
  conclusions: nullableText,
})

export const VancouverMetaSchema = z.object({
  format: z.literal('VANCOUVER'),
  schemaVersion: z.literal(1),

  /** 40-50 char running head for journal submission. */
  shortTitle: nullableText,
  authors: z.array(AuthorBlockSchema).min(1),
  correspondingAuthor: CorrespondingAuthorSchema.default({
    name: null,
    email: null,
    phone: null,
    address: null,
  }),
  structuredAbstract: VancouverStructuredAbstractSchema.default({
    background: null,
    methods: null,
    results: null,
    conclusions: null,
  }),
  /** MeSH terms (2-10 typical). */
  keywords: keywordList,

  wordCountAbstract: nullableNonNegInt,
  wordCountText: nullableNonNegInt,
  tableCount: nullableNonNegInt,
  figureCount: nullableNonNegInt,
  conflictOfInterest: nullableText,
  funding: nullableText,
  trialRegistration: nullableText,

  acknowledgments: nullableText,
})

// =================================================================
//  AMA 11
// =================================================================

export const AmaStructuredAbstractSchema = z.object({
  importance: nullableText,
  objective: nullableText,
  designSettingParticipants: nullableText,
  interventions: nullableText,
  mainOutcomesAndMeasures: nullableText,
  results: nullableText,
  conclusionsAndRelevance: nullableText,
  trialRegistration: nullableText,
})

export const AmaKeyPointsSchema = z.object({
  question: nullableText,
  findings: nullableText,
  meaning: nullableText,
})

export const AmaMetaSchema = z.object({
  format: z.literal('AMA'),
  schemaVersion: z.literal(1),

  shortTitle: nullableText,
  /** AuthorBlock.degrees populated for AMA: "MD", "PhD", "MPH". */
  authors: z.array(AuthorBlockSchema).min(1),
  correspondingAuthor: CorrespondingAuthorSchema.default({
    name: null,
    email: null,
    phone: null,
    address: null,
  }),
  structuredAbstract: AmaStructuredAbstractSchema.default({
    importance: null,
    objective: null,
    designSettingParticipants: null,
    interventions: null,
    mainOutcomesAndMeasures: null,
    results: null,
    conclusionsAndRelevance: null,
    trialRegistration: null,
  }),
  keyPoints: AmaKeyPointsSchema.default({
    question: null,
    findings: null,
    meaning: null,
  }),
  keywords: keywordList,

  wordCountAbstract: nullableNonNegInt,
  wordCountText: nullableNonNegInt,
  conflictOfInterest: nullableText,
  funding: nullableText,

  acknowledgments: nullableText,
})

// =================================================================
//  ISNAD 2
// =================================================================

export const IsnadDegreeTypeSchema = z.enum([
  'yuksek_lisans',
  'doktora',
  'tezsiz_yuksek_lisans',
  'sanatta_yeterlik',
])

export const IsnadMetaSchema = z.object({
  format: z.literal('ISNAD'),
  schemaVersion: z.literal(1),

  /**
   * State universities print "T.C." above the institution name on the
   * title page; private universities omit it.
   */
  isStateUniversity: z.boolean().default(true),

  institution: nullableText,
  institute: nullableText,
  department: nullableText,
  subtitle: nullableText,
  author: requiredText,
  degreeType: z
    .union([IsnadDegreeTypeSchema, z.null()])
    .nullable()
    .default(null),
  advisor: nullableText,
  coAdvisor: nullableText,
  city: nullableText,
  year: nullableText,

  abstractTr: nullableText,
  abstractEn: nullableText,
  keywordsTr: keywordList,
  keywordsEn: keywordList,

  acknowledgments: nullableText,
  dedication: nullableText,
})

// =================================================================
//  Discriminated union
// =================================================================

export const AcademicMetaSchema = z.discriminatedUnion('format', [
  ApaMetaSchema,
  MlaMetaSchema,
  ChicagoMetaSchema,
  TurabianMetaSchema,
  HarvardMetaSchema,
  IeeeMetaSchema,
  VancouverMetaSchema,
  AmaMetaSchema,
  IsnadMetaSchema,
])

// =================================================================
//  Inferred TypeScript types
// =================================================================

export type AuthorBlock = z.infer<typeof AuthorBlockSchema>
export type CorrespondingAuthor = z.infer<typeof CorrespondingAuthorSchema>

export type ApaMeta = z.infer<typeof ApaMetaSchema>
export type MlaMeta = z.infer<typeof MlaMetaSchema>
export type ChicagoMeta = z.infer<typeof ChicagoMetaSchema>
export type TurabianMeta = z.infer<typeof TurabianMetaSchema>
export type HarvardMeta = z.infer<typeof HarvardMetaSchema>
export type IeeeMeta = z.infer<typeof IeeeMetaSchema>
export type VancouverMeta = z.infer<typeof VancouverMetaSchema>
export type AmaMeta = z.infer<typeof AmaMetaSchema>
export type IsnadMeta = z.infer<typeof IsnadMetaSchema>

export type AcademicMeta = z.infer<typeof AcademicMetaSchema>
export type AcademicFormat = AcademicMeta['format']
export type VancouverStructuredAbstract = z.infer<typeof VancouverStructuredAbstractSchema>
export type AmaStructuredAbstract = z.infer<typeof AmaStructuredAbstractSchema>
export type AmaKeyPoints = z.infer<typeof AmaKeyPointsSchema>
export type IsnadDegreeType = z.infer<typeof IsnadDegreeTypeSchema>
