/**
 * Returns the user's library-chat session list, newest first. Each
 * row carries the first user prompt as a 60-char preview so the
 * sidebar can render meaningful labels without loading every message.
 *
 *   GET /api/library/chat/sessions
 *   →  { sessions: [{ sessionId, preview, createdAt, messageCount }] }
 */
import { NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface SessionRow {
  sessionId: string
  preview: string
  createdAt: Date
  messageCount: number
}

export async function GET() {
  try {
    const session = await requireAuth()

    // Aggregate per-session metadata in one round-trip.
    const rows = await prisma.$queryRaw<SessionRow[]>`
      SELECT s."sessionId" AS "sessionId",
             s.first_user_content AS preview,
             s.last_at AS "createdAt",
             s.msg_count AS "messageCount"
      FROM (
        SELECT "sessionId",
               MAX("createdAt") AS last_at,
               COUNT(*)::int AS msg_count,
               (
                 SELECT LEFT(content, 60)
                 FROM "LibraryChatMessage" m2
                 WHERE m2."sessionId" = m1."sessionId"
                   AND m2.role = 'user'
                 ORDER BY "createdAt" ASC
                 LIMIT 1
               ) AS first_user_content
        FROM "LibraryChatMessage" m1
        WHERE "userId" = ${session.user.id}
        GROUP BY "sessionId"
      ) s
      ORDER BY s.last_at DESC
      LIMIT 30
    `

    return NextResponse.json({
      sessions: rows.map((r) => ({
        sessionId: r.sessionId,
        preview: r.preview ?? '',
        createdAt: r.createdAt,
        messageCount: r.messageCount,
      })),
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET library/chat/sessions]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
