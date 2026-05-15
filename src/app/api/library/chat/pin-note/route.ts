/**
 * POST /api/library/chat/pin-note
 *
 * Persist a chat assistant message as a LibraryNote on a specific
 * entry. Used by the "📌 Nota Kaydet" button under each assistant
 * bubble in the library chat.
 *
 *   Body: { sessionId, messageContent, entryId, title?, volumeId? }
 *
 * `messageContent` is the raw text the user wants saved (we don't
 * trust the client to know which messageId to grab; passing the
 * content explicitly is simpler and survives chat-history compaction).
 * The note is built as a Tiptap document (single paragraph) so it
 * looks native in NotesTab; the user can later open it and reformat.
 *
 * `pinnedFromChatSessionId` is stamped so NotesTab can render the
 * 📌 Chat'ten badge and (eventually) jump back to the session.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { embedLibraryNote } from '@/lib/library-pipeline'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  sessionId?: string
  messageContent?: string
  entryId?: string
  title?: string
  volumeId?: string | null
}

/**
 * Wrap a plain string in the minimal Tiptap doc shape so the note
 * renders inside NotesTab without server-side import of Tiptap.
 * Newlines become separate paragraphs.
 */
function textToTiptapDoc(text: string): object {
  const paragraphs = text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: p }],
    }))
  return {
    type: 'doc',
    content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph' }],
  }
}

/** Derive a 60-char preview as a default note title. */
function deriveTitle(content: string): string {
  const trimmed = content.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= 60) return trimmed
  return trimmed.slice(0, 57) + '…'
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()
    const userId = session.user.id
    const body = (await req.json()) as Body

    const sessionId = body.sessionId?.trim()
    const messageContent = body.messageContent?.trim()
    const entryId = body.entryId?.trim()

    if (!sessionId || !messageContent || !entryId) {
      return NextResponse.json(
        { error: 'sessionId, messageContent, entryId gerekli' },
        { status: 400 },
      )
    }
    if (messageContent.length > 50_000) {
      return NextResponse.json(
        { error: 'Mesaj çok uzun (50.000 karakter sınırı)' },
        { status: 400 },
      )
    }

    const entry = await prisma.libraryEntry.findFirst({
      where: { id: entryId, userId },
      select: { id: true },
    })
    if (!entry) {
      return NextResponse.json({ error: 'Kaynak bulunamadı' }, { status: 404 })
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

    const note = await prisma.libraryNote.create({
      data: {
        libraryEntryId: entryId,
        userId,
        volumeId: body.volumeId ?? null,
        title: body.title?.trim() || deriveTitle(messageContent),
        content: textToTiptapDoc(messageContent),
        contentText: messageContent,
        pinnedFromChatSessionId: sessionId,
      },
      select: {
        id: true,
        title: true,
        pinnedFromChatSessionId: true,
        createdAt: true,
      },
    })

    setImmediate(() => {
      embedLibraryNote(note.id).catch((err) => {
        console.error('[chat/pin-note] embed failed:', note.id, err)
      })
    })

    return NextResponse.json(note, { status: 201 })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library/chat/pin-note]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
