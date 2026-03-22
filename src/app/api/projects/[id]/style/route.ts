import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { generateJSON, streamChat, HAIKU } from '@/lib/claude'
import type { StyleProfile } from '@/types/project'

type RouteContext = { params: Promise<{ id: string }> }

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const STYLE_ANALYSIS_SYSTEM = `You are an expert literary analyst specialising in academic and scholarly writing styles.
Analyse the provided writing sample and return a JSON object that strictly matches the StyleProfile schema.
Respond with valid JSON only. No markdown, no explanation.`

const INTERVIEW_SYSTEM = `You are a writing coach conducting a style preference interview.
Your goal is to understand the author's preferred writing style through targeted questions.
Ask one clear question at a time. After gathering enough information, signal completion by returning a JSON object
with "done": true and a fully populated "styleProfile" field. Otherwise return "done": false and "question": "..." .
Respond with valid JSON only.`

// ---------------------------------------------------------------------------
// POST /api/projects/[id]/style
// Body: { action: "analyze_sample" | "interview_next" | "save_profile", data: { ... } }
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true, styleProfile: true, language: true },
    })

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const body = await req.json()
    const { action, data } = body as {
      action: 'analyze_sample' | 'interview_next' | 'save_profile'
      data: Record<string, unknown>
    }

    // ------------------------------------------------------------------
    // analyze_sample – send a writing sample to Claude, receive StyleProfile
    // ------------------------------------------------------------------
    if (action === 'analyze_sample') {
      const sample = data?.sample as string | undefined
      if (!sample || typeof sample !== 'string' || sample.trim().length < 50) {
        return NextResponse.json(
          { error: 'data.sample must be at least 50 characters' },
          { status: 400 }
        )
      }

      const prompt = `Analyse the following writing sample and return a StyleProfile JSON object:\n\n---\n${sample}\n---`
      const styleProfile = await generateJSON<StyleProfile>(prompt, STYLE_ANALYSIS_SYSTEM, { model: HAIKU })

      const updated = await prisma.project.update({
        where: { id },
        // Cast through unknown so Prisma accepts the JSON value
        data: { styleProfile: styleProfile as unknown as object },
      })

      return NextResponse.json({ styleProfile: updated.styleProfile })
    }

    // ------------------------------------------------------------------
    // interview_next – continue/start the interactive style interview
    // ------------------------------------------------------------------
    if (action === 'interview_next') {
      const messages = (data?.messages as Array<{ role: 'user' | 'assistant'; content: string }>) ?? []

      // Build the streaming response so the client can display it live.
      // We also accumulate the full response text to detect "done" and persist.
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        async start(controller) {
          let accumulated = ''

          try {
            for await (const chunk of streamChat(messages, INTERVIEW_SYSTEM, { model: HAIKU })) {
              accumulated += chunk
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk })}\n\n`))
            }

            // After streaming completes, try to detect a JSON done signal
            let parsed: { done: boolean; question?: string; styleProfile?: StyleProfile } | null = null
            const trimmed = accumulated.trim()
            if (trimmed.startsWith('{')) {
              try {
                parsed = JSON.parse(trimmed)
              } catch {
                // Response was plain text prose – not a JSON signal
              }
            }

            if (parsed?.done && parsed.styleProfile) {
              await prisma.project.update({
                where: { id },
                data: { styleProfile: parsed.styleProfile as unknown as object },
              })
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ done: true, styleProfile: parsed.styleProfile })}\n\n`)
              )
            } else {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: false })}\n\n`))
            }

            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
          } catch (streamErr) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ error: String(streamErr) })}\n\n`)
            )
            controller.close()
          }
        },
      })

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    }

    // ------------------------------------------------------------------
    // save_profile – directly persist a provided StyleProfile object
    // ------------------------------------------------------------------
    if (action === 'save_profile') {
      const profile = data?.styleProfile as Record<string, unknown> | undefined
      if (!profile || typeof profile !== 'object') {
        return NextResponse.json({ error: 'data.styleProfile is required' }, { status: 400 })
      }

      const updated = await prisma.project.update({
        where: { id },
        data: { styleProfile: profile as unknown as object },
      })

      return NextResponse.json({ styleProfile: updated.styleProfile })
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/projects/[id]/style]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
