import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { EntryType } from '@prisma/client'
import { type AcademicSearchResult, mapResultToLibraryData } from '@/lib/academic-search'

const VALID_ENTRY_TYPES = new Set(Object.values(EntryType))

function toEntryType(value: string): EntryType {
  if (VALID_ENTRY_TYPES.has(value as EntryType)) return value as EntryType
  return EntryType.kitap
}

/**
 * POST /api/research/import
 * Import search results into LibraryEntry + optionally link to project Bibliography.
 * Body: { results: AcademicSearchResult[], projectId?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()
    const userId = session.user.id
    const { results, projectId } = (await req.json()) as {
      results: AcademicSearchResult[]
      projectId?: string
    }

    if (!Array.isArray(results) || results.length === 0) {
      return NextResponse.json({ error: 'results array is required' }, { status: 400 })
    }

    // Verify project ownership if projectId provided
    if (projectId) {
      const project = await prisma.project.findFirst({
        where: { id: projectId, userId },
        select: { id: true },
      })
      if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 })
      }
    }

    let created = 0
    let skipped = 0
    let linked = 0

    for (const result of results) {
      const data = mapResultToLibraryData(result)

      // Create or find LibraryEntry
      let libraryEntry = await prisma.libraryEntry.findUnique({
        where: {
          userId_authorSurname_title: {
            userId,
            authorSurname: data.authorSurname,
            title: data.title,
          },
        },
      })

      if (libraryEntry) {
        skipped++
      } else {
        libraryEntry = await prisma.libraryEntry.create({
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
            importSource: 'research',
          },
        })
        created++
      }

      // Link to project bibliography if projectId provided
      if (projectId) {
        const existingBib = await prisma.bibliography.findFirst({
          where: {
            projectId,
            authorSurname: data.authorSurname,
            title: data.title,
          },
        })

        if (!existingBib) {
          await prisma.bibliography.create({
            data: {
              projectId,
              libraryEntryId: libraryEntry.id,
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
            },
          })
          linked++
        } else if (!existingBib.libraryEntryId) {
          // Link existing bibliography to library entry
          await prisma.bibliography.update({
            where: { id: existingBib.id },
            data: { libraryEntryId: libraryEntry.id },
          })
          linked++
        }
      }
    }

    return NextResponse.json({ created, skipped, linked })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/research/import]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
