/**
 * Citation formatter factory + public re-exports.
 *
 * The abstract base class and shared types live in ./base so that the
 * subclass files (./apa, ./mla, …) can import from here without causing
 * a circular import with this factory.
 */

import type { CitationFormat } from '@prisma/client'
import type { BibliographyEntry } from '@/types/bibliography'

import {
  CitationFormatter,
  type BibliographyOrder,
  type BibliographyPrefix,
  type InlineCitationStyle,
} from './base'
import { APAFormatter } from './apa'
import { MLAFormatter } from './mla'
import { ChicagoFormatter } from './chicago'
import { HarvardFormatter } from './harvard'
import { IEEEFormatter } from './ieee'
import { VancouverFormatter } from './vancouver'
import { AMAFormatter } from './ama'
import { TurabianFormatter } from './turabian'
import { ISNADFormatter } from './isnad'

export {
  CitationFormatter,
  type BibliographyOrder,
  type BibliographyPrefix,
  type InlineCitationStyle,
}

/**
 * Returns the appropriate CitationFormatter for the given format.
 *
 *   const fmt = getCitationFormatter('ISNAD')
 *   const bib = fmt.formatBibliography(entry)
 */
export function getCitationFormatter(format: CitationFormat): CitationFormatter {
  switch (format) {
    case 'ISNAD': return new ISNADFormatter()
    case 'APA': return new APAFormatter()
    case 'CHICAGO': return new ChicagoFormatter()
    case 'MLA': return new MLAFormatter()
    case 'HARVARD': return new HarvardFormatter()
    case 'VANCOUVER': return new VancouverFormatter()
    case 'IEEE': return new IEEEFormatter()
    case 'AMA': return new AMAFormatter()
    case 'TURABIAN': return new TurabianFormatter()
    default: {
      const _exhaustive: never = format
      throw new Error(`Unknown citation format: ${String(_exhaustive)}`)
    }
  }
}

/**
 * Fallback that prints the format name in brackets. Useful for
 * scaffolding and never registered in the factory — kept here because
 * one-off scripts may want to defer to it.
 */
export class FallbackFormatter extends CitationFormatter {
  constructor(private readonly formatName: string) {
    super()
  }

  get inlineStyle(): InlineCitationStyle {
    return 'author-date'
  }

  formatFootnoteFirst(entry: BibliographyEntry, page?: string): string {
    const p = page ? `, ${page}` : ''
    return `[${this.formatName}] ${entry.authorSurname}, ${entry.title}${p}.`
  }

  formatFootnoteSubsequent(entry: BibliographyEntry, page?: string): string {
    const p = page ? `, ${page}` : ''
    return `[${this.formatName}] ${entry.authorSurname}, ${entry.shortTitle ?? entry.title}${p}.`
  }

  formatBibliography(entry: BibliographyEntry): string {
    return `[${this.formatName}] ${entry.authorSurname}, ${entry.authorName ?? ''}. ${entry.title}. ${entry.publishPlace ?? ''}: ${entry.publisher ?? ''}, ${entry.year ?? ''}.`
  }
}
