/**
 * Returns the messages of one library-chat session in chronological
 * order. Used by the /library/chat UI to restore a thread when the
 * user clicks an old session.
 *
 *   GET /api/library/chat/history?sessionId=xxx
 *   →  { messages: [{ id, role, content, sources, scope, entryIds, createdAt }] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth()
    const sessionId = req.nextUrl.searchParams.get('sessionId')?.trim()
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
    }
    const messages = await prisma.libraryChatMessage.findMany({
      where: { userId: session.user.id, sessionId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        content: true,
        sources: true,
        scope: true,
        entryIds: true,
        createdAt: true,
      },
    })
    return NextResponse.json({ messages })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET library/chat/history]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
