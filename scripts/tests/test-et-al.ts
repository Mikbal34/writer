/**
 * Verifies the per-format et al. truncation. Builds 1-author, 3-author,
 * 6-author, 7-author, 25-author bibliography entries and prints how
 * each formatter renders the author list in the bibliography string.
 *
 *   npx tsx scripts/test-et-al.ts
 */

import { getCitationFormatter } from '../../src/lib/citations/formatter'
import type { BibliographyEntry } from '../../src/types/bibliography'
import type { CitationFormat } from '@prisma/client'

function makeEntry(authorCount: number): BibliographyEntry {
  const all = Array.from({ length: authorCount }, (_, i) => ({
    surname: `Author${i + 1}`,
    name: `First${i + 1}`,
  }))
  const [first, ...rest] = all
  return {
    id: `bib-${authorCount}`,
    projectId: 'p1',
    sourceId: null,
    entryType: 'makale' as never,
    authorSurname: first.surname,
    authorName: first.name,
    coAuthors: rest,
    title: 'Sample Paper Title',
    shortTitle: null,
    editor: null,
    translator: null,
    publisher: 'Test Press',
    publishPlace: 'Test City',
    year: '2024',
    volume: null,
    edition: null,
    journalName: 'Journal of Tests',
    journalVolume: '10',
    journalIssue: '2',
    pageRange: '1-10',
    doi: null,
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
  } as never
}

const FORMATS: CitationFormat[] = ['APA', 'VANCOUVER', 'AMA', 'IEEE']
const COUNTS = [1, 3, 6, 7, 25]

console.log('='.repeat(78))
console.log('ET AL. TRUNCATION TEST  —  per-format author list rendering')
console.log('='.repeat(78))

for (const format of FORMATS) {
  const formatter = getCitationFormatter(format)
  console.log(`\n## ${format}`)
  for (const count of COUNTS) {
    const entry = makeEntry(count)
    const output = formatter.formatBibliography(entry)
    // Just show the author portion (first sentence-ish) — strip from
    // first ". " or first "(" to keep the line compact.
    const authorPortion = output.split(/(?:\.\s|\()/)[0].trim()
    console.log(`  ${String(count).padStart(2)} authors: ${authorPortion}`)
  }
}
