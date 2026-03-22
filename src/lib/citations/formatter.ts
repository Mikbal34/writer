/* eslint-disable @typescript-eslint/no-require-imports */
import type { CitationFormat } from '@prisma/client'
import type { BibliographyEntry, FootnoteFormat, BibliographyFormat } from '@/types/bibliography'

// ==================== ABSTRACT BASE CLASS ====================

/**
 * Abstract base class for all citation formatters.
 * Subclasses implement the three core formatting methods.
 *
 * Usage:
 *   const fmt = getCitationFormatter('ISNAD')
 *   const fn  = fmt.formatFootnoteFirst(entry, '45', '2')
 *   const bib = fmt.formatBibliography(entry)
 */
export abstract class CitationFormatter {
  /**
   * Format the first (full) footnote citation for an entry.
   * @param entry   The bibliography entry
   * @param page    Specific page being cited (e.g. "45" or "45-48")
   * @param volume  Specific volume being cited (e.g. "2")
   */
  abstract formatFootnoteFirst(
    entry: BibliographyEntry,
    page?: string,
    volume?: string
  ): string

  /**
   * Format a subsequent (shortened) footnote citation for an entry.
   * @param entry   The bibliography entry
   * @param page    Specific page being cited
   * @param volume  Specific volume being cited
   */
  abstract formatFootnoteSubsequent(
    entry: BibliographyEntry,
    page?: string,
    volume?: string
  ): string

  /**
   * Format the bibliography / works-cited entry.
   * @param entry The bibliography entry
   */
  abstract formatBibliography(entry: BibliographyEntry): string

  /**
   * Convenience method: returns both first and subsequent footnote strings.
   */
  formatFootnote(
    entry: BibliographyEntry,
    isFirst: boolean,
    page?: string,
    volume?: string
  ): FootnoteFormat {
    return {
      first: this.formatFootnoteFirst(entry, page, volume),
      subsequent: this.formatFootnoteSubsequent(entry, page, volume),
    }
  }

  /**
   * Convenience method: returns the bibliography entry with a computed sort key.
   */
  formatBibliographyEntry(entry: BibliographyEntry): BibliographyFormat {
    const raw = this.formatBibliography(entry)
    const sortKey = this.computeSortKey(entry)
    return { entry: raw, sortKey }
  }

  /**
   * Computes an alphabetical sort key for the entry.
   * Strips leading Arabic/Turkish articles (el-, er-, al-) for correct sorting.
   */
  protected computeSortKey(entry: BibliographyEntry): string {
    const base = `${entry.authorSurname} ${entry.authorName ?? ''} ${entry.title}`
    return base
      .replace(/^(el-|er-|al-|El-|Er-|Al-)/i, '')
      .toLowerCase()
      .trim()
  }

  /**
   * Sorts an array of formatted bibliography strings alphabetically,
   * ignoring leading articles.
   */
  static sortBibliography(entries: BibliographyFormat[]): BibliographyFormat[] {
    return [...entries].sort((a, b) => a.sortKey.localeCompare(b.sortKey, 'tr'))
  }
}

// ==================== FACTORY ====================

/**
 * Returns the appropriate CitationFormatter for the given format.
 *
 * Usage:
 *   import { getCitationFormatter } from '@/lib/citations/formatter'
 *   const fmt = getCitationFormatter('ISNAD')
 */
export function getCitationFormatter(format: CitationFormat): CitationFormatter {
  switch (format) {
    case 'ISNAD': {
      // Lazy import to avoid circular deps and allow tree-shaking
      const { ISNADFormatter } = require('./isnad') as {
        ISNADFormatter: new () => CitationFormatter
      }
      return new ISNADFormatter()
    }
    case 'APA': {
      const { APAFormatter } = require('./apa') as {
        APAFormatter: new () => CitationFormatter
      }
      return new APAFormatter()
    }
    case 'CHICAGO': {
      const { ChicagoFormatter } = require('./chicago') as {
        ChicagoFormatter: new () => CitationFormatter
      }
      return new ChicagoFormatter()
    }
    case 'MLA': {
      const { MLAFormatter } = require('./mla') as {
        MLAFormatter: new () => CitationFormatter
      }
      return new MLAFormatter()
    }
    case 'HARVARD': {
      const { HarvardFormatter } = require('./harvard') as {
        HarvardFormatter: new () => CitationFormatter
      }
      return new HarvardFormatter()
    }
    case 'VANCOUVER': {
      const { VancouverFormatter } = require('./vancouver') as {
        VancouverFormatter: new () => CitationFormatter
      }
      return new VancouverFormatter()
    }
    case 'IEEE': {
      const { IEEEFormatter } = require('./ieee') as {
        IEEEFormatter: new () => CitationFormatter
      }
      return new IEEEFormatter()
    }
    case 'AMA': {
      const { AMAFormatter } = require('./ama') as {
        AMAFormatter: new () => CitationFormatter
      }
      return new AMAFormatter()
    }
    case 'TURABIAN': {
      const { TurabianFormatter } = require('./turabian') as {
        TurabianFormatter: new () => CitationFormatter
      }
      return new TurabianFormatter()
    }
    default: {
      const _exhaustive: never = format
      throw new Error(`Unknown citation format: ${String(_exhaustive)}`)
    }
  }
}

// ==================== FALLBACK ====================

class FallbackFormatter extends CitationFormatter {
  constructor(private readonly formatName: string) {
    super()
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
