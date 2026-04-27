/**
 * End-to-end test for the [cite:bibId,p=N] → inline citation pipeline.
 * Builds mock bibliography entries and content with cite markers, runs
 * resolveInlineCitations for every format, prints the resolved output.
 *
 *   npx tsx scripts/test-inline-citations.ts
 */

import { getCitationFormatter } from '../../src/lib/citations/formatter'
import { resolveInlineCitations, createResolverState } from '../../src/lib/citations/inline-resolver'
import type { BibliographyEntry } from '../../src/types/bibliography'
import type { CitationFormat } from '@prisma/client'

const ENTRIES: BibliographyEntry[] = [
  {
    id: 'bib-smith-2020',
    projectId: 'p1',
    sourceId: null,
    entryType: 'makale' as never,
    authorSurname: 'Smith',
    authorName: 'John A.',
    title: 'A Comprehensive Review of Test Methodology',
    shortTitle: 'Test Methodology Review',
    editor: null,
    translator: null,
    publisher: null,
    publishPlace: null,
    year: '2020',
    volume: null,
    edition: null,
    journalName: 'Journal of Examples',
    journalVolume: '15',
    journalIssue: '3',
    pageRange: '45-67',
    doi: '10.1234/joe.2020.45',
    url: null,
    isbn: null,
    issn: null,
    notes: null,
    bibtexKey: null,
    bibtexRaw: null,
    libraryEntryId: null,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never,
  {
    id: 'bib-yilmaz-2021',
    projectId: 'p1',
    sourceId: null,
    entryType: 'kitap' as never,
    authorSurname: 'Yılmaz',
    authorName: 'Ahmet',
    title: 'Türkiye\'de Akademik Yayıncılık',
    shortTitle: null,
    editor: null,
    translator: null,
    publisher: 'Nobel Akademik',
    publishPlace: 'Ankara',
    year: '2021',
    volume: null,
    edition: '2',
    journalName: null,
    journalVolume: null,
    journalIssue: null,
    pageRange: null,
    doi: null,
    url: null,
    isbn: null,
    issn: null,
    notes: null,
    bibtexKey: null,
    bibtexRaw: null,
    libraryEntryId: null,
    sortOrder: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never,
]

const SAMPLE_BODY = `
According to recent research [cite:bib-smith-2020,p=52], the effect is significant.
Other authors [cite:bib-yilmaz-2021] disagree.
Smith's main argument [cite:bib-smith-2020,pp=55-60] is illustrative.
`

const FORMATS: CitationFormat[] = [
  'APA', 'MLA', 'CHICAGO', 'TURABIAN', 'HARVARD',
  'IEEE', 'VANCOUVER', 'AMA', 'ISNAD',
]

console.log('='.repeat(70))
console.log('INLINE CITATION PIPELINE TEST')
console.log('='.repeat(70))
console.log('Source content:')
console.log(SAMPLE_BODY.trim())
console.log()

for (const format of FORMATS) {
  const formatter = getCitationFormatter(format)
  const state = createResolverState()
  const resolved = resolveInlineCitations(SAMPLE_BODY, ENTRIES, formatter, state)
  console.log(`-- ${format} (inlineStyle: ${formatter.inlineStyle}) --`)
  console.log(resolved.trim())
  console.log()
}
