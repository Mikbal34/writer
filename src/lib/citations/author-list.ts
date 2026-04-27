/**
 * Author-list rendering with per-format "et al." truncation.
 *
 * Each format has its own threshold and post-truncation form. This
 * module centralises those rules so every formatter produces the same
 * canonical author list — feed it the entry and the format's policy,
 * get back the formatted string.
 *
 * Sources used (style-guide quick references):
 *  APA 7        — list ≤20, then "..." + final author (publication manual §9.8)
 *  MLA 9        — 1-2 listed, 3+ becomes "First, et al."
 *  Chicago 17 N — note: 1-3 listed; 4+ becomes "First et al."
 *                 bib:  1-10 listed; 11+ truncated to 7 + "et al."
 *  Harvard      — 1-3 listed; 4+ becomes "First et al."
 *  IEEE         — up to 6 listed, then "et al."
 *  Vancouver    — up to 6 listed, then "et al."
 *  AMA 11       — up to 6 listed, then "et al" (no period)
 *  ISNAD 2      — 1-2 listed; 3+ becomes "İlk Yazar vd."
 */

import type { BibliographyEntry } from '@/types/bibliography'

export interface AuthorRenderOptions {
  /**
   * "Last, F. M." (APA, Vancouver) vs "First Last" (Chicago bib name 1)
   * vs "F. M. Last" (Chicago notes, IEEE in-text). Each formatter passes
   * a per-author renderer; the helper handles list joining + truncation.
   */
  renderOne: (a: { surname: string; name: string | null }) => string
  /**
   * Separator between the second-to-last author and the last when the
   * full list is rendered (e.g. APA: ", & " ; Chicago: ", and " ; AMA:
   * ", "). Truncated lists never use this — they just append "et al.".
   */
  finalSeparator: string
  /** Standard separator between authors (usually ", "). */
  separator: string
  /**
   * The "et al." form per format. AMA omits the trailing period.
   */
  etAl: string
}

/**
 * Per-format truncation policies. `keepFull` = author count up to and
 * including this is rendered in full; anything beyond it is truncated
 * down to `keepBeforeEtAl` and appended with "et al.".
 *
 * APA 7 has a special rule (list 19, "...", last) — modelled with
 * `apaSpecial: true`.
 */
export interface AuthorTruncationPolicy {
  keepFull: number
  keepBeforeEtAl: number
  apaSpecial?: boolean
  /** Used for ISNAD which has its own "vd." sigil. */
  etAlOverride?: string
}

export const POLICIES = {
  APA:        { keepFull: 20, keepBeforeEtAl: 19, apaSpecial: true } as const,
  MLA:        { keepFull: 2,  keepBeforeEtAl: 1 } as const,
  CHICAGO_N:  { keepFull: 3,  keepBeforeEtAl: 1 } as const, // notes
  CHICAGO_B:  { keepFull: 10, keepBeforeEtAl: 7 } as const, // bibliography
  HARVARD:    { keepFull: 3,  keepBeforeEtAl: 1 } as const,
  IEEE:       { keepFull: 6,  keepBeforeEtAl: 6 } as const, // 7+ → 6 + et al.
  VANCOUVER:  { keepFull: 6,  keepBeforeEtAl: 6 } as const,
  AMA:        { keepFull: 6,  keepBeforeEtAl: 6, etAlOverride: 'et al' } as const,
  ISNAD:      { keepFull: 2,  keepBeforeEtAl: 1, etAlOverride: 'vd.' } as const,
}

/**
 * Build the full author list for a bibliography entry. The caller
 * supplies the per-author renderer (so we don't duplicate "Smith, J. A."
 * vs "John Smith" formatting across formatters), the join separators,
 * and the format's truncation policy.
 */
export function renderAuthorList(
  entry: BibliographyEntry,
  policy: AuthorTruncationPolicy,
  opts: AuthorRenderOptions
): string {
  const all = [
    { surname: entry.authorSurname, name: entry.authorName },
    ...(entry.coAuthors ?? []),
  ].filter((a) => a.surname.trim().length > 0)

  if (all.length === 0) return ''
  if (all.length === 1) return opts.renderOne(all[0])

  const etAl = policy.etAlOverride ?? opts.etAl

  // Within the "list everyone" range — render the full set with the
  // format's final-separator before the last author.
  if (all.length <= policy.keepFull) {
    return joinFull(all, opts)
  }

  // APA's quirky 21+ rule: ≤19, then "...", then the LAST author.
  if (policy.apaSpecial && all.length > policy.keepFull) {
    const front = all.slice(0, policy.keepBeforeEtAl).map(opts.renderOne).join(opts.separator)
    const last = opts.renderOne(all[all.length - 1])
    return `${front}, ..., ${last}`
  }

  // Standard truncation — list the first N then "et al.".
  const kept = all.slice(0, policy.keepBeforeEtAl).map(opts.renderOne).join(opts.separator)
  return `${kept}, ${etAl}`
}

function joinFull(
  all: Array<{ surname: string; name: string | null }>,
  opts: AuthorRenderOptions
): string {
  if (all.length === 1) return opts.renderOne(all[0])
  if (all.length === 2) {
    return `${opts.renderOne(all[0])}${opts.finalSeparator}${opts.renderOne(all[1])}`
  }
  const head = all.slice(0, -1).map(opts.renderOne).join(opts.separator)
  const tail = opts.renderOne(all[all.length - 1])
  return `${head}${opts.finalSeparator}${tail}`
}

/**
 * Helper: APA-flavoured "Last, F. M." per author. Initials with periods,
 * spaces between initials, surname first.
 */
export function apaLastInitialFirst(a: { surname: string; name: string | null }): string {
  if (!a.name) return a.surname
  const initials = a.name
    .trim()
    .split(/\s+/)
    .map((part) => `${part.charAt(0).toUpperCase()}.`)
    .join(' ')
  return `${a.surname}, ${initials}`
}

/**
 * Vancouver/AMA/IEEE flavour: "Surname F" — no period after initials, no
 * comma after surname.
 */
export function vancouverLastInitial(a: { surname: string; name: string | null }): string {
  if (!a.name) return a.surname
  const initials = a.name
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
  return `${a.surname} ${initials}`
}

/**
 * Chicago / MLA flavour: "First Last" for the first author (so the list
 * sorts by surname but reads naturally on subsequent authors).
 * For first-name-first formatting:
 *   apaLastInitialFirst → "Last, F. M." (APA)
 *   firstNameLast       → "First Last" (Chicago, MLA)
 */
export function firstNameLast(a: { surname: string; name: string | null }): string {
  return a.name ? `${a.name} ${a.surname}` : a.surname
}

/**
 * Chicago bibliography: first author "Last, First" (sortable), the rest
 * "First Last" (readable). Returns a per-position renderer.
 */
export function chicagoBibliographyRenderer(): AuthorRenderOptions['renderOne'] {
  let isFirst = true
  return (a) => {
    if (isFirst) {
      isFirst = false
      return a.name ? `${a.surname}, ${a.name}` : a.surname
    }
    return firstNameLast(a)
  }
}
