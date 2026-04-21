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
    const page = parseInt(url.searchParams.get('page') ?? '1', 10)
    const limit = parseInt(url.searchParams.get('limit') ?? '50', 10)
    const skip = (page - 1) * limit

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

    const [entries, total] = await Promise.all([
      prisma.libraryEntry.findMany({
        where,
        include: {
          tags: { include: { tag: true } },
          _count: { select: { bibliographies: true } },
        },
        orderBy: { updatedAt: 'desc' },
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
