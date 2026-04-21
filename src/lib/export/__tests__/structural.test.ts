/**
 * Snapshot + behavior tests for per-format structural specs. These lock
 * down the labels, layout decisions, and helper outputs so accidental
 * regressions surface immediately.
 */

import { describe, it, expect } from 'vitest'
import type { CitationFormat } from '@prisma/client'
import {
  STRUCTURAL_SPECS,
  getStructuralSpec,
  toRoman,
  formatChapterNumber,
} from '../structural-specs'

const FORMATS: CitationFormat[] = [
  'APA', 'MLA', 'CHICAGO', 'HARVARD', 'IEEE',
  'VANCOUVER', 'AMA', 'TURABIAN', 'ISNAD',
]

describe('structural spec coverage', () => {
  it('defines a spec for every format', () => {
    for (const fmt of FORMATS) {
      expect(STRUCTURAL_SPECS[fmt]).toBeDefined()
    }
  })
})

describe('bibliography label', () => {
  const expected: Record<CitationFormat, string> = {
    APA: 'References',
    MLA: 'Works Cited',
    CHICAGO: 'Bibliography',
    HARVARD: 'References',
    IEEE: 'References',       // rendered UPPERCASE at render-time
    VANCOUVER: 'References',
    AMA: 'References',
    TURABIAN: 'Bibliography',
    ISNAD: 'KAYNAKÇA',
  }
  for (const fmt of FORMATS) {
    it(`${fmt}: "${expected[fmt]}"`, () => {
      expect(getStructuralSpec(fmt).bibliography.label).toBe(expected[fmt])
    })
  }
  it('IEEE uppercases at render time', () => {
    expect(getStructuralSpec('IEEE').bibliography.labelUppercase).toBe(true)
  })
  it('ISNAD is pre-uppercased in the label', () => {
    expect(getStructuralSpec('ISNAD').bibliography.label).toBe('KAYNAKÇA')
  })
})

describe('title page', () => {
  it('MLA has no separate title page', () => {
    expect(getStructuralSpec('MLA').titlePage.enabled).toBe(false)
  })
  it('other academic-heavy formats emit a title page', () => {
    for (const fmt of ['APA', 'CHICAGO', 'TURABIAN', 'HARVARD', 'ISNAD'] as const) {
      expect(getStructuralSpec(fmt).titlePage.enabled).toBe(true)
    }
  })
  it('ISNAD starts with the T.C. header group', () => {
    expect(getStructuralSpec('ISNAD').titlePage.groups[0]).toEqual(['institution_tr_header'])
  })
})

describe('abstract', () => {
  it('ISNAD demands dual-language abstracts', () => {
    expect(getStructuralSpec('ISNAD').abstract.dualLanguage).toBe(true)
    expect(getStructuralSpec('ISNAD').abstract.label).toBe('ÖZET')
  })
  it('Vancouver uses a structured abstract (Background/Methods/Results/Conclusions)', () => {
    const spec = getStructuralSpec('VANCOUVER').abstract
    expect(spec.structured).toBe(true)
    expect(spec.structuredSections).toEqual(['Background', 'Methods', 'Results', 'Conclusions'])
  })
  it('AMA uses the JAMA structured abstract (9 sections)', () => {
    const spec = getStructuralSpec('AMA').abstract
    expect(spec.structured).toBe(true)
    expect(spec.structuredSections?.length).toBe(9)
    expect(spec.structuredSections?.[0]).toBe('Importance')
  })
  it('IEEE uses "Index Terms" instead of "Keywords"', () => {
    expect(getStructuralSpec('IEEE').abstract.keywordsLabel).toBe('Index Terms')
  })
})

describe('table of contents', () => {
  it('APA/MLA default TOC off; Chicago/Turabian/ISNAD/Harvard default on', () => {
    expect(getStructuralSpec('APA').toc.enabled).toBe(false)
    expect(getStructuralSpec('MLA').toc.enabled).toBe(false)
    expect(getStructuralSpec('CHICAGO').toc.enabled).toBe(true)
    expect(getStructuralSpec('TURABIAN').toc.enabled).toBe(true)
    expect(getStructuralSpec('ISNAD').toc.enabled).toBe(true)
    expect(getStructuralSpec('HARVARD').toc.enabled).toBe(true)
  })
  it('ISNAD TOC is uppercase and includes subsections', () => {
    const spec = getStructuralSpec('ISNAD').toc
    expect(spec.label).toBe('İÇİNDEKİLER')
    expect(spec.labelUppercase).toBe(true)
    expect(spec.includeSubsections).toBe(true)
    expect(spec.dotLeaders).toBe(true)
  })
})

describe('pagination', () => {
  it('Chicago/Turabian/ISNAD/Harvard use lower-roman front matter', () => {
    for (const fmt of ['CHICAGO', 'TURABIAN', 'ISNAD', 'HARVARD'] as const) {
      expect(getStructuralSpec(fmt).pagination.frontMatter).toBe('lower-roman')
      expect(getStructuralSpec(fmt).pagination.body).toBe('arabic')
    }
  })
  it('APA/MLA/IEEE/Vancouver/AMA use arabic throughout', () => {
    for (const fmt of ['APA', 'MLA', 'IEEE', 'VANCOUVER', 'AMA'] as const) {
      expect(getStructuralSpec(fmt).pagination.frontMatter).toBe('arabic')
    }
  })
})

describe('running head', () => {
  it('APA student = page-only top-right', () => {
    const r = getStructuralSpec('APA').runningHead
    expect(r.enabled).toBe(true)
    expect(r.content).toBe('page-only')
    expect(r.position).toBe('top-right')
  })
  it('MLA = "Surname Page" top-right', () => {
    expect(getStructuralSpec('MLA').runningHead.content).toBe('surname-page')
  })
  it('Chicago/Turabian/ISNAD = no running head', () => {
    for (const fmt of ['CHICAGO', 'TURABIAN', 'ISNAD'] as const) {
      expect(getStructuralSpec(fmt).runningHead.enabled).toBe(false)
    }
  })
})

describe('chapter opening', () => {
  it('ISNAD = ordinal Turkish uppercase ("BİRİNCİ BÖLÜM")', () => {
    expect(formatChapterNumber(1, 'ordinal-tr-upper', false)).toBe('BİRİNCİ BÖLÜM')
    expect(formatChapterNumber(2, 'ordinal-tr-upper', false)).toBe('İKİNCİ BÖLÜM')
  })
  it('Chicago/APA = "Chapter N"', () => {
    expect(formatChapterNumber(3, 'chapter-en', false)).toBe('Chapter 3')
  })
  it('IEEE = Roman', () => {
    expect(formatChapterNumber(1, 'roman-intro', true)).toBe('I')
    expect(formatChapterNumber(4, 'roman-intro', true)).toBe('IV')
  })
})

describe('toRoman', () => {
  it('handles 1-30 correctly', () => {
    expect(toRoman(1)).toBe('i')
    expect(toRoman(4)).toBe('iv')
    expect(toRoman(9)).toBe('ix')
    expect(toRoman(14)).toBe('xiv')
    expect(toRoman(29)).toBe('xxix')
  })
  it('uppercases when requested', () => {
    expect(toRoman(7, true)).toBe('VII')
  })
})
