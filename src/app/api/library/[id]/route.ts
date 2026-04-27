import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const entry = await prisma.libraryEntry.findFirst({
      where: { id, userId: session.user.id },
      include: {
        tags: { include: { tag: true } },
        bibliographies: {
          select: { id: true, projectId: true, project: { select: { title: true } } },
        },
      },
    })

    if (!entry) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json(entry)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/library/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params
    const body = await req.json()

    const existing = await prisma.libraryEntry.findFirst({
      where: { id, userId: session.user.id },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const entry = await prisma.libraryEntry.update({
      where: { id },
      data: {
        ...(body.entryType !== undefined && { entryType: body.entryType }),
        ...(body.authorSurname !== undefined && { authorSurname: body.authorSurname.trim() }),
        ...(body.authorName !== undefined && { authorName: body.authorName?.trim() || null }),
        ...(body.coAuthors !== undefined && {
          coAuthors: Array.isArray(body.coAuthors)
            ? body.coAuthors
                .map((a: { surname?: string; name?: string }) => ({
                  surname: a.surname?.trim() ?? '',
                  name: a.name?.trim() || null,
                }))
                .filter((a: { surname: string }) => a.surname.length > 0)
            : null
        }),
        ...(body.title !== undefined && { title: body.title.trim() }),
        ...(body.shortTitle !== undefined && { shortTitle: body.shortTitle?.trim() || null }),
        ...(body.editor !== undefined && { editor: body.editor?.trim() || null }),
        ...(body.translator !== undefined && { translator: body.translator?.trim() || null }),
        ...(body.publisher !== undefined && { publisher: body.publisher?.trim() || null }),
        ...(body.publishPlace !== undefined && { publishPlace: body.publishPlace?.trim() || null }),
        ...(body.year !== undefined && { year: body.year?.trim() || null }),
        ...(body.volume !== undefined && { volume: body.volume?.trim() || null }),
        ...(body.edition !== undefined && { edition: body.edition?.trim() || null }),
        ...(body.journalName !== undefined && { journalName: body.journalName?.trim() || null }),
        ...(body.journalVolume !== undefined && { journalVolume: body.journalVolume?.trim() || null }),
        ...(body.journalIssue !== undefined && { journalIssue: body.journalIssue?.trim() || null }),
        ...(body.pageRange !== undefined && { pageRange: body.pageRange?.trim() || null }),
        ...(body.doi !== undefined && { doi: body.doi?.trim() || null }),
        ...(body.url !== undefined && { url: body.url?.trim() || null }),
        ...(body.accessDate !== undefined && { accessDate: body.accessDate?.trim() || null }),
      },
    })

    return NextResponse.json(entry)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[PATCH /api/library/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const existing = await prisma.libraryEntry.findFirst({
      where: { id, userId: session.user.id },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    await prisma.libraryEntry.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[DELETE /api/library/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
