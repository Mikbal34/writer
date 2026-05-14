/**
 * POST /api/style/project-setup-chat
 *
 * Ephemeral chat (no DB persistence) used by the new-project wizard's
 * Step 4 — the project hasn't been created yet, so we just send the
 * conversation back and forth and let the client hold state. Returns a
 * single JSON turn each request: either the next question or the final
 * ProjectStyleOverrides object when the user is done.
 *
 * Body: {
 *   messages: [{ role, content }],
 *   basics:   { projectType, language, audience?, topic?, citationFormat? },
 *   current?: Partial<ProjectStyleOverrides>
 * }
 *
 * Response: { done, reply, styleOverrides? }
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { generateJSONWithUsage, HAIKU } from '@/lib/claude'
import { checkCredits, deductCredits } from '@/lib/credits'
import {
  type ProjectBasics,
  getProjectStyleSystemPrompt,
  inferProjectStyleDefaults,
  normaliseProjectStyleTurn,
} from '@/lib/prompts/project-style'
import type { ProjectStyleOverrides } from '@/types/project'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  messages?: Array<{ role: string; content: string }>
  basics?: ProjectBasics
  current?: Partial<ProjectStyleOverrides>
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()
    const body = (await req.json()) as Body
    const messages = body.messages ?? []
    const basics = body.basics

    if (!basics || !basics.projectType || !basics.language) {
      return NextResponse.json(
        { error: 'basics.projectType and basics.language are required' },
        { status: 400 },
      )
    }

    const credits = await checkCredits(session.user.id, 'style_interview')
    if (!credits.allowed) {
      return NextResponse.json(
        { error: 'Insufficient credits', balance: credits.balance, cost: credits.estimatedCost },
        { status: 402 },
      )
    }

    const defaults = inferProjectStyleDefaults(basics)
    const system = getProjectStyleSystemPrompt(basics, defaults, body.current ?? null)

    const transcript = messages
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n\n') || 'user: (no message yet)'

    const result = await generateJSONWithUsage<{
      done: boolean
      reply: string
      styleOverrides?: ProjectStyleOverrides
    }>(transcript, system, { model: HAIKU })

    await deductCredits(
      session.user.id,
      'style_interview',
      result.inputTokens,
      result.outputTokens,
      'haiku',
    )

    const turn = normaliseProjectStyleTurn(result.data)
    return NextResponse.json({
      done: turn.done,
      reply: turn.reply,
      styleOverrides: turn.styleOverrides ?? null,
      // Echo defaults so the client can offer a one-click "accept defaults"
      // button without re-running heuristics in the browser.
      defaults,
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/style/project-setup-chat]', err)
    return NextResponse.json(
      { error: 'Chat failed. Please try again.' },
      { status: 500 },
    )
  }
}
