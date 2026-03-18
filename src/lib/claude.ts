import Anthropic from '@anthropic-ai/sdk'

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6'

export function createClaudeClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set')
  }
  return new Anthropic({ apiKey })
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function* streamChat(
  messages: ChatMessage[],
  systemPrompt?: string
): AsyncGenerator<string, void, unknown> {
  const client = createClaudeClient()

  const stream = await client.messages.stream({
    model: MODEL,
    max_tokens: 16384,
    system: systemPrompt,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  })

  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta'
    ) {
      yield event.delta.text
    }
  }
}

export async function generateJSON<T = unknown>(
  prompt: string,
  systemPrompt?: string
): Promise<T> {
  const client = createClaudeClient()

  const jsonSystemPrompt = [
    systemPrompt,
    'You must respond with valid JSON only. Do not include markdown code fences, explanations, or any text outside of the JSON object.',
  ]
    .filter(Boolean)
    .join('\n\n')

  const stream = await client.messages.stream({
    model: MODEL,
    max_tokens: 32768,
    system: jsonSystemPrompt,
    messages: [{ role: 'user', content: prompt }],
  })

  const response = await stream.finalMessage()

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude returned no text content')
  }

  const raw = textBlock.text.trim()

  const jsonString = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  try {
    return JSON.parse(jsonString) as T
  } catch {
    throw new Error(
      `Failed to parse Claude response as JSON.\nRaw response:\n${raw}`
    )
  }
}
