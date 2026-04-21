import type { CitationFormat } from '@prisma/client'
import type { BibliographyEntry } from '@/types/bibliography'
import { getCitationFormatter, CitationFormatter } from './formatter'
import { CITATION_EXAMPLES } from './examples'
import { CITATION_FORMAT_META, type CitationFormatMeta } from './metadata'

export interface CitationPreviewSample {
  entry: BibliographyEntry
  inline: string
  inlineSubsequent: string
  bibliography: string
}

export interface CitationPreview {
  meta: CitationFormatMeta
  /** Example sentence with an inline citation pre-baked — for the UI's "this is what it will look like in text" card. */
  sampleSentence: string
  samples: CitationPreviewSample[]
}

/**
 * Render an inline citation appropriate for the format's in-text style.
 * Defers to the formatter's own `formatInline` (author-date, author-page,
 * numeric) and renders a superscript cue for footnote formats — the
 * sample-sentence footer below the preview carries the full note body.
 */
function buildInline(
  formatter: CitationFormatter,
  entry: BibliographyEntry,
  page: string | undefined,
  refNumber: number
): string {
  if (formatter.inlineStyle === 'footnote') {
    return refNumber === 1 ? '¹' : refNumber === 2 ? '²' : `^${refNumber}`
  }
  return formatter.formatInline(entry, page, undefined, refNumber)
}

/**
 * Build a "look how your paragraph will read" sample with two inline
 * citations woven into plain prose. For footnote formats we return the
 * superscript cue and let the caller render the footnote text below the
 * paragraph.
 */
function buildSampleSentence(_format: CitationFormat, firstInline: string, secondInline: string): string {
  return (
    `Recent work in cognitive science has argued that quantum frameworks may ` +
    `offer a productive lens on decision-making${firstInline}. A broader ` +
    `theoretical synthesis is offered by Smith${secondInline}, who draws on ` +
    `both classical and contemporary sources to defend a unified view.`
  )
}

/**
 * Produces everything the citation picker UI needs to render a live preview
 * for one format: a demo paragraph, in-text + subsequent citation strings,
 * and bibliography entries for a representative mix of source types.
 */
export function buildCitationPreview(format: CitationFormat): CitationPreview {
  const meta = CITATION_FORMAT_META[format]
  const formatter = getCitationFormatter(format)

  const samples: CitationPreviewSample[] = CITATION_EXAMPLES.map((entry, idx) => ({
    entry,
    // Give each example a distinct reference number so numeric formats
    // don't collapse them all into [1].
    inline: buildInline(formatter, entry, '45', idx + 1),
    inlineSubsequent: buildInline(formatter, entry, undefined, idx + 1),
    // formatBibliographyEntry applies punctuation normalization; raw `entry`
    // preserves the markdown italics (`*title*`) for the UI to render.
    bibliography: formatter.formatBibliographyEntry(entry).entry,
  }))

  // The sample sentence uses the first two example entries' inline forms so
  // the user sees the format's actual rhythm rather than a generic placeholder.
  const first = samples[0]?.inline ?? ''
  const second = samples[1]?.inlineSubsequent ?? ''
  const sampleSentence = buildSampleSentence(format, first, second)

  return { meta, samples, sampleSentence }
}

/**
 * Full footnote text for the sample sentence when a format uses footnotes.
 * Returned separately so the UI can show it under the paragraph (or as a
 * tooltip / small-print footer).
 */
export function buildSampleFootnotes(format: CitationFormat): string[] {
  const formatter = getCitationFormatter(format)
  const firstEntry = CITATION_EXAMPLES[0]
  const secondEntry = CITATION_EXAMPLES[1]
  if (['CHICAGO', 'TURABIAN', 'ISNAD'].includes(format)) {
    return [
      formatter.formatFootnoteFirst(firstEntry, '45'),
      formatter.formatFootnoteSubsequent(secondEntry),
    ]
  }
  return []
}
