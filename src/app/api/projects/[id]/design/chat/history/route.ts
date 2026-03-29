import { NextRequest } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id: projectId } = await ctx.params

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: session.user.id },
      select: { id: true },
    })
    if (!project) {
      return Response.json({ error: 'Project not found' }, { status: 404 })
    }

    let targetSessionId = req.nextUrl.searchParams.get('sessionId')

    // Ensure the sessionId has "design-" prefix when querying
    if (targetSessionId && !targetSessionId.startsWith('design-')) {
      targetSessionId = `design-${targetSessionId}`
    }

    if (!targetSessionId) {
      // Find the latest design session (sessionId starts with "design-")
      const latest = await prisma.illustrationChatMessage.findFirst({
        where: {
          projectId,
          sessionId: { startsWith: 'design-' },
        },
        orderBy: { createdAt: 'desc' },
        select: { sessionId: true },
      })
      if (!latest) {
        return Response.json({ sessionId: null, messages: [], sessions: [] })
      }
      targetSessionId = latest.sessionId
    }

    const rows = await prisma.illustrationChatMessage.findMany({
      where: { projectId, sessionId: targetSessionId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
    })

    const messages = rows.map((r) => ({
      role: r.role as 'user' | 'assistant',
      content: r.content,
    }))

    // Load all design sessions
    const allMessages = await prisma.illustrationChatMessage.findMany({
      where: {
        projectId,
        role: 'user',
        sessionId: { startsWith: 'design-' },
      },
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
    console.error('[GET design/chat/history]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
