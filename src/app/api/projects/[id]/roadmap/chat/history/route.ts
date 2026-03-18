import { NextRequest } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

type RouteContext = { params: Promise<{ id: string }> }

// GET — load a session's messages
// ?sessionId=xxx  → load specific session
// no param        → load latest session
export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id: projectId } = await ctx.params

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: session.user.id },
      select: { id: true },
    })

    if (!project) {
      return new Response(JSON.stringify({ error: 'Project not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Determine which session to load
    let targetSessionId = req.nextUrl.searchParams.get('sessionId')

    if (!targetSessionId) {
      const latest = await prisma.roadmapChatMessage.findFirst({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        select: { sessionId: true },
      })
      if (!latest) {
        return Response.json({ sessionId: null, messages: [], sessions: [] })
      }
      targetSessionId = latest.sessionId
    }

    // Load messages for the target session
    const rows = await prisma.roadmapChatMessage.findMany({
      where: { projectId, sessionId: targetSessionId },
      orderBy: { createdAt: 'asc' },
      select: {
        role: true,
        content: true,
        commands: true,
        commandsApplied: true,
      },
    })

    const messages = rows.map((r) => ({
      role: r.role as 'user' | 'assistant',
      content: r.content,
      commands: r.commands ?? undefined,
      commandsApplied: r.commandsApplied,
    }))

    // Load all sessions for sidebar (first user message as preview)
    const allMessages = await prisma.roadmapChatMessage.findMany({
      where: { projectId, role: 'user' },
      orderBy: { createdAt: 'asc' },
      select: { sessionId: true, content: true, createdAt: true },
    })

    const sessionMap = new Map<string, { preview: string; createdAt: Date }>()
    for (const msg of allMessages) {
      if (!sessionMap.has(msg.sessionId)) {
        sessionMap.set(msg.sessionId, {
          preview: msg.content.slice(0, 80),
          createdAt: msg.createdAt,
        })
      }
    }

    const sessions = Array.from(sessionMap.entries())
      .map(([id, data]) => ({ id, preview: data.preview, createdAt: data.createdAt }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    return Response.json({ sessionId: targetSessionId, messages, sessions })
  } catch (err) {
    if (err instanceof AuthError) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/projects/[id]/roadmap/chat/history]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
