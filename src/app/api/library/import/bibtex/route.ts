import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { parseBibtexContent } from '@/lib/bibtex'

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()
    const userId = session.user.id
    const body = await req.json()
    const content = body.content as string

    if (!content?.trim()) {
      return NextResponse.json({ error: 'BibTeX content is required' }, { status: 400 })
    }

    const { entries, errors } = parseBibtexContent(content)

    let created = 0
    let skipped = 0

    for (const entry of entries) {
      try {
        const existing = await prisma.libraryEntry.findUnique({
          where: {
            userId_authorSurname_title: {
              userId,
              authorSurname: entry.authorSurname,
              title: entry.title,
            },
          },
        })

        if (existing) {
          skipped++
          continue
        }

        await prisma.libraryEntry.create({
          data: {
            userId,
            entryType: entry.entryType,
            authorSurname: entry.authorSurname,
            authorName: entry.authorName,
            coAuthors: entry.coAuthors.length > 0 ? entry.coAuthors : undefined,
            title: entry.title,
            shortTitle: entry.shortTitle,
            editor: entry.editor,
            translator: entry.translator,
            publisher: entry.publisher,
            publishPlace: entry.publishPlace,
            year: entry.year,
            volume: entry.volume,
            edition: entry.edition,
            journalName: entry.journalName,
            journalVolume: entry.journalVolume,
            journalIssue: entry.journalIssue,
            pageRange: entry.pageRange,
            doi: entry.doi,
            url: entry.url,
            importSource: 'bibtex',
            bibtexKey: entry.bibtexKey,
          },
        })
        created++
      } catch {
        skipped++
      }
    }

    return NextResponse.json({
      created,
      skipped,
      total: entries.length,
      errors,
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library/import/bibtex]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
