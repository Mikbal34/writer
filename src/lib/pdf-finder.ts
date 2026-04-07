/**
 * PDF Finder Service
 *
 * Searches multiple open-access APIs to find downloadable PDFs for bibliography entries.
 *
 * Priority for articles: Unpaywall → Semantic Scholar → OpenAlex → CORE
 * Priority for books: Open Library → DOAB
 */

const UNPAYWALL_EMAIL = process.env.UNPAYWALL_EMAIL || 'quilpen@example.com'
const CORE_API_KEY = process.env.CORE_API_KEY || ''

export interface PdfSearchResult {
  found: boolean
  pdfUrl: string | null
  provider: 'unpaywall' | 'semantic_scholar' | 'openalex' | 'core' | 'open_library' | 'doab' | null
  confidence: 'high' | 'medium' | 'low'
}

export interface PdfSearchParams {
  doi?: string | null
  title: string
  authorSurname: string
  entryType: string
  isbn?: string | null
}

const NOT_FOUND: PdfSearchResult = {
  found: false,
  pdfUrl: null,
  provider: null,
  confidence: 'low',
}

// ─── Unpaywall ───────────────────────────────────────────────

async function searchUnpaywall(doi: string): Promise<PdfSearchResult> {
  try {
    const res = await fetch(
      `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${UNPAYWALL_EMAIL}`,
      { signal: AbortSignal.timeout(10000) }
    )
    if (!res.ok) return NOT_FOUND

    const data = await res.json()
    const pdfUrl =
      data.best_oa_location?.url_for_pdf ||
      data.best_oa_location?.url ||
      null

    if (pdfUrl) {
      return { found: true, pdfUrl, provider: 'unpaywall', confidence: 'high' }
    }
  } catch {
    // timeout or network error
  }
  return NOT_FOUND
}

// ─── Semantic Scholar ────────────────────────────────────────

async function searchSemanticScholar(params: {
  doi?: string | null
  title?: string
}): Promise<PdfSearchResult> {
  try {
    let url: string
    if (params.doi) {
      url = `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(params.doi)}?fields=openAccessPdf`
    } else if (params.title) {
      const searchRes = await fetch(
        `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(params.title)}&limit=3&fields=openAccessPdf,title`,
        { signal: AbortSignal.timeout(10000) }
      )
      if (!searchRes.ok) return NOT_FOUND
      const searchData = await searchRes.json()
      const match = searchData.data?.[0]
      if (!match?.openAccessPdf?.url) return NOT_FOUND
      return {
        found: true,
        pdfUrl: match.openAccessPdf.url,
        provider: 'semantic_scholar',
        confidence: params.doi ? 'high' : 'medium',
      }
    } else {
      return NOT_FOUND
    }

    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return NOT_FOUND

    const data = await res.json()
    if (data.openAccessPdf?.url) {
      return {
        found: true,
        pdfUrl: data.openAccessPdf.url,
        provider: 'semantic_scholar',
        confidence: 'high',
      }
    }
  } catch {
    // timeout or network error
  }
  return NOT_FOUND
}

// ─── OpenAlex ────────────────────────────────────────────────

async function searchOpenAlex(params: {
  doi?: string | null
  title?: string
}): Promise<PdfSearchResult> {
  try {
    let url: string
    if (params.doi) {
      url = `https://api.openalex.org/works/doi:${encodeURIComponent(params.doi)}`
    } else if (params.title) {
      url = `https://api.openalex.org/works?filter=title.search:${encodeURIComponent(params.title)}&per_page=3`
    } else {
      return NOT_FOUND
    }

    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': `Quilpen/1.0 (mailto:${UNPAYWALL_EMAIL})` },
    })
    if (!res.ok) return NOT_FOUND

    const data = await res.json()

    // DOI lookup returns single work, title search returns results array
    const work = params.doi ? data : data.results?.[0]
    if (!work) return NOT_FOUND

    const pdfUrl =
      work.open_access?.oa_url ||
      work.primary_location?.pdf_url ||
      null

    if (pdfUrl) {
      return {
        found: true,
        pdfUrl,
        provider: 'openalex',
        confidence: params.doi ? 'high' : 'medium',
      }
    }
  } catch {
    // timeout or network error
  }
  return NOT_FOUND
}

// ─── CORE ────────────────────────────────────────────────────

async function searchCore(params: {
  doi?: string | null
  title?: string
}): Promise<PdfSearchResult> {
  if (!CORE_API_KEY) return NOT_FOUND

  try {
    const query = params.doi || params.title
    if (!query) return NOT_FOUND

    const res = await fetch(
      `https://api.core.ac.uk/v3/search/works?q=${encodeURIComponent(query)}&limit=3`,
      {
        signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${CORE_API_KEY}` },
      }
    )
    if (!res.ok) return NOT_FOUND

    const data = await res.json()
    const result = data.results?.[0]
    if (!result) return NOT_FOUND

    const pdfUrl = result.downloadUrl || result.sourceFulltextUrls?.[0] || null
    if (pdfUrl) {
      return {
        found: true,
        pdfUrl,
        provider: 'core',
        confidence: params.doi ? 'high' : 'medium',
      }
    }
  } catch {
    // timeout or network error
  }
  return NOT_FOUND
}

// ─── Open Library (books) ────────────────────────────────────

async function searchOpenLibrary(params: {
  isbn?: string | null
  title?: string
  authorSurname?: string
}): Promise<PdfSearchResult> {
  try {
    let url: string
    if (params.isbn) {
      url = `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(params.isbn)}&format=json&jscmd=data`
    } else if (params.title) {
      const q = params.authorSurname
        ? `${params.title} ${params.authorSurname}`
        : params.title
      url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=3&fields=key,title,author_name,ia`
    } else {
      return NOT_FOUND
    }

    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return NOT_FOUND

    const data = await res.json()

    if (params.isbn) {
      // ISBN lookup: check if the book has an Internet Archive ID
      const bookKey = `ISBN:${params.isbn}`
      const book = data[bookKey]
      if (!book) return NOT_FOUND

      // Check for ebook availability
      if (book.ebooks?.[0]?.availability === 'full') {
        const iaId = book.identifiers?.openlibrary?.[0]
        if (iaId) {
          return {
            found: true,
            pdfUrl: `https://archive.org/download/${iaId}/${iaId}.pdf`,
            provider: 'open_library',
            confidence: 'high',
          }
        }
      }
    } else {
      // Title search: look for Internet Archive identifier
      const doc = data.docs?.[0]
      if (doc?.ia?.[0]) {
        const iaId = doc.ia[0]
        return {
          found: true,
          pdfUrl: `https://archive.org/download/${iaId}/${iaId}.pdf`,
          provider: 'open_library',
          confidence: 'medium',
        }
      }
    }
  } catch {
    // timeout or network error
  }
  return NOT_FOUND
}

// ─── DOAB (academic books) ───────────────────────────────────

async function searchDoab(title: string): Promise<PdfSearchResult> {
  try {
    const res = await fetch(
      `https://directory.doabooks.org/rest/search?query=${encodeURIComponent(title)}&expand=bitstreams`,
      {
        signal: AbortSignal.timeout(10000),
        headers: { Accept: 'application/json' },
      }
    )
    if (!res.ok) return NOT_FOUND

    const data = await res.json()
    // DOAB returns items with bitstreams containing PDF links
    const item = Array.isArray(data) ? data[0] : data.items?.[0]
    if (!item) return NOT_FOUND

    const pdfBitstream = item.bitstreams?.find(
      (b: { mimeType?: string; bundleName?: string }) =>
        b.mimeType === 'application/pdf' && b.bundleName === 'ORIGINAL'
    )
    if (pdfBitstream) {
      return {
        found: true,
        pdfUrl: `https://directory.doabooks.org${pdfBitstream.retrieveLink}`,
        provider: 'doab',
        confidence: 'medium',
      }
    }
  } catch {
    // timeout or network error
  }
  return NOT_FOUND
}

// ─── Main finder ─────────────────────────────────────────────

/**
 * Searches multiple open-access APIs to find a downloadable PDF.
 * Returns the first result found, prioritized by reliability.
 */
export async function findPdf(params: PdfSearchParams): Promise<PdfSearchResult> {
  const isBook = params.entryType === 'kitap'

  if (isBook) {
    // Book search: Open Library → DOAB
    const results = await Promise.allSettled([
      searchOpenLibrary({
        isbn: params.isbn,
        title: params.title,
        authorSurname: params.authorSurname,
      }),
      searchDoab(params.title),
    ])

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.found) {
        return r.value
      }
    }
    return NOT_FOUND
  }

  // Article/thesis search
  // Phase 1: DOI-based search (if available) - run in parallel
  if (params.doi) {
    const results = await Promise.allSettled([
      searchUnpaywall(params.doi),
      searchSemanticScholar({ doi: params.doi }),
      searchOpenAlex({ doi: params.doi }),
    ])

    // Return first found, in priority order
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.found) {
        return r.value
      }
    }
  }

  // Phase 2: Title-based search - run in parallel
  const results = await Promise.allSettled([
    searchSemanticScholar({ title: params.title }),
    searchOpenAlex({ title: params.title }),
    searchCore({ title: params.title }),
  ])

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.found) {
      return r.value
    }
  }

  return NOT_FOUND
}
