/**
 * /api/library/entries/[id]/highlights
 *
 * GET   ?page=N     → page-scoped list for the viewer overlay. If page
 *                     is omitted we return ALL highlights for the entry
 *                     so the HighlightsTab can render its grouped list.
 *
 * POST              → create a highlight, optionally with a linked note.
 *      Body: {
 *        pageNumber: number,
 *        text: string,
 *        rangeRects: Array<{ x: number; y: number; w: number; h: number }>,
 *                    // each in 0-1 page-relative units so the overlay
 *                    // is zoom-independent
 *        color?: string,            // CSS hex, defaults to #FFEB3B
 *        volumeId?: string | null,
 *        createNote?: boolean,      // if true, also POST a LibraryNote
 *                                   // anchored to this page with the
 *                                   // quoted text as its body
 *        noteTitle?: string,
 *      }
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { embedLibraryNote } from '@/lib/library-pipeline'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

interface RangeRect {
  x: number
  y: number
  w: number
  h: number
}

function isValidRect(r: unknown): r is RangeRect {
  if (!r || typeof r !== 'object') return false
  const o = r as Record<string, unknown>
  return (
    typeof o.x === 'number' &&
    typeof o.y === 'number' &&
    typeof o.w === 'number' &&
    typeof o.h === 'number' &&
    o.x >= 0 && o.x <= 1 &&
    o.y >= 0 && o.y <= 1 &&
    o.w >= 0 && o.w <= 1 &&
    o.h >= 0 && o.h <= 1
  )
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id: entryId } = await ctx.params
    const pageParam = new URL(req.url).searchParams.get('page')

    const entry = await prisma.libraryEntry.findFirst({
      where: { id: entryId, userId: session.user.id },
      select: { id: true },
    })
    if (!entry) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const where: Record<string, unknown> = { libraryEntryId: entryId }
    if (pageParam) {
      const n = parseInt(pageParam, 10)
      if (Number.isFinite(n) && n > 0) where.pageNumber = n
    }

    const highlights = await prisma.libraryHighlight.findMany({
      where,
      orderBy: [{ pageNumber: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        pageNumber: true,
        text: true,
        rangeRects: true,
        color: true,
        volumeId: true,
        noteId: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ highlights })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/library/entries/[id]/highlights]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const userId = session.user.id
    const { id: entryId } = await ctx.params
    const body = (await req.json()) as {
      pageNumber?: number
      text?: string
      rangeRects?: unknown[]
      color?: string
      volumeId?: string | null
      createNote?: boolean
      noteTitle?: string
    }

    const entry = await prisma.libraryEntry.findFirst({
      where: { id: entryId, userId },
      select: { id: true },
    })
    if (!entry) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    if (
      typeof body.pageNumber !== 'number' ||
      !Number.isFinite(body.pageNumber) ||
      body.pageNumber < 1
    ) {
      return NextResponse.json({ error: 'pageNumber gerekli' }, { status: 400 })
    }
    if (!body.text || typeof body.text !== 'string' || body.text.trim().length === 0) {
      return NextResponse.json({ error: 'Seçilen metin boş' }, { status: 400 })
    }
    if (body.text.length > 20_000) {
      return NextResponse.json({ error: 'Seçim çok uzun' }, { status: 400 })
    }
    if (!Array.isArray(body.rangeRects) || body.rangeRects.length === 0) {
      return NextResponse.json({ error: 'rangeRects gerekli' }, { status: 400 })
    }
    const rects = body.rangeRects.filter(isValidRect)
    if (rects.length === 0) {
      return NextResponse.json({ error: 'Geçersiz rangeRects' }, { status: 400 })
    }

    if (body.volumeId) {
      const vol = await prisma.libraryEntryVolume.findFirst({
        where: { id: body.volumeId, libraryEntryId: entryId },
        select: { id: true },
      })
      if (!vol) {
        return NextResponse.json({ error: 'Cilt bulunamadı' }, { status: 404 })
      }
    }

    // Optionally create a paired note. We persist the note FIRST so the
    // highlight points back to it; if the highlight insert fails we
    // delete the orphan note in the catch.
    let createdNoteId: string | null = null
    if (body.createNote) {
      const note = await prisma.libraryNote.create({
        data: {
          libraryEntryId: entryId,
          userId,
          volumeId: body.volumeId ?? null,
          title: body.noteTitle?.trim() || null,
          pageNumber: Math.floor(body.pageNumber),
          // Block-quote the highlighted text so the note opens as a
          // properly-formatted starting point the user can extend.
          content: {
            type: 'doc',
            content: [
              {
                type: 'blockquote',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: body.text.trim() }],
                  },
                ],
              },
            ],
          },
          contentText: body.text.trim(),
        },
        select: { id: true },
      })
      createdNoteId = note.id
      setImmediate(() => {
        embedLibraryNote(note.id).catch((err) => {
          console.error('[highlights/POST] note embed failed:', note.id, err)
        })
      })
    }

    try {
      const hl = await prisma.libraryHighlight.create({
        data: {
          libraryEntryId: entryId,
          userId,
          volumeId: body.volumeId ?? null,
          noteId: createdNoteId,
          pageNumber: Math.floor(body.pageNumber),
          text: body.text.trim(),
          rangeRects: rects as unknown as Prisma.InputJsonValue,
          color: body.color ?? '#FFEB3B',
        },
        select: {
          id: true,
          pageNumber: true,
          text: true,
          rangeRects: true,
          color: true,
          noteId: true,
          createdAt: true,
        },
      })
      return NextResponse.json(hl, { status: 201 })
    } catch (err) {
      // Roll back the auto-created note so we don't leave an orphan.
      if (createdNoteId) {
        await prisma.libraryNote.delete({ where: { id: createdNoteId } }).catch(() => undefined)
      }
      throw err
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library/entries/[id]/highlights]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
