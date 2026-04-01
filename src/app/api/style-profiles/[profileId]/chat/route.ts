import { NextRequest } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { streamChatWithUsage, HAIKU, type ChatMessage } from '@/lib/claude'
import { compressHistory, type ChatType } from '@/lib/conversation'
import { checkCredits, deductCredits } from '@/lib/credits'
import { getStyleTwinSystemPrompt, parseStyleProfileFromChat } from '@/lib/prompts/style-twin'
import type { StyleProfile } from '@/types/project'

type RouteContext = { params: Promise<{ profileId: string }> }

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { profileId } = await ctx.params

    const styleProfile = await prisma.userStyleProfile.findFirst({
      where: { id: profileId, userId: session.user.id },
      select: { id: true, profile: true },
    })

    if (!styleProfile) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json()
    const messages = (body.messages ?? []) as ChatMessage[]
    const sessionId = (body.sessionId ?? '') as string
    const userContent = messages.length > 0 ? messages[messages.length - 1].content : ''

    // Credit check
    const credits = await checkCredits(session.user.id, 'style_interview')
    if (!credits.allowed) {
      return new Response(
        JSON.stringify({ error: 'Insufficient credits', balance: credits.balance, cost: credits.estimatedCost }),
        { status: 402, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const currentProfile = styleProfile.profile as Partial<StyleProfile> | null
    const systemPrompt = getStyleTwinSystemPrompt(currentProfile)

    // Compress history — token-based with structured style prompt
    const { messages: compressedMessages } = await compressHistory(messages, {
      chatType: 'style' as ChatType,
      maxTokens: 20000,
      keepRecent: 4,
    })

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const result = await streamChatWithUsage(
            compressedMessages,
            systemPrompt,
            (chunk) => {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ chunk })}\n\n`)
              )
            },
            { model: HAIKU }
          )

          // Deduct credits
          const { newBalance, creditsUsed } = await deductCredits(
            session.user.id,
            'style_interview',
            result.inputTokens,
            result.outputTokens,
            'haiku',
            { styleProfileId: profileId }
          )

          // Check for style_profile tag in response
          const parsedProfile = parseStyleProfileFromChat(result.fullText)
          let profileUpdated = false

          if (parsedProfile) {
            try {
              await prisma.userStyleProfile.update({
                where: { id: profileId },
                data: { profile: parsedProfile as object },
              })
              profileUpdated = true
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ step: 'profile_updated' })}\n\n`)
              )
            } catch (updateErr) {
              console.error('[style-chat] Failed to update profile:', updateErr)
            }
          }

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ done: true, profileUpdated, creditsUsed, balance: newBalance })}\n\n`
            )
          )

          // Save chat messages
          const strippedContent = result.fullText
            .replace(/<style_profile>[\s\S]*?<\/style_profile>/g, '')
            .trim()

          try {
            await prisma.styleChatMessage.createMany({
              data: [
                {
                  styleProfileId: profileId,
                  sessionId,
                  role: 'user',
                  content: userContent,
                },
                {
                  styleProfileId: profileId,
                  sessionId,
                  role: 'assistant',
                  content: strippedContent,
                },
              ],
            })
          } catch (saveErr) {
            console.error('[style-chat] Failed to save messages:', saveErr)
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        } catch (streamErr) {
          console.error('[style-chat] Stream error:', streamErr)
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: 'Stream failed' })}\n\n`)
          )
        } finally {
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
  } catch (err) {
    if (err instanceof AuthError) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    console.error('[POST /api/style-profiles/[profileId]/chat]', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
