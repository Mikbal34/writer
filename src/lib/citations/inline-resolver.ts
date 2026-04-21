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

interface ParsedMarker {
  bibId: string
  page?: string
  volume?: string
}

/** Parse a single `[cite:…]` marker body (between colons/brackets). */
function parseMarker(body: string): ParsedMarker | null {
  const parts = body.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return null
  const bibId = parts[0]
  if (!bibId) return null
  const parsed: ParsedMarker = { bibId }
  for (const kv of parts.slice(1)) {
    const [key, rawValue] = kv.split('=').map((s) => s.trim())
    if (!key || !rawValue) continue
    switch (key.toLowerCase()) {
      case 'p':
      case 'page':
        parsed.page = rawValue
        break
      case 'pp':
      case 'pages':
        parsed.page = rawValue
        break
      case 'v':
      case 'vol':
      case 'volume':
        parsed.volume = rawValue
        break
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
