import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

type EntryType = 'kitap' | 'makale' | 'nesir' | 'ceviri' | 'tez' | 'ansiklopedi' | 'web'

type RouteContext = { params: Promise<{ id: string }> }

const VALID_ENTRY_TYPES: EntryType[] = [
  'kitap',
  'makale',
  'nesir',
  'ceviri',
  'tez',
  'ansiklopedi',
  'web',
]

// ---------------------------------------------------------------------------
// Helper: verify the bibliography entry belongs to the requesting user
// ---------------------------------------------------------------------------
async function getOwnedEntry(entryId: string, userId: string) {
  return prisma.bibliography.findFirst({
    where: {
      id: entryId,
      project: { userId },
    },
  })
}

// GET /api/bibliography/[id]
export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const entry = await prisma.bibliography.findFirst({
      where: { id, project: { userId: session.user.id } },
      include: {
        source: { select: { id: true, filename: true, fileType: true, processed: true } },
        sourceMappings: {
          include: {
            subsection: {
              select: {
                id: true,
                subsectionId: true,
                title: true,
              },
            },
          },
        },
      },
    })

    if (!entry) {
      return NextResponse.json({ error: 'Bibliography entry not found' }, { status: 404 })
    }

    return NextResponse.json(entry)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/bibliography/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/bibliography/[id]
// Body: any subset of bibliography fields
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const owned = await getOwnedEntry(id, session.user.id)
    if (!owned) {
      return NextResponse.json({ error: 'Bibliography entry not found' }, { status: 404 })
    }

    const body = await req.json()
    const {
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
    } = body as Partial<{
      sourceId: string | null
      entryType: EntryType
      authorSurname: string
      authorName: string | null
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
      metadata: Record<string, unknown> | null
    }>

    if (entryType !== undefined && !VALID_ENTRY_TYPES.includes(entryType)) {
      return NextResponse.json(
        { error: `Invalid entryType. Valid values: ${VALID_ENTRY_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    // Build the update payload as a plain object then cast to satisfy Prisma's
    // complex union input type (especially the Json metadata field).
    const updateData: Record<string, unknown> = {}
    if (sourceId !== undefined) updateData.sourceId = sourceId
    if (entryType !== undefined) updateData.entryType = entryType
    if (authorSurname !== undefined) updateData.authorSurname = authorSurname.trim()
    if (authorName !== undefined) updateData.authorName = authorName
    if (title !== undefined) updateData.title = title.trim()
    if (shortTitle !== undefined) updateData.shortTitle = shortTitle
    if (editor !== undefined) updateData.editor = editor
    if (translator !== undefined) updateData.translator = translator
    if (publisher !== undefined) updateData.publisher = publisher
    if (publishPlace !== undefined) updateData.publishPlace = publishPlace
    if (year !== undefined) updateData.year = year
    if (volume !== undefined) updateData.volume = volume
    if (edition !== undefined) updateData.edition = edition
    if (journalName !== undefined) updateData.journalName = journalName
    if (journalVolume !== undefined) updateData.journalVolume = journalVolume
    if (journalIssue !== undefined) updateData.journalIssue = journalIssue
    if (pageRange !== undefined) updateData.pageRange = pageRange
    if (doi !== undefined) updateData.doi = doi
    if (url !== undefined) updateData.url = url
    if (metadata !== undefined) updateData.metadata = metadata ?? null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated = await prisma.bibliography.update({
      where: { id },
      data: updateData as any,
    })

    return NextResponse.json(updated)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[PATCH /api/bibliography/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/bibliography/[id]
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const owned = await getOwnedEntry(id, session.user.id)
    if (!owned) {
      return NextResponse.json({ error: 'Bibliography entry not found' }, { status: 404 })
    }

    await prisma.bibliography.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[DELETE /api/bibliography/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
