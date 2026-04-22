import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

type EntryType = 'kitap' | 'makale' | 'nesir' | 'ceviri' | 'tez' | 'ansiklopedi' | 'web'

const VALID_ENTRY_TYPES: EntryType[] = [
  'kitap',
  'makale',
  'nesir',
  'ceviri',
  'tez',
  'ansiklopedi',
  'web',
]

// GET /api/bibliography?projectId=xxx
// Returns all bibliography entries for the specified project.
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth()

    const url = new URL(req.url)
    const projectId = url.searchParams.get('projectId')

    if (!projectId) {
      return NextResponse.json({ error: 'projectId query parameter is required' }, { status: 400 })
    }

    // Verify the project belongs to the requesting user
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: session.user.id },
      select: { id: true },
    })

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const entries = await prisma.bibliography.findMany({
      where: { projectId },
      orderBy: [{ authorSurname: 'asc' }, { authorName: 'asc' }, { year: 'asc' }],
      include: {
        source: { select: { id: true, filename: true, processed: true } },
        attachments: {
          orderBy: { createdAt: 'asc' },
          include: {
            source: {
              select: { id: true, filename: true, fileType: true, processed: true, totalPages: true },
            },
          },
        },
        _count: { select: { sourceMappings: true } },
      },
    })

    return NextResponse.json(entries)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/bibliography]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/bibliography
// Body: all bibliography fields; projectId is required.
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()

    const body = await req.json()
    const {
      projectId,
      sourceId,
      entryType,
      authorSurname,
      authorName,
      title,
      shortTitle,
      editor,
      translator,
      publisher,
      publishPlace,
      year,
      volume,
      edition,
      journalName,
      journalVolume,
      journalIssue,
      pageRange,
      doi,
      url,
      metadata,
    } = body as {
      projectId: string
      sourceId?: string
      entryType?: EntryType
      authorSurname: string
      authorName?: string
      title: string
      shortTitle?: string
      editor?: string
      translator?: string
      publisher?: string
      publishPlace?: string
      year?: string
      volume?: string
      edition?: string
      journalName?: string
      journalVolume?: string
      journalIssue?: string
      pageRange?: string
      doi?: string
      url?: string
      metadata?: Record<string, unknown>
    }

    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
    }
    if (!authorSurname || typeof authorSurname !== 'string' || authorSurname.trim() === '') {
      return NextResponse.json({ error: 'authorSurname is required' }, { status: 400 })
    }
    if (!title || typeof title !== 'string' || title.trim() === '') {
      return NextResponse.json({ error: 'title is required' }, { status: 400 })
    }
    if (entryType && !VALID_ENTRY_TYPES.includes(entryType)) {
      return NextResponse.json({ error: `Invalid entryType. Valid values: ${VALID_ENTRY_TYPES.join(', ')}` }, { status: 400 })
    }

    // Verify project ownership
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: session.user.id },
      select: { id: true },
    })
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Verify source belongs to same project if provided
    if (sourceId) {
      const source = await prisma.source.findFirst({
        where: { id: sourceId, projectId },
        select: { id: true },
      })
      if (!source) {
        return NextResponse.json({ error: 'Source not found in this project' }, { status: 404 })
      }
    }

    const entry = await prisma.bibliography.create({
      data: {
        projectId,
        sourceId: sourceId ?? null,
        entryType: entryType ?? 'kitap',
        authorSurname: authorSurname.trim(),
        authorName: authorName ?? null,
        title: title.trim(),
        shortTitle: shortTitle ?? null,
        editor: editor ?? null,
        translator: translator ?? null,
        publisher: publisher ?? null,
        publishPlace: publishPlace ?? null,
        year: year ?? null,
        volume: volume ?? null,
        edition: edition ?? null,
        journalName: journalName ?? null,
        journalVolume: journalVolume ?? null,
        journalIssue: journalIssue ?? null,
        pageRange: pageRange ?? null,
        doi: doi ?? null,
        url: url ?? null,
        metadata: metadata ? (metadata as unknown as object) : undefined,
      },
    })

    return NextResponse.json(entry, { status: 201 })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/bibliography]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
