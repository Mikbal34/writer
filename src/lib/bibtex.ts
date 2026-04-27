import { parse as parseBibtex } from '@retorquere/bibtex-parser'

type EntryType = 'kitap' | 'makale' | 'nesir' | 'ceviri' | 'tez' | 'ansiklopedi' | 'web'

export interface ParsedBibtexEntry {
  bibtexKey: string
  entryType: EntryType
  authorSurname: string
  authorName: string | null
  /** 2nd…Nth authors when the BibTeX entry has multiple `author=` entries. */
  coAuthors: Array<{ surname: string; name: string | null }>
  title: string
  shortTitle: string | null
  editor: string | null
  translator: string | null
  publisher: string | null
  publishPlace: string | null
  year: string | null
  volume: string | null
  edition: string | null
  journalName: string | null
  journalVolume: string | null
  journalIssue: string | null
  pageRange: string | null
  doi: string | null
  url: string | null
}

const TYPE_MAP: Record<string, EntryType> = {
  book: 'kitap',
  inbook: 'kitap',
  incollection: 'kitap',
  article: 'makale',
  phdthesis: 'tez',
  mastersthesis: 'tez',
  thesis: 'tez',
  misc: 'kitap',
  online: 'web',
  webpage: 'web',
  proceedings: 'kitap',
  inproceedings: 'kitap',
  conference: 'kitap',
  techreport: 'kitap',
  manual: 'kitap',
  unpublished: 'kitap',
}

function extractTextField(fields: Record<string, unknown>, key: string): string | null {
  const val = fields[key]
  if (!val) return null
  if (typeof val === 'string') return val.trim() || null
  if (Array.isArray(val)) return val.join(', ').trim() || null
  if (typeof val === 'object' && val !== null) {
    const v = (val as Record<string, unknown>).value
    if (typeof v === 'string') return v.trim() || null
  }
  return String(val).trim() || null
}

function parseOneAuthor(raw: unknown): { surname: string; name: string | null } {
  if (!raw) return { surname: 'Unknown', name: null }

  if (typeof raw === 'object' && raw !== null) {
    const creator = raw as Record<string, unknown>
    if (creator.lastName || creator.family) {
      return {
        surname: String(creator.lastName ?? creator.family ?? 'Unknown').trim(),
        name: String(creator.firstName ?? creator.given ?? '').trim() || null,
      }
    }
    if (creator.literal) {
      return splitAuthorString(String(creator.literal))
    }
    return splitAuthorString(String(raw))
  }
  return splitAuthorString(String(raw))
}

function splitAuthorString(authorStr: string): { surname: string; name: string | null } {
  // "Surname, Name" form
  if (authorStr.includes(',')) {
    const parts = authorStr.split(',').map((s) => s.trim())
    return { surname: parts[0], name: parts[1] || null }
  }
  // "Name Surname" form — take the last word as surname.
  const words = authorStr.trim().split(/\s+/)
  if (words.length > 1) {
    return {
      surname: words[words.length - 1],
      name: words.slice(0, -1).join(' '),
    }
  }
  return { surname: authorStr.trim(), name: null }
}

/**
 * Parse the BibTeX `author = {...}` field into [first, ...coAuthors].
 * Handles three input shapes:
 *   - string with " and " separators (BibTeX raw form)
 *   - array of {firstName,lastName} or {given,family} objects
 *   - single string ("Smith, J.")
 */
function parseAuthors(authorField: unknown): Array<{ surname: string; name: string | null }> {
  if (!authorField) return [{ surname: 'Unknown', name: null }]

  if (Array.isArray(authorField)) {
    return authorField.map((a) => parseOneAuthor(a))
  }

  if (typeof authorField === 'string') {
    // BibTeX raw author lists are separated by " and ".
    return authorField.split(/\s+and\s+/i).map(splitAuthorString)
  }

  return [parseOneAuthor(authorField)]
}

export function parseBibtexContent(content: string): {
  entries: ParsedBibtexEntry[]
  errors: string[]
} {
  const errors: string[] = []
  const entries: ParsedBibtexEntry[] = []

  let parsed: ReturnType<typeof parseBibtex>
  try {
    parsed = parseBibtex(content)
  } catch (e) {
    return { entries: [], errors: [`Parse error: ${e instanceof Error ? e.message : String(e)}`] }
  }

  for (const item of parsed.entries) {
    try {
      const fields = item.fields as unknown as Record<string, unknown>
      const bibtexType = (item.type ?? '').toLowerCase()
      let entryType = TYPE_MAP[bibtexType] ?? 'kitap'

      // misc with url → web
      if (bibtexType === 'misc' && extractTextField(fields, 'url')) {
        entryType = 'web'
      }

      const allAuthors = parseAuthors(fields.author ?? fields.creator)
      const [first, ...rest] = allAuthors
      const title = extractTextField(fields, 'title')

      if (!title) {
        errors.push(`Skipped entry "${item.key}": no title`)
        continue
      }

      entries.push({
        bibtexKey: item.key ?? '',
        entryType,
        authorSurname: first.surname,
        authorName: first.name,
        coAuthors: rest,
        title,
        shortTitle: extractTextField(fields, 'shorttitle'),
        editor: extractTextField(fields, 'editor'),
        translator: extractTextField(fields, 'translator'),
        publisher: extractTextField(fields, 'publisher'),
        publishPlace: extractTextField(fields, 'address') ?? extractTextField(fields, 'location'),
        year: extractTextField(fields, 'year') ?? extractTextField(fields, 'date')?.slice(0, 4) ?? null,
        volume: extractTextField(fields, 'volume'),
        edition: extractTextField(fields, 'edition'),
        journalName: extractTextField(fields, 'journal') ?? extractTextField(fields, 'journaltitle'),
        journalVolume: extractTextField(fields, 'volume'),
        journalIssue: extractTextField(fields, 'number'),
        pageRange: extractTextField(fields, 'pages'),
        doi: extractTextField(fields, 'doi'),
        url: extractTextField(fields, 'url'),
      })
    } catch (e) {
      errors.push(`Error processing "${item.key}": ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return { entries, errors }
}
