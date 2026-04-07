/**
 * Academic Search Service
 *
 * Searches multiple academic databases for source discovery.
 * - OpenAlex: Primary search (250M+ works)
 * - Semantic Scholar: Paper detail + PDF
 * - CrossRef: Metadata enrichment via DOI
 * - Google Books: Book metadata
 */

const POLITE_EMAIL = process.env.UNPAYWALL_EMAIL || 'quilpen@example.com'

// ─── Types ───────────────────────────────────────────────────

export interface AcademicSearchResult {
  externalId: string
  provider: 'openalex' | 'semantic_scholar' | 'crossref' | 'google_books'
  title: string
  authorSurname: string
  authorName: string | null
  authors: string[]
  year: string | null
  publisher: string | null
  journalName: string | null
  journalVolume: string | null
  journalIssue: string | null
  pageRange: string | null
  doi: string | null
  url: string | null
  abstract: string | null
  citationCount: number | null
  entryType: string // kitap, makale, tez, etc.
  openAccessUrl: string | null
  alreadyInLibrary?: boolean
}

export interface SearchParams {
  query: string
  providers?: string[]
  type?: string
  yearFrom?: number
  yearTo?: number
  page?: number
  limit?: number
}

// ─── Helpers ─────────────────────────────────────────────────

function splitAuthorName(fullName: string): { surname: string; firstName: string | null } {
  if (!fullName) return { surname: 'Unknown', firstName: null }

  // Handle "Surname, FirstName" format
  if (fullName.includes(',')) {
    const [surname, ...rest] = fullName.split(',')
    return { surname: surname.trim(), firstName: rest.join(',').trim() || null }
  }

  // Handle "FirstName Surname" format
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 1) return { surname: parts[0], firstName: null }
  const surname = parts[parts.length - 1]
  const firstName = parts.slice(0, -1).join(' ')
  return { surname, firstName }
}

function mapWorkType(type: string): string {
  const typeMap: Record<string, string> = {
    // OpenAlex types
    article: 'makale',
    'journal-article': 'makale',
    book: 'kitap',
    'book-chapter': 'kitap',
    'book-section': 'kitap',
    dissertation: 'tez',
    thesis: 'tez',
    review: 'makale',
    preprint: 'makale',
    // Semantic Scholar types
    JournalArticle: 'makale',
    Conference: 'makale',
    Book: 'kitap',
    BookSection: 'kitap',
    // CrossRef types
    'proceedings-article': 'makale',
    'posted-content': 'makale',
    monograph: 'kitap',
    // Google Books
    BOOK: 'kitap',
  }
  return typeMap[type] || 'makale'
}

// ─── OpenAlex ────────────────────────────────────────────────

async function searchOpenAlex(params: SearchParams): Promise<AcademicSearchResult[]> {
  const { query, type, yearFrom, yearTo, page = 1, limit = 10 } = params
  const results: AcademicSearchResult[] = []

  try {
    const filters: string[] = []
    if (type) {
      const openAlexType = type === 'kitap' ? 'book' : type === 'tez' ? 'dissertation' : 'article'
      filters.push(`type:${openAlexType}`)
    }
    if (yearFrom) filters.push(`from_publication_date:${yearFrom}-01-01`)
    if (yearTo) filters.push(`to_publication_date:${yearTo}-12-31`)

    let url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per_page=${limit}&page=${page}`
    if (filters.length > 0) url += `&filter=${filters.join(',')}`

    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': `Quilpen/1.0 (mailto:${POLITE_EMAIL})` },
    })
    if (!res.ok) return results

    const data = await res.json()

    for (const work of data.results ?? []) {
      const primaryAuthor = work.authorships?.[0]?.author?.display_name
      const { surname, firstName } = splitAuthorName(primaryAuthor || 'Unknown')

      results.push({
        externalId: work.id || '',
        provider: 'openalex',
        title: work.title || 'Untitled',
        authorSurname: surname,
        authorName: firstName,
        authors: (work.authorships || []).map(
          (a: { author?: { display_name?: string } }) => a.author?.display_name || ''
        ),
        year: work.publication_year?.toString() || null,
        publisher: work.primary_location?.source?.host_organization_name || null,
        journalName: work.primary_location?.source?.display_name || null,
        journalVolume: work.biblio?.volume || null,
        journalIssue: work.biblio?.issue || null,
        pageRange:
          work.biblio?.first_page && work.biblio?.last_page
            ? `${work.biblio.first_page}-${work.biblio.last_page}`
            : work.biblio?.first_page || null,
        doi: work.doi?.replace('https://doi.org/', '') || null,
        url: work.doi || work.primary_location?.landing_page_url || null,
        abstract: work.abstract_inverted_index
          ? reconstructAbstract(work.abstract_inverted_index)
          : null,
        citationCount: work.cited_by_count ?? null,
        entryType: mapWorkType(work.type || ''),
        openAccessUrl: work.open_access?.oa_url || null,
      })
    }
  } catch {
    // timeout or network error
  }

  return results
}

/** OpenAlex stores abstracts as inverted index — reconstruct to text */
function reconstructAbstract(invertedIndex: Record<string, number[]>): string {
  if (!invertedIndex || typeof invertedIndex !== 'object') return ''
  const words: Array<[number, string]> = []
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      words.push([pos, word])
    }
  }
  words.sort((a, b) => a[0] - b[0])
  return words.map(([, w]) => w).join(' ')
}

// ─── Semantic Scholar ────────────────────────────────────────

async function searchSemanticScholar(params: SearchParams): Promise<AcademicSearchResult[]> {
  const { query, yearFrom, yearTo, page = 1, limit = 10 } = params
  const results: AcademicSearchResult[] = []

  try {
    const offset = (page - 1) * limit
    let url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&offset=${offset}&limit=${limit}&fields=title,authors,year,venue,externalIds,openAccessPdf,citationCount,abstract,publicationTypes`

    if (yearFrom || yearTo) {
      const from = yearFrom || 1900
      const to = yearTo || new Date().getFullYear()
      url += `&year=${from}-${to}`
    }

    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return results

    const data = await res.json()

    for (const paper of data.data ?? []) {
      const primaryAuthor = paper.authors?.[0]?.name
      const { surname, firstName } = splitAuthorName(primaryAuthor || 'Unknown')

      const doi = paper.externalIds?.DOI || null
      const pubTypes = paper.publicationTypes || []

      results.push({
        externalId: paper.paperId || '',
        provider: 'semantic_scholar',
        title: paper.title || 'Untitled',
        authorSurname: surname,
        authorName: firstName,
        authors: (paper.authors || []).map((a: { name?: string }) => a.name || ''),
        year: paper.year?.toString() || null,
        publisher: null,
        journalName: paper.venue || null,
        journalVolume: null,
        journalIssue: null,
        pageRange: null,
        doi,
        url: doi ? `https://doi.org/${doi}` : `https://www.semanticscholar.org/paper/${paper.paperId}`,
        abstract: paper.abstract || null,
        citationCount: paper.citationCount ?? null,
        entryType: pubTypes.includes('Book')
          ? 'kitap'
          : pubTypes.includes('JournalArticle')
          ? 'makale'
          : 'makale',
        openAccessUrl: paper.openAccessPdf?.url || null,
      })
    }
  } catch {
    // timeout or network error
  }

  return results
}

// ─── CrossRef ────────────────────────────────────────────────

async function searchCrossRef(params: SearchParams): Promise<AcademicSearchResult[]> {
  const { query, type, yearFrom, yearTo, page = 1, limit = 10 } = params
  const results: AcademicSearchResult[] = []

  try {
    const offset = (page - 1) * limit
    let url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${limit}&offset=${offset}&mailto=${POLITE_EMAIL}`

    const filters: string[] = []
    if (type) {
      const crType = type === 'kitap' ? 'book' : type === 'tez' ? 'dissertation' : 'journal-article'
      filters.push(`type:${crType}`)
    }
    if (yearFrom) filters.push(`from-pub-date:${yearFrom}`)
    if (yearTo) filters.push(`until-pub-date:${yearTo}`)
    if (filters.length > 0) url += `&filter=${filters.join(',')}`

    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return results

    const data = await res.json()

    for (const item of data.message?.items ?? []) {
      const firstAuthor = item.author?.[0]
      const surname = firstAuthor?.family || 'Unknown'
      const firstName = firstAuthor?.given || null

      const pubYear = item['published-print']?.['date-parts']?.[0]?.[0] ||
        item['published-online']?.['date-parts']?.[0]?.[0] ||
        item['created']?.['date-parts']?.[0]?.[0]

      results.push({
        externalId: item.DOI || '',
        provider: 'crossref',
        title: item.title?.[0] || 'Untitled',
        authorSurname: surname,
        authorName: firstName,
        authors: (item.author || []).map(
          (a: { given?: string; family?: string }) =>
            [a.given, a.family].filter(Boolean).join(' ')
        ),
        year: pubYear?.toString() || null,
        publisher: item.publisher || null,
        journalName: item['container-title']?.[0] || null,
        journalVolume: item.volume || null,
        journalIssue: item.issue || null,
        pageRange: item.page || null,
        doi: item.DOI || null,
        url: item.DOI ? `https://doi.org/${item.DOI}` : item.URL || null,
        abstract: item.abstract?.replace(/<[^>]*>/g, '') || null, // strip HTML
        citationCount: item['is-referenced-by-count'] ?? null,
        entryType: mapWorkType(item.type || ''),
        openAccessUrl: null, // CrossRef doesn't provide OA links
      })
    }
  } catch {
    // timeout or network error
  }

  return results
}

// ─── Google Books ────────────────────────────────────────────

async function searchGoogleBooks(params: SearchParams): Promise<AcademicSearchResult[]> {
  const { query, page = 1, limit = 10 } = params
  const results: AcademicSearchResult[] = []

  try {
    const startIndex = (page - 1) * limit
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&startIndex=${startIndex}&maxResults=${limit}`

    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return results

    const data = await res.json()

    for (const item of data.items ?? []) {
      const info = item.volumeInfo || {}
      const primaryAuthor = info.authors?.[0]
      const { surname, firstName } = splitAuthorName(primaryAuthor || 'Unknown')

      const isbn13 = info.industryIdentifiers?.find(
        (id: { type: string }) => id.type === 'ISBN_13'
      )?.identifier
      const isbn10 = info.industryIdentifiers?.find(
        (id: { type: string }) => id.type === 'ISBN_10'
      )?.identifier

      results.push({
        externalId: item.id || '',
        provider: 'google_books',
        title: info.title || 'Untitled',
        authorSurname: surname,
        authorName: firstName,
        authors: info.authors || [],
        year: info.publishedDate?.slice(0, 4) || null,
        publisher: info.publisher || null,
        journalName: null,
        journalVolume: null,
        journalIssue: null,
        pageRange: info.pageCount ? `1-${info.pageCount}` : null,
        doi: null,
        url: info.infoLink || isbn13 || isbn10 || null,
        abstract: info.description || null,
        citationCount: null,
        entryType: 'kitap',
        openAccessUrl: null,
      })
    }
  } catch {
    // timeout or network error
  }

  return results
}

// ─── Unified search ──────────────────────────────────────────

const PROVIDER_MAP: Record<string, (params: SearchParams) => Promise<AcademicSearchResult[]>> = {
  openalex: searchOpenAlex,
  semantic_scholar: searchSemanticScholar,
  crossref: searchCrossRef,
  google_books: searchGoogleBooks,
}

/**
 * Search across multiple academic databases.
 * Returns merged, deduplicated results.
 */
export async function searchAcademic(params: SearchParams): Promise<{
  results: AcademicSearchResult[]
  providers: string[]
}> {
  const providers = params.providers?.length
    ? params.providers
    : Object.keys(PROVIDER_MAP)

  const searches = providers
    .filter((p) => PROVIDER_MAP[p])
    .map((p) => PROVIDER_MAP[p](params))

  const settled = await Promise.allSettled(searches)

  const allResults: AcademicSearchResult[] = []
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      allResults.push(...r.value)
    }
  }

  // Deduplicate by DOI or title+author
  const seen = new Map<string, boolean>()
  const deduplicated: AcademicSearchResult[] = []

  for (const result of allResults) {
    const doiKey = result.doi?.toLowerCase()
    const titleKey = `${result.title.toLowerCase().slice(0, 60)}|${result.authorSurname.toLowerCase()}`

    if (doiKey && seen.has(doiKey)) continue
    if (seen.has(titleKey)) continue

    if (doiKey) seen.set(doiKey, true)
    seen.set(titleKey, true)
    deduplicated.push(result)
  }

  return { results: deduplicated, providers }
}

/**
 * Map an AcademicSearchResult to the shape expected by the library/bibliography API.
 */
export function mapResultToLibraryData(result: AcademicSearchResult) {
  return {
    entryType: result.entryType,
    authorSurname: result.authorSurname,
    authorName: result.authorName || '',
    title: result.title,
    publisher: result.publisher || '',
    publishPlace: '',
    year: result.year || '',
    volume: '',
    edition: '',
    journalName: result.journalName || '',
    journalVolume: result.journalVolume || '',
    journalIssue: result.journalIssue || '',
    pageRange: result.pageRange || '',
    doi: result.doi || '',
    url: result.url || '',
    importSource: 'research',
  }
}
