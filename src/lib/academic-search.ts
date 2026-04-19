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
  provider: 'openalex' | 'semantic_scholar' | 'crossref' | 'google_books' | 'arxiv' | 'pmc' | 'doaj' | 'biorxiv'
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

// ─── arXiv ───────────────────────────────────────────────────
// STEM preprints. Free, no auth. Returns Atom XML. Every result is
// open-access with a direct PDF URL.

async function searchArxiv(params: SearchParams): Promise<AcademicSearchResult[]> {
  const { query, type, yearFrom, yearTo, limit = 10 } = params
  const results: AcademicSearchResult[] = []

  // arXiv is STEM preprints — skip for book searches.
  if (type === 'kitap') return results

  try {
    const search = `all:${encodeURIComponent(query)}`
    const url = `http://export.arxiv.org/api/query?search_query=${search}&start=0&max_results=${limit}&sortBy=relevance`
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': `Quilpen/1.0 (mailto:${POLITE_EMAIL})` },
    })
    if (!res.ok) return results
    const xml = await res.text()

    // Very lightweight Atom parse — arXiv returns consistent XML.
    const entryBlocks = xml.split('<entry>').slice(1)
    for (const raw of entryBlocks) {
      const entry = raw.split('</entry>')[0]
      const grab = (tag: string): string | null => {
        const m = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))
        return m ? m[1].trim() : null
      }

      const arxivId = grab('id')?.replace(/^http[s]?:\/\/arxiv\.org\/abs\//, '') ?? null
      if (!arxivId) continue

      const title = grab('title')?.replace(/\s+/g, ' ').trim() ?? ''
      const abstract = grab('summary')?.replace(/\s+/g, ' ').trim() ?? null
      const published = grab('published')
      const year = published ? published.slice(0, 4) : null
      if (yearFrom && year && parseInt(year, 10) < yearFrom) continue
      if (yearTo && year && parseInt(year, 10) > yearTo) continue

      // Authors
      const authorBlocks = entry.match(/<author>[\s\S]*?<\/author>/g) ?? []
      const authors: string[] = []
      for (const ab of authorBlocks) {
        const nameMatch = ab.match(/<name>([^<]+)<\/name>/)
        if (nameMatch) authors.push(nameMatch[1].trim())
      }
      const firstAuthor = authors[0] ?? 'Unknown'
      const { surname, firstName } = splitAuthorName(firstAuthor)

      // DOI (if cross-listed to a journal)
      const doi = grab('arxiv:doi')

      // PDF link — always present for arXiv
      const pdfUrl = `https://arxiv.org/pdf/${arxivId.split('v')[0]}.pdf`

      results.push({
        externalId: `arxiv:${arxivId}`,
        provider: 'arxiv',
        title,
        authorSurname: surname,
        authorName: firstName,
        authors,
        year,
        publisher: null,
        journalName: 'arXiv',
        journalVolume: null,
        journalIssue: null,
        pageRange: null,
        doi,
        url: `https://arxiv.org/abs/${arxivId}`,
        abstract,
        citationCount: null,
        entryType: 'makale',
        openAccessUrl: pdfUrl,
      })
    }
  } catch (err) {
    console.warn('[academic-search] arXiv error:', err)
  }

  return results
}

// ─── PubMed Central (NCBI E-utilities) ────────────────────────
// Biomedical literature. esearch returns IDs; esummary returns metadata.
// Only full-text OA results are surfaced (we resolve their PDF URL
// via the standard /pdf/ path which NCBI preserves).

async function searchPmc(params: SearchParams): Promise<AcademicSearchResult[]> {
  const { query, type, yearFrom, yearTo, limit = 10 } = params
  const results: AcademicSearchResult[] = []

  if (type === 'kitap') return results

  try {
    const apiBase = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
    let termQuery = `${query}[All Fields]`
    if (yearFrom || yearTo) {
      const from = yearFrom ?? 1900
      const to = yearTo ?? new Date().getFullYear()
      termQuery += ` AND (${from}:${to}[PDAT])`
    }
    // Only OA full-text records
    termQuery += ' AND "open access"[filter]'

    const esearchUrl = `${apiBase}/esearch.fcgi?db=pmc&retmode=json&retmax=${limit}&term=${encodeURIComponent(termQuery)}`
    const esRes = await fetch(esearchUrl, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': `Quilpen/1.0 (mailto:${POLITE_EMAIL})` },
    })
    if (!esRes.ok) return results
    const esData = await esRes.json()
    const ids: string[] = esData.esearchresult?.idlist ?? []
    if (ids.length === 0) return results

    const esummaryUrl = `${apiBase}/esummary.fcgi?db=pmc&retmode=json&id=${ids.join(',')}`
    const sumRes = await fetch(esummaryUrl, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': `Quilpen/1.0 (mailto:${POLITE_EMAIL})` },
    })
    if (!sumRes.ok) return results
    const sumData = await sumRes.json()
    const resultMap = sumData.result ?? {}

    for (const id of ids) {
      const doc = resultMap[id]
      if (!doc) continue

      const authors: string[] = (doc.authors ?? []).map((a: { name: string }) => a.name).filter(Boolean)
      const firstAuthor = authors[0] ?? 'Unknown'
      const { surname, firstName } = splitAuthorName(firstAuthor)

      const year = doc.pubdate ? doc.pubdate.slice(0, 4) : null

      const articleIds = doc.articleids ?? []
      const doi = articleIds.find((a: { idtype: string }) => a.idtype === 'doi')?.value ?? null
      const pmcid = articleIds.find((a: { idtype: string }) => a.idtype === 'pmc')?.value ?? null
      const pmcNumeric = pmcid?.replace(/^PMC/i, '') ?? id

      // NCBI's canonical PDF URL for a PMC article — bypass the HTML
      // landing-page issue we were seeing from search-result URLs.
      const pdfUrl = `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${pmcNumeric}/pdf/`

      results.push({
        externalId: `pmc:${pmcNumeric}`,
        provider: 'pmc',
        title: doc.title ?? '',
        authorSurname: surname,
        authorName: firstName,
        authors,
        year,
        publisher: null,
        journalName: doc.fulljournalname ?? doc.source ?? null,
        journalVolume: doc.volume ?? null,
        journalIssue: doc.issue ?? null,
        pageRange: doc.pages ?? null,
        doi,
        url: `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${pmcNumeric}/`,
        abstract: null, // esummary doesn't return abstract; efetch would
        citationCount: null,
        entryType: 'makale',
        openAccessUrl: pdfUrl,
      })
    }
  } catch (err) {
    console.warn('[academic-search] PMC error:', err)
  }

  return results
}

// ─── DOAJ (Directory of Open Access Journals) ─────────────────
// Curated OA journals — every article is guaranteed full OA, no paywall,
// no bot blocking.

async function searchDoaj(params: SearchParams): Promise<AcademicSearchResult[]> {
  const { query, type, yearFrom, yearTo, limit = 10 } = params
  const results: AcademicSearchResult[] = []

  if (type === 'kitap') return results

  try {
    let searchQuery = `bibjson.title:"${query}" OR bibjson.abstract:"${query}"`
    if (yearFrom || yearTo) {
      const from = yearFrom ?? 1900
      const to = yearTo ?? new Date().getFullYear()
      searchQuery += ` AND bibjson.year:[${from} TO ${to}]`
    }
    const url = `https://doaj.org/api/search/articles/${encodeURIComponent(searchQuery)}?pageSize=${limit}`
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json', 'User-Agent': `Quilpen/1.0 (mailto:${POLITE_EMAIL})` },
    })
    if (!res.ok) return results
    const data = await res.json()

    for (const item of data.results ?? []) {
      const bib = item.bibjson ?? {}
      const authors: string[] = (bib.author ?? []).map((a: { name: string }) => a.name).filter(Boolean)
      const firstAuthor = authors[0] ?? 'Unknown'
      const { surname, firstName } = splitAuthorName(firstAuthor)

      const doi =
        (bib.identifier ?? []).find((i: { type: string }) => i.type === 'doi')?.id ?? null

      const fulltextLink = (bib.link ?? []).find(
        (l: { type?: string; content_type?: string }) => l.type === 'fulltext'
      )
      const pdfLink = (bib.link ?? []).find(
        (l: { content_type?: string }) => (l.content_type ?? '').toLowerCase().includes('pdf')
      )

      const openAccessUrl = pdfLink?.url ?? fulltextLink?.url ?? null
      if (!openAccessUrl) continue

      const journalName = bib.journal?.title ?? null

      results.push({
        externalId: `doaj:${item.id}`,
        provider: 'doaj',
        title: bib.title ?? '',
        authorSurname: surname,
        authorName: firstName,
        authors,
        year: bib.year ?? null,
        publisher: bib.journal?.publisher ?? null,
        journalName,
        journalVolume: bib.journal?.volume ?? null,
        journalIssue: bib.journal?.number ?? null,
        pageRange: bib.start_page && bib.end_page ? `${bib.start_page}-${bib.end_page}` : null,
        doi,
        url: openAccessUrl,
        abstract: bib.abstract ?? null,
        citationCount: null,
        entryType: 'makale',
        openAccessUrl,
      })
    }
  } catch (err) {
    console.warn('[academic-search] DOAJ error:', err)
  }

  return results
}

// ─── bioRxiv / medRxiv ────────────────────────────────────────
// Biomedical preprints. Their public API only supports DOI + date
// lookups; title search is done via an undocumented endpoint that
// can be flaky. Skip silently when it fails.

async function searchBiorxiv(params: SearchParams): Promise<AcademicSearchResult[]> {
  const { query, type, limit = 10 } = params
  const results: AcademicSearchResult[] = []

  if (type === 'kitap') return results

  try {
    // This search endpoint isn't formally documented; we accept best-effort.
    const url = `https://api.biorxiv.org/details/biorxiv/fuzzy/${encodeURIComponent(query)}/na/json`
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': `Quilpen/1.0 (mailto:${POLITE_EMAIL})` },
    })
    if (!res.ok) return results
    const data = await res.json()

    const items = (data.collection ?? []).slice(0, limit)
    for (const item of items) {
      const authorsRaw: string = item.authors ?? ''
      const authors = authorsRaw
        .split(';')
        .map((a: string) => a.trim())
        .filter(Boolean)
      const firstAuthor = authors[0] ?? 'Unknown'
      const { surname, firstName } = splitAuthorName(firstAuthor)

      const doi: string | null = item.doi ?? null
      const year: string | null = item.date ? String(item.date).slice(0, 4) : null
      const pdfUrl = doi ? `https://www.biorxiv.org/content/${doi}v1.full.pdf` : null

      results.push({
        externalId: `biorxiv:${doi ?? item.title?.slice(0, 40)}`,
        provider: 'biorxiv',
        title: item.title ?? '',
        authorSurname: surname,
        authorName: firstName,
        authors,
        year,
        publisher: null,
        journalName: item.server ?? 'bioRxiv',
        journalVolume: null,
        journalIssue: null,
        pageRange: null,
        doi,
        url: doi ? `https://www.biorxiv.org/content/${doi}` : '',
        abstract: item.abstract ?? null,
        citationCount: null,
        entryType: 'makale',
        openAccessUrl: pdfUrl,
      })
    }
  } catch (err) {
    console.warn('[academic-search] bioRxiv error:', err)
  }

  return results
}

// ─── Unified search ──────────────────────────────────────────

const PROVIDER_MAP: Record<string, (params: SearchParams) => Promise<AcademicSearchResult[]>> = {
  openalex: searchOpenAlex,
  semantic_scholar: searchSemanticScholar,
  crossref: searchCrossRef,
  google_books: searchGoogleBooks,
  arxiv: searchArxiv,
  pmc: searchPmc,
  doaj: searchDoaj,
  biorxiv: searchBiorxiv,
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
