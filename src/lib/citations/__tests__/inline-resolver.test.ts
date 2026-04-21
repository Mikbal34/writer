/**
 * Tests for [cite:bibId,p=N] marker resolution across all 9 formats.
 */

import { describe, it, expect } from 'vitest'
import type { CitationFormat } from '@prisma/client'
import { getCitationFormatter } from '../formatter'
import {
  createResolverState,
  resolveInlineCitations,
  orderEntriesForBibliography,
} from '../inline-resolver'
import { EXAMPLE_BOOK, EXAMPLE_ARTICLE, EXAMPLE_WEB } from '../examples'

// Use the example entries but ensure stable IDs matching what the
// resolver looks up.
const E_BOOK = { ...EXAMPLE_BOOK, id: 'bk1' }
const E_ART = { ...EXAMPLE_ARTICLE, id: 'ar1' }
const E_WEB = { ...EXAMPLE_WEB, id: 'wb1' }
const ALL = [E_BOOK, E_ART, E_WEB]

describe('resolveInlineCitations — marker parsing', () => {
  const fmt = getCitationFormatter('APA')

  it('no markers → unchanged', () => {
    const s = createResolverState()
    expect(resolveInlineCitations('hello world', ALL, fmt, s)).toBe('hello world')
  })

  it('unknown bibId → marker stays verbatim', () => {
    const s = createResolverState()
    const out = resolveInlineCitations('text [cite:xyz,p=1] end', ALL, fmt, s)
    expect(out).toBe('text [cite:xyz,p=1] end')
  })

  it('APA: replaces with (Surname, Year, p. N)', () => {
    const s = createResolverState()
    const out = resolveInlineCitations('foo [cite:bk1,p=45] bar', ALL, fmt, s)
    expect(out).toBe('foo (Smith, 2020, p. 45) bar')
  })

  it('APA: range uses pp.', () => {
    const s = createResolverState()
    const out = resolveInlineCitations('foo [cite:bk1,pp=45-48]', ALL, fmt, s)
    expect(out).toBe('foo (Smith, 2020, pp. 45-48)')
  })
})

describe('resolveInlineCitations — per format inline style', () => {
  const cases: Array<{ format: CitationFormat; expected: string }> = [
    { format: 'APA', expected: 'x (Smith, 2020, p. 45) y' },
    { format: 'HARVARD', expected: 'x (Smith, 2020, p. 45) y' },
    { format: 'MLA', expected: 'x (Smith 45) y' },
    { format: 'IEEE', expected: 'x [1, p. 45] y' },
    { format: 'VANCOUVER', expected: 'x [1, p. 45] y' },
    { format: 'AMA', expected: 'x [1, p. 45] y' },
  ]
  for (const { format, expected } of cases) {
    it(`${format} inline`, () => {
      const s = createResolverState()
      const fmt = getCitationFormatter(format)
      const out = resolveInlineCitations('x [cite:bk1,p=45] y', ALL, fmt, s)
      expect(out).toBe(expected)
    })
  }

  it('CHICAGO (footnote) emits [fn: …] marker with full footnote', () => {
    const s = createResolverState()
    const fmt = getCitationFormatter('CHICAGO')
    const out = resolveInlineCitations('x [cite:bk1,p=45] y', ALL, fmt, s)
    expect(out).toMatch(/^x \[fn: /)
    expect(out).toMatch(/John A\. Smith/)
    expect(out).toContain('Theory of Everything')
    expect(out).toMatch(/\] y$/)
  })

  it('ISNAD: first citation = full, second citation to same work = short', () => {
    const s = createResolverState()
    const fmt = getCitationFormatter('ISNAD')
    const first = resolveInlineCitations('[cite:bk1,p=45]', ALL, fmt, s)
    const second = resolveInlineCitations('[cite:bk1,p=12]', ALL, fmt, s)
    expect(first.length).toBeGreaterThan(second.length)
    expect(second).toMatch(/Smith/)
    expect(second).toMatch(/12/)
  })
})

describe('numeric numbering is stable across subsections', () => {
  it('same bibId reuses the same number; new bibId increments', () => {
    const s = createResolverState()
    const fmt = getCitationFormatter('IEEE')
    const sub1 = resolveInlineCitations('[cite:bk1,p=45] [cite:ar1,p=10]', ALL, fmt, s)
    const sub2 = resolveInlineCitations('[cite:bk1,p=99] [cite:wb1]', ALL, fmt, s)
    expect(sub1).toContain('[1, p. 45]')
    expect(sub1).toContain('[2, p. 10]')
    expect(sub2).toContain('[1, p. 99]')
    expect(sub2).toContain('[3]')
  })
})

describe('orderEntriesForBibliography', () => {
  it('citation-order: orders by first-appearance, not alphabetical', () => {
    const s = createResolverState()
    const fmt = getCitationFormatter('IEEE')
    resolveInlineCitations('[cite:wb1] [cite:bk1]', ALL, fmt, s)
    const ordered = orderEntriesForBibliography(ALL, fmt, s)
    expect(ordered.map((e) => e.id)).toEqual(['wb1', 'bk1', 'ar1'])
  })

  it('alphabetical format: input order preserved (bibliography sort happens later)', () => {
    const s = createResolverState()
    const fmt = getCitationFormatter('APA')
    resolveInlineCitations('[cite:wb1] [cite:bk1]', ALL, fmt, s)
    const ordered = orderEntriesForBibliography(ALL, fmt, s)
    expect(ordered).toBe(ALL)
  })
})
