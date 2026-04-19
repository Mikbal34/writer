import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { EntryType } from '@prisma/client'
import { type AcademicSearchResult, mapResultToLibraryData } from '@/lib/academic-search'
import { startLibraryPdfBatch } from '@/lib/library-pipeline'

const VALID_ENTRY_TYPES = new Set(Object.values(EntryType))

function toEntryType(value: string): EntryType {
  return VALID_ENTRY_TYPES.has(value as EntryType) ? (value as EntryType) : EntryType.kitap
}

interface RichResult extends AcademicSearchResult {
  relevanceScore?: number
}

/**
 * POST /api/library/bulk-add-from-search
 * Body: { results: RichResult[] }
 *
 * Creates one LibraryEntry per result (skipping existing title+author pairs)
 * and fires off async PDF downloads for entries that have an openAccessUrl.
 * Returns counts + new entry IDs so the UI can poll status.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()
    const userId = session.user.id
    const { results } = (await req.json()) as { results: RichResult[] }

    if (!Array.isArray(results) || results.length === 0) {
      return NextResponse.json({ error: 'results array is required' }, { status: 400 })
    }

    const created: Array<{ id: string; title: string; pdfStatus: string }> = []
    const skipped: Array<{ title: string; reason: string }> = []
    const downloads: Array<{ entryId: string; pdfUrl: string }> = []

    for (const result of results) {
      const data = mapResultToLibraryData(result)

      const existing = await prisma.libraryEntry.findUnique({
        where: {
          userId_authorSurname_title: {
            userId,
            authorSurname: data.authorSurname,
            title: data.title,
          },
        },
      })
      if (existing) {
        skipped.push({ title: data.title, reason: 'already_in_library' })
        continue
      }

      const pdfUrl = result.openAccessUrl ?? null
      const pdfStatus = pdfUrl ? 'pending' : 'none'

      const entry = await prisma.libraryEntry.create({
        data: {
          userId,
          entryType: toEntryType(data.entryType),
          authorSurname: data.authorSurname,
          authorName: data.authorName || null,
          title: data.title,
          publisher: data.publisher || null,
          publishPlace: data.publishPlace || null,
          year: data.year || null,
          volume: data.volume || null,
          edition: data.edition || null,
          journalName: data.journalName || null,
          journalVolume: data.journalVolume || null,
          journalIssue: data.journalIssue || null,
          pageRange: data.pageRange || null,
          doi: data.doi || null,
          url: data.url || null,
          abstract: result.abstract ?? null,
          citationCount: result.citationCount ?? null,
          relevanceScore: result.relevanceScore ?? null,
          openAccessUrl: pdfUrl,
          pdfStatus,
          importSource: 'literature-search',
        },
      })

      created.push({ id: entry.id, title: entry.title, pdfStatus })
      if (pdfUrl) downloads.push({ entryId: entry.id, pdfUrl })
    }

    // Fire-and-forget PDF downloads for entries that have an open-access URL.
    if (downloads.length > 0) {
      startLibraryPdfBatch(downloads, userId)
    }

    return NextResponse.json({
      added: created.length,
      skipped: skipped.length,
      entries: created,
      skippedEntries: skipped,
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library/bulk-add-from-search]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
