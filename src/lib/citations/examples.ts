/**
 * Sample bibliography entries covering every EntryType the project supports.
 *
 * These are used by the citation picker UI to render live previews without
 * needing any real project data, and by regression tests to pin formatter
 * output down to the comma.
 *
 * Keep these realistic and diverse (journals, edited volumes, theses, web,
 * translations, encyclopedia articles). A user should be able to look at the
 * preview and say "yep, that's what my paper's going to look like."
 */

import type { BibliographyEntry } from '@/types/bibliography'

const NOW = new Date('2024-01-15T00:00:00Z')

function build(partial: Partial<BibliographyEntry> & Pick<BibliographyEntry, 'entryType' | 'authorSurname' | 'title'>): BibliographyEntry {
  return {
    id: `example-${partial.entryType}-${partial.authorSurname.toLowerCase()}`,
    projectId: 'example',
    sourceId: null,
    authorName: null,
    shortTitle: null,
    editor: null,
    translator: null,
    publisher: null,
    publishPlace: null,
    year: null,
    volume: null,
    edition: null,
    journalName: null,
    journalVolume: null,
    journalIssue: null,
    pageRange: null,
    doi: null,
    url: null,
    metadata: null,
    createdAt: NOW,
    ...partial,
  }
}

/** A scholarly monograph. */
export const EXAMPLE_BOOK: BibliographyEntry = build({
  entryType: 'kitap',
  authorSurname: 'Smith',
  authorName: 'John A.',
  title: 'The Theory of Everything',
  shortTitle: 'Theory of Everything',
  publisher: 'Oxford University Press',
  publishPlace: 'Oxford',
  year: '2020',
  edition: '2',
})

/** A journal article — author-date and numeric formats shine here. */
export const EXAMPLE_ARTICLE: BibliographyEntry = build({
  entryType: 'makale',
  authorSurname: 'Johnson',
  authorName: 'Emily R.',
  title: 'A New Approach to Quantum Cognition',
  journalName: 'Journal of Cognitive Science',
  journalVolume: '45',
  journalIssue: '3',
  pageRange: '127-152',
  year: '2021',
  doi: '10.1234/jcs.2021.045',
})

/** A translated work — ISNAD/Chicago/MLA vary noticeably. */
export const EXAMPLE_TRANSLATION: BibliographyEntry = build({
  entryType: 'ceviri',
  authorSurname: 'Kant',
  authorName: 'Immanuel',
  title: 'Critique of Pure Reason',
  shortTitle: 'Critique',
  translator: 'Paul Guyer',
  publisher: 'Cambridge University Press',
  publishPlace: 'Cambridge',
  year: '1998',
})

/** A doctoral dissertation. */
export const EXAMPLE_THESIS: BibliographyEntry = build({
  entryType: 'tez',
  authorSurname: 'Yılmaz',
  authorName: 'Ayşe',
  title: 'Metin Üretiminde Büyük Dil Modelleri',
  publisher: 'Boğaziçi Üniversitesi',
  publishPlace: 'İstanbul',
  year: '2023',
  metadata: { degree: 'PhD' },
})

/** An encyclopedia article. */
export const EXAMPLE_ENCYCLOPEDIA: BibliographyEntry = build({
  entryType: 'ansiklopedi',
  authorSurname: 'Doe',
  authorName: 'Jane',
  title: 'Heuristic',
  shortTitle: 'Heuristic',
  editor: 'Richard Roe',
  publisher: 'Encyclopedia of Philosophy',
  publishPlace: 'New York',
  year: '2019',
  volume: '4',
  pageRange: '312-318',
})

/** A classical prose / literary source — common in humanities. */
export const EXAMPLE_PROSE: BibliographyEntry = build({
  entryType: 'nesir',
  authorSurname: 'Dostoyevski',
  authorName: 'Fyodor',
  title: 'Suç ve Ceza',
  translator: 'Sabri Gürses',
  publisher: 'Can Yayınları',
  publishPlace: 'İstanbul',
  year: '2019',
})

/** A web source. */
export const EXAMPLE_WEB: BibliographyEntry = build({
  entryType: 'web',
  authorSurname: 'Brown',
  authorName: 'Michael',
  title: 'Climate Change in 2024: A Primer',
  url: 'https://www.example.org/climate-2024',
  year: '2024',
  publisher: 'Example News',
})

/**
 * Ordered set used by the preview UI.
 * Order is deliberate: book and article first (most common), then the
 * tricky cases (translation, thesis, encyclopedia) to showcase format
 * differences, web last.
 */
export const CITATION_EXAMPLES: BibliographyEntry[] = [
  EXAMPLE_BOOK,
  EXAMPLE_ARTICLE,
  EXAMPLE_TRANSLATION,
  EXAMPLE_THESIS,
  EXAMPLE_ENCYCLOPEDIA,
  EXAMPLE_PROSE,
  EXAMPLE_WEB,
]
