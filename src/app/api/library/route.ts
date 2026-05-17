import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth()
    const userId = session.user.id

    const url = new URL(req.url)
    const search = url.searchParams.get('search') ?? ''
    const entryType = url.searchParams.get('entryType') ?? ''
    const tagId = url.searchParams.get('tagId') ?? ''
    // New: filter by collection. When set, only entries in that collection
    // are returned. Combines with tagId via AND so "Kelam klasörü AND
    // tez tag'i" works naturally.
    const collectionId = url.searchParams.get('collectionId') ?? ''
    const sort = url.searchParams.get('sort') ?? 'updated_desc'
    const page = parseInt(url.searchParams.get('page') ?? '1', 10)
    const limit = parseInt(url.searchParams.get('limit') ?? '50', 10)
    const skip = (page - 1) * limit

    // Map UI sort keys to Prisma orderBy. Unknown values fall through
    // to the recency default.
    const orderBy: Record<string, unknown> = (() => {
      switch (sort) {
        case 'year_desc':
          return { year: 'desc' }
        case 'year_asc':
          return { year: 'asc' }
        case 'title_asc':
          return { title: 'asc' }
        case 'author_asc':
          return { authorSurname: 'asc' }
        case 'updated_desc':
        default:
          return { updatedAt: 'desc' }
      }
    })()

    const where: Record<string, unknown> = { userId }

    if (search) {
      where.OR = [
        { authorSurname: { contains: search, mode: 'insensitive' } },
        { authorName: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
      ]
    }

    if (entryType) {
      where.entryType = entryType
    }

    if (tagId) {
      where.tags = { some: { tagId } }
    }

    if (collectionId) {
      where.collections = { some: { collectionId } }
    }

    const [entries, total] = await Promise.all([
      prisma.libraryEntry.findMany({
        where,
        include: {
          tags: { include: { tag: true } },
          _count: {
            select: {
              bibliographies: true,
              volumes: true,
              // Surface note + collection counts so the entry table can
              // show 🗂 N and 📝 N badges without a second roundtrip.
              notes: true,
              collections: true,
            },
          },
          // pdfStatus per volume powers the aggregate badge on
          // multi-volume parent rows (no per-row `pdfStatus` of its own).
          volumes: { select: { pdfStatus: true } },
        },
        orderBy,
        skip,
        take: limit,
      }),
      prisma.libraryEntry.count({ where }),
    ])

    return NextResponse.json({ entries, total, page, limit })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/library]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()
    const userId = session.user.id
    const body = await req.json()

    const { authorSurname, title } = body
    if (!authorSurname?.trim() || !title?.trim()) {
      return NextResponse.json(
        { error: 'authorSurname and title are required' },
        { status: 400 }
      )
    }

    const entry = await prisma.libraryEntry.create({
      data: {
        userId,
        entryType: body.entryType ?? 'kitap',
        authorSurname: authorSurname.trim(),
        authorName: body.authorName?.trim() || null,
        coAuthors: Array.isArray(body.coAuthors)
          ? body.coAuthors
              .map((a: { surname?: string; name?: string }) => ({
                surname: a.surname?.trim() ?? '',
                name: a.name?.trim() || null,
              }))
              .filter((a: { surname: string }) => a.surname.length > 0)
          : undefined,
        title: title.trim(),
        shortTitle: body.shortTitle?.trim() || null,
        editor: body.editor?.trim() || null,
        translator: body.translator?.trim() || null,
        publisher: body.publisher?.trim() || null,
        publishPlace: body.publishPlace?.trim() || null,
        year: body.year?.trim() || null,
        volume: body.volume?.trim() || null,
        edition: body.edition?.trim() || null,
        journalName: body.journalName?.trim() || null,
        journalVolume: body.journalVolume?.trim() || null,
        journalIssue: body.journalIssue?.trim() || null,
        pageRange: body.pageRange?.trim() || null,
        doi: body.doi?.trim() || null,
        url: body.url?.trim() || null,
        accessDate: body.accessDate?.trim() || null,
        importSource: body.importSource ?? 'manual',
        bibtexKey: body.bibtexKey?.trim() || null,
      },
    })

    return NextResponse.json(entry, { status: 201 })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
