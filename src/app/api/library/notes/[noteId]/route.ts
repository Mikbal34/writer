/**
 * /api/library/notes/[noteId]
 *
 * PATCH  → edit a note's title, content, volume, or page.
 *          When `content` is updated, contentText is re-derived and the
 *          embedding is refreshed via setImmediate.
 * DELETE → remove the note (and via cascade, unlink any highlights
 *          that were paired with it — highlights themselves survive
 *          with note=null thanks to onDelete: SetNull on the relation).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { tiptapIsEmpty, tiptapJsonToPlainText } from '@/lib/tiptap-text'
import { embedLibraryNote } from '@/lib/library-pipeline'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ noteId: string }> }

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { noteId } = await ctx.params
    const body = (await req.json()) as {
      title?: string | null
      content?: unknown
      volumeId?: string | null
      pageNumber?: number | null
    }

    const note = await prisma.libraryNote.findFirst({
      where: { id: noteId, userId: session.user.id },
      select: { id: true, libraryEntryId: true },
    })
    if (!note) {
      return NextResponse.json({ error: 'Not bulunamadı' }, { status: 404 })
    }

    const data: Record<string, unknown> = {}
    let contentChanged = false

    if (body.title !== undefined) {
      data.title = body.title?.trim() || null
    }
    if (body.content !== undefined) {
      if (!body.content || typeof body.content !== 'object') {
        return NextResponse.json({ error: 'content geçersiz' }, { status: 400 })
      }
      if (tiptapIsEmpty(body.content)) {
        return NextResponse.json({ error: 'Not içeriği boş' }, { status: 400 })
      }
      const contentText = tiptapJsonToPlainText(body.content)
      if (contentText.length > 50_000) {
        return NextResponse.json(
          { error: 'Not 50.000 karakter sınırını aştı' },
          { status: 400 },
        )
      }
      data.content = body.content as object
      data.contentText = contentText
      contentChanged = true
    }
    if (body.volumeId !== undefined) {
      if (body.volumeId) {
        const vol = await prisma.libraryEntryVolume.findFirst({
          where: { id: body.volumeId, libraryEntryId: note.libraryEntryId },
          select: { id: true },
        })
        if (!vol) {
          return NextResponse.json({ error: 'Cilt bulunamadı' }, { status: 404 })
        }
      }
      data.volumeId = body.volumeId
    }
    if (body.pageNumber !== undefined) {
      data.pageNumber =
        body.pageNumber === null
          ? null
          : typeof body.pageNumber === 'number' && Number.isFinite(body.pageNumber)
            ? Math.floor(body.pageNumber)
            : null
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ ok: true })
    }

    const updated = await prisma.libraryNote.update({
      where: { id: noteId },
      data,
      select: {
        id: true,
        title: true,
        content: true,
        volumeId: true,
        pageNumber: true,
        pinnedFromChatSessionId: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    if (contentChanged) {
      setImmediate(() => {
        embedLibraryNote(noteId).catch((err) => {
          console.error('[notes/PATCH] re-embed failed:', noteId, err)
        })
      })
    }

    return NextResponse.json(updated)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[PATCH /api/library/notes/[noteId]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { noteId } = await ctx.params

    const note = await prisma.libraryNote.findFirst({
      where: { id: noteId, userId: session.user.id },
      select: { id: true },
    })
    if (!note) {
      return NextResponse.json({ error: 'Not bulunamadı' }, { status: 404 })
    }

    await prisma.libraryNote.delete({ where: { id: noteId } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[DELETE /api/library/notes/[noteId]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
