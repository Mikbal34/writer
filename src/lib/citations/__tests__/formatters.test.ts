/**
 * Snapshot tests for all 9 citation formatters × 7 entry types.
 *
 * Purpose: pin formatter output so spec-compliance regressions surface
 * immediately. Snapshots are stored under __snapshots__/ and committed.
 * Update with `vitest --update` only after verifying the new output
 * against the format's official spec.
 */

import { describe, it, expect } from 'vitest'
import type { CitationFormat } from '@prisma/client'
import { getCitationFormatter } from '../formatter'
import { CITATION_EXAMPLES } from '../examples'

const FORMATS: CitationFormat[] = [
  'APA',
  'MLA',
  'CHICAGO',
  'HARVARD',
  'IEEE',
  'VANCOUVER',
  'AMA',
  'TURABIAN',
  'ISNAD',
]

describe('bibliography output × entry type', () => {
  for (const format of FORMATS) {
    describe(format, () => {
      const formatter = getCitationFormatter(format)

      for (const entry of CITATION_EXAMPLES) {
        it(`${entry.entryType} — ${entry.authorSurname}`, () => {
          const output = formatter.formatBibliographyEntry(entry).entry
          expect(output).toMatchSnapshot()
        })
      }
    })
  }
})

describe('footnote (first) output × entry type', () => {
  for (const format of FORMATS) {
    describe(format, () => {
      const formatter = getCitationFormatter(format)

      for (const entry of CITATION_EXAMPLES) {
        it(`${entry.entryType} — ${entry.authorSurname}`, () => {
          const output = formatter.formatFootnoteFirst(entry, '45')
          expect(output).toMatchSnapshot()
        })
      }
    })
  }
})

describe('footnote (subsequent) output × entry type', () => {
  for (const format of FORMATS) {
    describe(format, () => {
      const formatter = getCitationFormatter(format)

      for (const entry of CITATION_EXAMPLES) {
        it(`${entry.entryType} — ${entry.authorSurname}`, () => {
          const output = formatter.formatFootnoteSubsequent(entry, '45')
          expect(output).toMatchSnapshot()
        })
      }
    })
  }
})

describe('inline output × entry type', () => {
  for (const format of FORMATS) {
    describe(format, () => {
      const formatter = getCitationFormatter(format)

      for (const entry of CITATION_EXAMPLES) {
        it(`${entry.entryType} — ${entry.authorSurname}`, () => {
          const output = formatter.formatInline(entry, '45', undefined, 1)
          expect(output).toMatchSnapshot()
        })
      }
    })
  }
})
