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
 * Author-date & parenthetical formats use the existing formatFootnoteFirst
 * or a hand-rolled rule; numeric formats show `[1]`; footnote formats show
 * a superscript cue. The full footnote/endnote body shows up in the
 * sample sentence's footer.
 */
function buildInline(formatter: CitationFormatter, format: CitationFormat, entry: BibliographyEntry, page?: string): string {
  const surname = entry.authorSurname
  const year = entry.year ?? 'n.d.'
  const pageNum = page ?? entry.pageRange?.split('-')[0] ?? null

  switch (format) {
    case 'APA':
    case 'HARVARD':
      return pageNum ? `(${surname}, ${year}, s. ${pageNum})` : `(${surname}, ${year})`
    case 'MLA':
      return pageNum ? `(${surname} ${pageNum})` : `(${surname})`
    case 'CHICAGO':
    case 'TURABIAN':
    case 'ISNAD':
      // Footnote-style — UI will render ¹ as superscript and the full note
      // in the sample sentence footer.
      return '¹'
    case 'IEEE':
      return '[1]'
    case 'VANCOUVER':
    case 'AMA':
      return '(1)'
    default:
      return `(${surname}, ${year})`
  }
}

function buildInlineSubsequent(formatter: CitationFormatter, format: CitationFormat, entry: BibliographyEntry): string {
  const surname = entry.authorSurname
  const year = entry.year ?? 'n.d.'
  switch (format) {
    case 'APA':
    case 'HARVARD':
      return `(${surname}, ${year})`
    case 'MLA':
      return `(${surname})`
    case 'CHICAGO':
    case 'TURABIAN':
    case 'ISNAD':
      return '²'
    case 'IEEE':
      return '[1]'
    case 'VANCOUVER':
    case 'AMA':
      return '(1)'
    default:
      return `(${surname}, ${year})`
  }
}

/**
 * Build a "look how your paragraph will read" sample with two inline
 * citations woven into plain prose. For footnote formats we return the
 * superscript cue and let the caller render the footnote text below the
 * paragraph.
 */
function buildSampleSentence(format: CitationFormat, firstInline: string, secondInline: string): string {
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

  const samples: CitationPreviewSample[] = CITATION_EXAMPLES.map((entry) => ({
    entry,
    inline: buildInline(formatter, format, entry, '45'),
    inlineSubsequent: buildInlineSubsequent(formatter, format, entry),
    bibliography: formatter.formatBibliography(entry),
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
