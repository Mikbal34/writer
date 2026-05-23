/**
 * Deterministic bibliography lookup — when a PDF's text carries a DOI
 * or ISBN, we ask Crossref / OpenLibrary directly instead of guessing
 * with Haiku. The deterministic path is ~free, ~ms-latency, and the
 * canonical metadata source — Haiku is the fallback for older or
 * non-academic PDFs that lack identifiers.
 *
 * Returns a partial PdfMetadataExtraction-shaped object. Caller merges
 * it with any existing entry fields under the standard "don't overwrite
 * canonical, do overwrite placeholders" rule.
 */

export interface BiblioHit {
  source: 'doi' | 'isbn'
  entryType?: 'kitap' | 'makale' | 'tez' | 'ansiklopedi'
  authorSurname?: string | null
  authorName?: string | null
  title?: string | null
  publisher?: string | null
  publishPlace?: string | null
  year?: string | null
  journalName?: string | null
  journalVolume?: string | null
  journalIssue?: string | null
  pageRange?: string | null
  doi?: string | null
  isbn?: string | null
  /** Direct cover thumbnail URL (OpenLibrary), present for ISBN hits. */
  coverUrl?: string | null
  url?: string | null
  abstract?: string | null
}

const DOI_RE = /\b10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/
// ISBN-10 or ISBN-13, with optional "ISBN" prefix and various separators.
// Stripped/validated downstream.
const ISBN_RE = /\bISBN(?:-1[03])?:?\s*([0-9][\d\s-]{9,16}[\dX])\b/i

const FETCH_TIMEOUT_MS = 8000

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'Quilpen/1.0 (academic library)' },
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export function findDoi(text: string): string | null {
  const m = text.match(DOI_RE)
  if (!m) return null
  // Strip trailing punctuation that the regex sometimes captures.
  return m[0].replace(/[.,;:)\]]+$/, '')
}

export function findIsbn(text: string): string | null {
  const m = text.match(ISBN_RE)
  if (!m) return null
  // Normalise: strip spaces/hyphens.
  const raw = m[1].replace(/[\s-]/g, '')
  if (raw.length !== 10 && raw.length !== 13) return null
  return raw
}

function splitAuthor(full: string | undefined | null): { surname: string | null; given: string | null } {
  if (!full || typeof full !== 'string') return { surname: null, given: null }
  const t = full.trim()
  if (!t) return { surname: null, given: null }
  // "Surname, Given" form
  if (t.includes(',')) {
    const [s, g] = t.split(',', 2).map((x) => x.trim())
    return { surname: s || null, given: g || null }
  }
  // "Given Surname" form — pick last token as surname.
  const parts = t.split(/\s+/)
  if (parts.length === 1) return { surname: parts[0], given: null }
  return { surname: parts[parts.length - 1], given: parts.slice(0, -1).join(' ') }
}

/**
 * Crossref /works/{doi} → canonical journal/book/chapter metadata.
 * Docs: https://api.crossref.org/swagger-ui/
 */
export async function lookupByDoi(doi: string): Promise<BiblioHit | null> {
  const data = await fetchJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`)
  if (!data || typeof data !== 'object') return null
  const m = (data as { message?: Record<string, unknown> }).message
  if (!m) return null

  const authorList = Array.isArray(m.author) ? (m.author as Array<Record<string, unknown>>) : []
  const first = authorList[0] || {}
  const surname = typeof first.family === 'string' ? first.family : null
  const given = typeof first.given === 'string' ? first.given : null

  const title = Array.isArray(m.title) && typeof m.title[0] === 'string' ? m.title[0] : null
  const container = Array.isArray(m['container-title']) && typeof m['container-title'][0] === 'string'
    ? m['container-title'][0] : null
  const publisher = typeof m.publisher === 'string' ? m.publisher : null
  const issued = m.issued as { 'date-parts'?: number[][] } | undefined
  const year = issued?.['date-parts']?.[0]?.[0]
  const volume = typeof m.volume === 'string' ? m.volume : null
  const issue = typeof m.issue === 'string' ? m.issue : null
  const page = typeof m.page === 'string' ? m.page : null
  const url = typeof m.URL === 'string' ? m.URL : null
  const type = typeof m.type === 'string' ? m.type : ''
  const abstract = typeof m.abstract === 'string'
    ? m.abstract.replace(/<[^>]+>/g, '').trim() || null
    : null

  // Map Crossref type to our entryType vocabulary.
  let entryType: BiblioHit['entryType'] = 'makale'
  if (type === 'book' || type === 'monograph' || type === 'edited-book') entryType = 'kitap'
  else if (type === 'dissertation') entryType = 'tez'
  else if (type === 'reference-entry') entryType = 'ansiklopedi'

  return {
    source: 'doi',
    entryType,
    authorSurname: surname,
    authorName: given,
    title,
    publisher,
    year: year ? String(year) : null,
    journalName: entryType === 'makale' ? container : null,
    journalVolume: volume,
    journalIssue: issue,
    pageRange: page,
    doi,
    url,
    abstract,
  }
}

/**
 * OpenLibrary book lookup by ISBN.
 * Docs: https://openlibrary.org/dev/docs/api/books
 */
export async function lookupByIsbn(isbn: string): Promise<BiblioHit | null> {
  const data = await fetchJson(
    `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`,
  )
  if (!data || typeof data !== 'object') return null
  const key = `ISBN:${isbn}`
  const book = (data as Record<string, Record<string, unknown>>)[key]
  if (!book) return null

  const authors = Array.isArray(book.authors) ? (book.authors as Array<{ name?: string }>) : []
  const { surname, given } = splitAuthor(authors[0]?.name)
  const title = typeof book.title === 'string' ? book.title : null
  const publishers = Array.isArray(book.publishers)
    ? (book.publishers as Array<{ name?: string }>)
    : []
  const publisher = publishers[0]?.name || null
  const places = Array.isArray(book.publish_places)
    ? (book.publish_places as Array<{ name?: string }>)
    : []
  const place = places[0]?.name || null
  const date = typeof book.publish_date === 'string' ? book.publish_date : null
  const year = date?.match(/\b(1[5-9]\d{2}|20\d{2})\b/)?.[1] || null
  const url = typeof book.url === 'string' ? book.url : null

  return {
    source: 'isbn',
    entryType: 'kitap',
    authorSurname: surname,
    authorName: given,
    title,
    publisher,
    publishPlace: place,
    year,
    isbn,
    coverUrl: `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`,
    url,
  }
}

/** Convenience: text → DOI then ISBN, first hit wins. */
export async function lookupByText(text: string): Promise<BiblioHit | null> {
  const doi = findDoi(text)
  if (doi) {
    const hit = await lookupByDoi(doi)
    if (hit?.title) return hit
  }
  const isbn = findIsbn(text)
  if (isbn) {
    const hit = await lookupByIsbn(isbn)
    if (hit?.title) return hit
  }
  return null
}
