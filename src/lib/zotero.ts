type EntryType = 'kitap' | 'makale' | 'nesir' | 'ceviri' | 'tez' | 'ansiklopedi' | 'web'

const ZOTERO_API = 'https://api.zotero.org'

const TYPE_MAP: Record<string, EntryType> = {
  book: 'kitap',
  bookSection: 'kitap',
  journalArticle: 'makale',
  magazineArticle: 'makale',
  newspaperArticle: 'makale',
  thesis: 'tez',
  webpage: 'web',
  blogPost: 'web',
  forumPost: 'web',
  encyclopediaArticle: 'ansiklopedi',
  dictionaryEntry: 'ansiklopedi',
  conferencePaper: 'kitap',
  report: 'kitap',
  manuscript: 'nesir',
  document: 'kitap',
}

export interface ZoteroCollection {
  key: string
  name: string
  parentCollection: string | false
}

export interface ZoteroParsedItem {
  zoteroKey: string
  entryType: EntryType
  authorSurname: string
  authorName: string | null
  title: string
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
  editor: string | null
  translator: string | null
}

function headers(apiKey: string) {
  return {
    'Zotero-API-Key': apiKey,
    'Zotero-API-Version': '3',
    'Content-Type': 'application/json',
  }
}

export async function getCollections(
  zoteroUserId: string,
  apiKey: string
): Promise<ZoteroCollection[]> {
  const res = await fetch(
    `${ZOTERO_API}/users/${zoteroUserId}/collections`,
    { headers: headers(apiKey) }
  )
  if (!res.ok) throw new Error(`Zotero API error: ${res.status}`)
  const data = await res.json()
  return data.map((c: Record<string, unknown>) => {
    const d = c.data as Record<string, unknown>
    return {
      key: c.key as string,
      name: d.name as string,
      parentCollection: d.parentCollection as string | false,
    }
  })
}

export async function getCollectionItems(
  zoteroUserId: string,
  apiKey: string,
  collectionKey: string,
  since?: number
): Promise<ZoteroParsedItem[]> {
  let url = `${ZOTERO_API}/users/${zoteroUserId}/collections/${collectionKey}/items?itemType=-attachment&limit=100`
  if (since !== undefined) {
    url += `&since=${since}`
  }

  const allItems: ZoteroParsedItem[] = []
  let fetchUrl: string | null = url

  while (fetchUrl) {
    const res: Response = await fetch(fetchUrl, { headers: headers(apiKey) })
    if (!res.ok) throw new Error(`Zotero API error: ${res.status}`)

    const data = await res.json()
    for (const item of data) {
      const d = item.data as Record<string, unknown>
      const parsed = parseZoteroItem(item.key as string, d)
      if (parsed) allItems.push(parsed)
    }

    // Pagination via Link header
    const linkHeader: string | null = res.headers.get('Link')
    const nextMatch: RegExpMatchArray | null = linkHeader?.match(/<([^>]+)>;\s*rel="next"/) ?? null
    fetchUrl = nextMatch ? nextMatch[1] : null
  }

  return allItems
}

function parseZoteroItem(
  key: string,
  data: Record<string, unknown>
): ZoteroParsedItem | null {
  const title = data.title as string
  if (!title) return null

  const itemType = (data.itemType as string) ?? ''
  const entryType = TYPE_MAP[itemType] ?? 'kitap'

  const creators = (data.creators as Array<Record<string, unknown>>) ?? []
  const firstAuthor = creators.find(
    (c) => c.creatorType === 'author' || c.creatorType === 'contributor'
  ) ?? creators[0]
  const editors = creators.filter((c) => c.creatorType === 'editor')
  const translators = creators.filter((c) => c.creatorType === 'translator')

  return {
    zoteroKey: key,
    entryType,
    authorSurname: (firstAuthor?.lastName as string) ?? (firstAuthor?.name as string) ?? 'Unknown',
    authorName: (firstAuthor?.firstName as string) ?? null,
    title,
    publisher: (data.publisher as string) ?? null,
    publishPlace: (data.place as string) ?? null,
    year: (data.date as string)?.match(/\d{4}/)?.[0] ?? null,
    volume: (data.volume as string) ?? null,
    edition: (data.edition as string) ?? null,
    journalName: (data.publicationTitle as string) ?? null,
    journalVolume: (data.volume as string) ?? null,
    journalIssue: (data.issue as string) ?? null,
    pageRange: (data.pages as string) ?? null,
    doi: (data.DOI as string) ?? null,
    url: (data.url as string) ?? null,
    editor: editors.map((e) => `${e.lastName ?? ''}, ${e.firstName ?? ''}`.trim()).join('; ') || null,
    translator: translators.map((t) => `${t.lastName ?? ''}, ${t.firstName ?? ''}`.trim()).join('; ') || null,
  }
}

/**
 * Get child attachments for an item, returning PDF attachment keys.
 */
export async function getItemAttachments(
  zoteroUserId: string,
  apiKey: string,
  itemKey: string
): Promise<Array<{ key: string; filename: string; contentType: string }>> {
  const res = await fetch(
    `${ZOTERO_API}/users/${zoteroUserId}/items/${itemKey}/children`,
    { headers: headers(apiKey) }
  )
  if (!res.ok) return []

  const data = await res.json()
  const attachments: Array<{ key: string; filename: string; contentType: string }> = []

  for (const item of data) {
    const d = item.data as Record<string, unknown>
    if (d.itemType !== 'attachment') continue
    const contentType = (d.contentType as string) ?? ''
    const filename = (d.filename as string) ?? (d.title as string) ?? 'attachment'

    // Only PDF, DOC, DOCX, TXT
    if (
      contentType === 'application/pdf' ||
      contentType === 'application/msword' ||
      contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      contentType === 'text/plain'
    ) {
      attachments.push({ key: item.key as string, filename, contentType })
    }
  }

  return attachments
}

/**
 * Download a file attachment from Zotero.
 * Returns the file as a Buffer, or null if download fails.
 */
export async function downloadAttachment(
  zoteroUserId: string,
  apiKey: string,
  attachmentKey: string
): Promise<Buffer | null> {
  try {
    const res = await fetch(
      `${ZOTERO_API}/users/${zoteroUserId}/items/${attachmentKey}/file`,
      { headers: headers(apiKey) }
    )
    if (!res.ok) return null
    const arrayBuffer = await res.arrayBuffer()
    return Buffer.from(arrayBuffer)
  } catch {
    return null
  }
}

export async function verifyApiKey(
  zoteroUserId: string,
  apiKey: string
): Promise<boolean> {
  try {
    const res = await fetch(
      `${ZOTERO_API}/users/${zoteroUserId}/collections?limit=1`,
      { headers: headers(apiKey) }
    )
    return res.ok
  } catch {
    return false
  }
}
