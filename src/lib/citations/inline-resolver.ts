/**
 * Inline citation marker resolver.
 *
 * Body content may contain structured `[cite:bibId,p=45]` markers that
 * authors (AI or human) drop into the text. At export time we walk each
 * subsection's markdown and replace those markers with:
 *
 *  - footnote formats (Chicago / Turabian / ISNAD):
 *      a `[fn: …]` marker — the existing DOCX/PDF footnote renderer
 *      picks it up. First appearance gets the full footnote; subsequent
 *      references to the same bibId get the short form.
 *
 *  - author-date / author-page (APA / MLA / Harvard):
 *      inline parenthetical text — e.g. `(Smith, 2020, p. 45)` /
 *      `(Smith 45)`.
 *
 *  - numeric (IEEE / Vancouver / AMA):
 *      `[N]` bracketed number — same bibId always gets the same number
 *      (first-seen wins). The `seenIds` order doubles as the
 *      bibliography sort order for these formats.
 *
 * Marker grammar:
 *   [cite:<bibId>]
 *   [cite:<bibId>,p=<page>]       // single page
 *   [cite:<bibId>,pp=<range>]     // page range e.g. 45-48
 *   [cite:<bibId>,v=<vol>,p=<p>]  // volume + page (ISNAD/Chicago)
 *
 * Unknown bibIds leave the marker verbatim in the text and log a warning —
 * we never want export to crash on an author typo.
 */

import type { BibliographyEntry } from '@/types/bibliography'
import { CitationFormatter } from './base'

export interface InlineResolverState {
  /** Stable bibId → reference-number mapping for numeric formats. */
  numbering: Map<string, number>
  /** bibIds seen so far, in order of first appearance. */
  seenIds: string[]
  /** Whether we've emitted the first footnote for each bibId (footnote formats). */
  firstFootnoteEmitted: Set<string>
}

export function createResolverState(): InlineResolverState {
  return {
    numbering: new Map(),
    seenIds: [],
    firstFootnoteEmitted: new Set(),
  }
}

export interface ParsedMarker {
  bibId: string
  page?: string
  volume?: string
}

// Page-key synonyms across the languages the product targets. The
// canonical export form is `p=`; the parser tolerates these so an
// LLM that slips into the local academic convention doesn't break
// the citation. Order doesn't matter — first match wins.
const PAGE_KEY_RE =
  /^(p|page|pages|pp|s|sayfa|seite|pagina|página|page|الصفحة|ص|сторінка|стр|с)$/i
const VOLUME_KEY_RE =
  /^(v|vol|volume|cilt|c|band|bd|tom|tome|tomo|t|том|الجزء|ج)$/i

/**
 * Parse a `[cite:…]` marker body. Tolerant of the variants the LLM
 * occasionally hallucinates despite the prompt:
 *
 *   canonical (always export-safe):
 *     [cite:bibId,p=45]            single page
 *     [cite:bibId,pp=45-48]        range
 *     [cite:bibId,v=2,p=45]        volume + page
 *
 *   pipe separator (common LLM drift):
 *     [cite:bibId|s.45]   [cite:bibId|p=45]
 *
 *   localised page abbreviations (any language the product supports):
 *     [cite:bibId,s.45]   tr  Sayfa
 *     [cite:bibId,p.45]   en  page
 *     [cite:bibId,S.45]   de  Seite
 *     [cite:bibId,ص.45]   ar  ṣafḥa
 *
 *   localised key=value:
 *     [cite:bibId,sayfa=45]   [cite:bibId,seite=45]   [cite:bibId,ص=45]
 *
 *   bare numeric tail:
 *     [cite:bibId,45]        [cite:bibId|45]
 *
 * All paths normalise back to the same {bibId, page, volume} shape so
 * the editor pill renderer and the export resolver agree.
 */
export function parseMarker(body: string): ParsedMarker | null {
  // 1) Normalise separators: pipe → comma (does not affect Arabic
  // text which uses commas of its own — those are inside string
  // values, not part of the marker key/value scaffolding).
  let normalised = body.replace(/\|/g, ',')

  // 2) Bare "p.", "s.", "S.", "pg.", "ص." right before a digit (no
  //    equals sign) → canonical `p=`. The dot is optional. Latin
  //    letters use ASCII-aware boundaries; Arabic key handled separately.
  normalised = normalised.replace(/\b[psS]g?\.\s*(?=\d)/g, 'p=')
  normalised = normalised.replace(/(^|[\s,])ص\.?\s*(?=\d)/g, '$1p=')

  // 3) Split + parse parts.
  const parts = normalised.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return null
  const bibId = parts[0]
  if (!bibId) return null
  const parsed: ParsedMarker = { bibId }
  for (const kv of parts.slice(1)) {
    if (kv.includes('=')) {
      const [rawKey, rawValue] = kv.split('=').map((s) => s.trim())
      if (!rawKey || !rawValue) continue
      // Strip a trailing dot from the key — handles "S." / "Bd." /
      // "p." style abbreviations used as keys ("S.=12", "Bd.=3").
      const key = rawKey.replace(/\.$/, '')
      if (PAGE_KEY_RE.test(key)) {
        parsed.page = rawValue
      } else if (VOLUME_KEY_RE.test(key)) {
        parsed.volume = rawValue
      }
    } else if (/^\d+(-\d+)?$/.test(kv)) {
      // Bare number tail — interpret as page when no page set yet.
      if (!parsed.page) parsed.page = kv
    }
  }
  return parsed
}

/**
 * Replace every `[cite:…]` marker in `content` using the formatter's
 * in-text convention. Mutates `state` so subsequent calls (e.g. in the
 * next subsection) continue numbering / first-vs-subsequent tracking.
 *
 * Returns the rewritten content. Footnote formats emit `[fn: …]` markers
 * that the existing DOCX/PDF export pipeline already knows how to render.
 */
export function resolveInlineCitations(
  content: string,
  entries: BibliographyEntry[],
  formatter: CitationFormatter,
  state: InlineResolverState
): string {
  if (!content) return content
  const entryById = new Map(entries.map((e) => [e.id, e]))

  return content.replace(/\[cite:([^\]]+)\]/g, (match, body: string) => {
    const marker = parseMarker(body)
    if (!marker) return match
    const entry = entryById.get(marker.bibId)
    if (!entry) {
      if (typeof console !== 'undefined') {
        console.warn(`[inline-resolver] Unknown bibId: ${marker.bibId}`)
      }
      return match
    }

    // Track first-appearance order (used by numeric formats AND by
    // citation-order bibliography sorting).
    if (!state.numbering.has(marker.bibId)) {
      state.numbering.set(marker.bibId, state.numbering.size + 1)
      state.seenIds.push(marker.bibId)
    }
    const refNumber = state.numbering.get(marker.bibId)!

    switch (formatter.inlineStyle) {
      case 'footnote': {
        const isFirst = !state.firstFootnoteEmitted.has(marker.bibId)
        const footnoteText = isFirst
          ? formatter.formatFootnoteFirst(entry, marker.page, marker.volume)
          : formatter.formatFootnoteSubsequent(entry, marker.page, marker.volume)
        if (isFirst) state.firstFootnoteEmitted.add(marker.bibId)
        // Escape `]` inside footnote body so downstream parser doesn't close early.
        const safe = footnoteText.replace(/\]/g, '\\]')
        return `[fn: ${safe}]`
      }
      case 'numeric':
      case 'author-date':
      case 'author-page':
      default:
        return formatter.formatInline(entry, marker.page, marker.volume, refNumber)
    }
  })
}

/**
 * Orders bibliography entries for the final list:
 *  - citation-order formats → entries that appeared (in `state.seenIds`
 *    order) followed by any unreferenced entries.
 *  - alphabetical formats → input order (caller sorts via
 *    CitationFormatter.sortBibliography on the formatted strings).
 *
 * This is a raw entry-level sort; the final formatted-string sort for
 * alphabetical formats still happens in the export render loop.
 */
export function orderEntriesForBibliography(
  entries: BibliographyEntry[],
  formatter: CitationFormatter,
  state: InlineResolverState
): BibliographyEntry[] {
  if (formatter.bibliographyOrder !== 'citation-order') return entries
  const entryById = new Map(entries.map((e) => [e.id, e]))
  const ordered: BibliographyEntry[] = []
  for (const id of state.seenIds) {
    const e = entryById.get(id)
    if (e) ordered.push(e)
  }
  // Preserve any unreferenced entries at the end (rarely needed but safe).
  for (const e of entries) {
    if (!state.seenIds.includes(e.id)) ordered.push(e)
  }
  return ordered
}
