/**
 * /api/library/entries/[id]/notes
 *
 * GET  → list notes for this entry (newest first). Tiptap JSON is
 *        included so the client can render rich text directly; the
 *        plaintext projection (contentText) is omitted from the
 *        response to keep payloads small.
 *
 * POST → create a note.
 *        Body: { title?, content (Tiptap JSON), volumeId?, pageNumber?,
 *                pinnedFromChatSessionId? }
 *        contentText is derived server-side from the Tiptap JSON; embed
 *        runs fire-and-forget after the response goes out so the user
 *        sees the new note instantly.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { tiptapIsEmpty, tiptapJsonToPlainText } from '@/lib/tiptap-text'
import { embedLibraryNote } from '@/lib/library-pipeline'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id: entryId } = await ctx.params

    const entry = await prisma.libraryEntry.findFirst({
      where: { id: entryId, userId: session.user.id },
      select: { id: true },
    })
    if (!entry) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const notes = await prisma.libraryNote.findMany({
      where: { libraryEntryId: entryId },
      orderBy: { updatedAt: 'desc' },
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

    return NextResponse.json({ notes })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/library/entries/[id]/notes]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const userId = session.user.id
    const { id: entryId } = await ctx.params
    const body = (await req.json()) as {
      title?: string
      content?: unknown
      volumeId?: string | null
      pageNumber?: number | null
      pinnedFromChatSessionId?: string | null
    }

    const entry = await prisma.libraryEntry.findFirst({
      where: { id: entryId, userId },
      select: { id: true },
    })
    if (!entry) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    if (!body.content || typeof body.content !== 'object') {
      return NextResponse.json({ error: 'content (Tiptap JSON) gerekli' }, { status: 400 })
    }
    if (tiptapIsEmpty(body.content)) {
      return NextResponse.json({ error: 'Not içeriği boş' }, { status: 400 })
    }
    const contentText = tiptapJsonToPlainText(body.content)
    if (contentText.length > 50_000) {
      return NextResponse.json({ error: 'Not 50.000 karakter sınırını aştı' }, { status: 400 })
    }

    // Verify volumeId, if supplied, belongs to this entry.
    if (body.volumeId) {
      const vol = await prisma.libraryEntryVolume.findFirst({
        where: { id: body.volumeId, libraryEntryId: entryId },
        select: { id: true },
      })
      if (!vol) {
        return NextResponse.json({ error: 'Cilt bulunamadı' }, { status: 404 })
      }
    }

    const note = await prisma.libraryNote.create({
      data: {
        libraryEntryId: entryId,
        userId,
        title: body.title?.trim() || null,
        // Prisma's Json type accepts the unknown content as-is — we've
        // already validated it's an object via tiptapIsEmpty above.
        content: body.content as object,
        contentText,
        volumeId: body.volumeId ?? null,
        pageNumber:
          typeof body.pageNumber === 'number' && Number.isFinite(body.pageNumber)
            ? Math.floor(body.pageNumber)
            : null,
        pinnedFromChatSessionId: body.pinnedFromChatSessionId ?? null,
      },
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

    // Fire-and-forget embedding — the note is usable for chat RAG
    // within a few seconds without blocking this response.
    setImmediate(() => {
      embedLibraryNote(note.id).catch((err) => {
        console.error('[notes/POST] embed failed:', note.id, err)
      })
    })

    return NextResponse.json(note, { status: 201 })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library/entries/[id]/notes]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
