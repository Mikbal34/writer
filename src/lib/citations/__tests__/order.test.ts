/**
 * Tests bibliographyOrder and bibliographyPrefix metadata for all 9
 * formatters. These drive the export route's sort/numbering behaviour,
 * so a regression here silently breaks numeric bibliographies.
 */

import { describe, it, expect } from 'vitest'
import type { CitationFormat } from '@prisma/client'
import {
  getCitationFormatter,
  CitationFormatter,
  type BibliographyOrder,
  type BibliographyPrefix,
  type InlineCitationStyle,
} from '../formatter'

interface Expectation {
  order: BibliographyOrder
  prefix: BibliographyPrefix
  inline: InlineCitationStyle
}

const EXPECTED: Record<CitationFormat, Expectation> = {
  APA: { order: 'alphabetical', prefix: null, inline: 'author-date' },
  MLA: { order: 'alphabetical', prefix: null, inline: 'author-page' },
  CHICAGO: { order: 'alphabetical', prefix: null, inline: 'footnote' },
  HARVARD: { order: 'alphabetical', prefix: null, inline: 'author-date' },
  IEEE: { order: 'citation-order', prefix: 'bracket', inline: 'numeric' },
  VANCOUVER: { order: 'citation-order', prefix: 'period', inline: 'numeric' },
  AMA: { order: 'citation-order', prefix: 'period', inline: 'numeric' },
  TURABIAN: { order: 'alphabetical', prefix: null, inline: 'footnote' },
  ISNAD: { order: 'alphabetical', prefix: null, inline: 'footnote' },
}

describe('bibliography ordering and numbering metadata', () => {
  for (const [format, expected] of Object.entries(EXPECTED)) {
    it(`${format}: ${expected.order} / ${expected.prefix ?? 'no prefix'} / ${expected.inline}`, () => {
      const fmt = getCitationFormatter(format as CitationFormat)
      expect(fmt.bibliographyOrder).toBe(expected.order)
      expect(fmt.bibliographyPrefix).toBe(expected.prefix)
      expect(fmt.inlineStyle).toBe(expected.inline)
    })
  }
})

describe('renderPrefix', () => {
  it('bracket format: "[1] "', () => {
    expect(CitationFormatter.renderPrefix(0, 'bracket')).toBe('[1] ')
    expect(CitationFormatter.renderPrefix(9, 'bracket')).toBe('[10] ')
  })
  it('period format: "1. "', () => {
    expect(CitationFormatter.renderPrefix(0, 'period')).toBe('1. ')
    expect(CitationFormatter.renderPrefix(4, 'period')).toBe('5. ')
  })
  it('null prefix: ""', () => {
    expect(CitationFormatter.renderPrefix(0, null)).toBe('')
  })
})
