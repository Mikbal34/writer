import Anthropic from '@anthropic-ai/sdk'

const SONNET = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6'
const HAIKU = process.env.CLAUDE_HAIKU_MODEL || 'claude-haiku-4-5-20251001'

export { SONNET, HAIKU }

export interface SystemPromptPart {
  text: string
  cache?: boolean
}

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

function buildSystemParam(
  systemPrompt?: string | SystemPromptPart[]
): string | Anthropic.Messages.TextBlockParam[] | undefined {
  if (!systemPrompt) return undefined
  if (typeof systemPrompt === 'string') return systemPrompt
  return systemPrompt.map((part) => ({
    type: 'text' as const,
    text: part.text,
    ...(part.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
  }))
}

export async function* streamChat(
  messages: ChatMessage[],
  systemPrompt?: string | SystemPromptPart[],
  options?: { model?: string }
): AsyncGenerator<string, void, unknown> {
  const client = createClaudeClient()

  const stream = await client.messages.stream({
    model: options?.model ?? SONNET,
    max_tokens: 32768,
    system: buildSystemParam(systemPrompt),
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

export interface StreamResult {
  fullText: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

export async function streamChatWithUsage(
  messages: ChatMessage[],
  systemPrompt?: string | SystemPromptPart[],
  onChunk?: (text: string) => void,
  options?: { model?: string }
): Promise<StreamResult> {
  const client = createClaudeClient()

  const response = await client.messages.create({
    model: options?.model ?? SONNET,
    max_tokens: 32768,
    system: buildSystemParam(systemPrompt),
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    stream: true,
  })

  let fullText = ''
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheCreationTokens = 0

  for await (const event of response) {
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta'
    ) {
      fullText += event.delta.text
      onChunk?.(event.delta.text)
    }
    if (event.type === 'message_start' && event.message?.usage) {
      inputTokens = event.message.usage.input_tokens
      const usage = event.message.usage as unknown as Record<string, number>
      cacheReadTokens = usage.cache_read_input_tokens ?? 0
      cacheCreationTokens = usage.cache_creation_input_tokens ?? 0
    }
    if (event.type === 'message_delta' && event.usage) {
      outputTokens = event.usage.output_tokens
    }
  }

  return { fullText, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens }
}

export type ToolDefinition = Anthropic.Messages.Tool

export interface ToolCallResult {
  toolName: string
  toolInput: Record<string, unknown>
  result: string
}

/**
 * Maximum characters for a single tool result before truncation.
 * Prevents token explosion from large DB queries (chapters, library entries).
 */
const MAX_TOOL_RESULT_CHARS = 12000

function truncateToolResult(result: string, maxChars: number = MAX_TOOL_RESULT_CHARS): string {
  if (result.length <= maxChars) return result
  const half = Math.floor(maxChars / 2)
  return result.slice(0, half) + '\n\n[...truncated — result too large...]\n\n' + result.slice(-half)
}

export async function streamChatWithTools(
  messages: ChatMessage[],
  systemPrompt: string | SystemPromptPart[],
  tools: ToolDefinition[],
  handleToolCall: (toolName: string, toolInput: Record<string, unknown>) => Promise<string>,
  onChunk?: (text: string) => void,
  onToolCall?: (toolName: string) => void,
  options?: { model?: string; maxIterations?: number; maxToolResultChars?: number; cacheTools?: boolean }
): Promise<StreamResult> {
  const client = createClaudeClient()
  const model = options?.model ?? SONNET
  const maxIterations = options?.maxIterations ?? 5
  const maxResultChars = options?.maxToolResultChars ?? MAX_TOOL_RESULT_CHARS

  // Cache-control on the final tool marks the tools block as cacheable —
  // a big win when the tool definitions are large and identical across turns.
  const apiTools: ToolDefinition[] =
    options?.cacheTools && tools.length > 0
      ? [
          ...tools.slice(0, -1),
          { ...tools[tools.length - 1], cache_control: { type: 'ephemeral' as const } } as ToolDefinition,
        ]
      : tools

  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalCacheReadTokens = 0
  let totalCacheCreationTokens = 0
  let fullText = ''

  // Build the messages array in Anthropic's native format for tool use
  const apiMessages: Anthropic.Messages.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }))

  for (let i = 0; i < maxIterations; i++) {
    const response = await client.messages.create({
      model,
      max_tokens: 32768,
      system: buildSystemParam(systemPrompt),
      messages: apiMessages,
      tools: apiTools,
      stream: true,
    })

    let iterationText = ''
    let iterationInputTokens = 0
    let iterationOutputTokens = 0
    let iterationCacheRead = 0
    let iterationCacheCreation = 0
    const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = []
    let currentToolId = ''
    let currentToolName = ''
    let currentToolInput = ''
    let stopReason: string | null = null

    for await (const event of response) {
      if (event.type === 'message_start' && event.message?.usage) {
        iterationInputTokens = event.message.usage.input_tokens
        const usage = event.message.usage as unknown as Record<string, number>
        iterationCacheRead = usage.cache_read_input_tokens ?? 0
        iterationCacheCreation = usage.cache_creation_input_tokens ?? 0
      }
      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'tool_use') {
          currentToolId = event.content_block.id
          currentToolName = event.content_block.name
          currentToolInput = ''
        }
      }
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          iterationText += event.delta.text
          onChunk?.(event.delta.text)
        }
        if (event.delta.type === 'input_json_delta') {
          currentToolInput += event.delta.partial_json
        }
      }
      if (event.type === 'content_block_stop' && currentToolId) {
        try {
          const parsed = currentToolInput ? JSON.parse(currentToolInput) : {}
          toolCalls.push({ id: currentToolId, name: currentToolName, input: parsed })
        } catch {
          toolCalls.push({ id: currentToolId, name: currentToolName, input: {} })
        }
        currentToolId = ''
        currentToolName = ''
        currentToolInput = ''
      }
      if (event.type === 'message_delta') {
        if (event.usage) {
          iterationOutputTokens = event.usage.output_tokens
        }
        if (event.delta?.stop_reason) {
          stopReason = event.delta.stop_reason
        }
      }
    }

    totalInputTokens += iterationInputTokens
    totalOutputTokens += iterationOutputTokens
    totalCacheReadTokens += iterationCacheRead
    totalCacheCreationTokens += iterationCacheCreation
    fullText += iterationText

    // If no tool calls, we're done
    if (stopReason !== 'tool_use' || toolCalls.length === 0) {
      break
    }

    // Build assistant message with both text and tool_use blocks
    const assistantContent: Anthropic.Messages.ContentBlockParam[] = []
    if (iterationText) {
      assistantContent.push({ type: 'text', text: iterationText })
    }
    for (const tc of toolCalls) {
      assistantContent.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.name,
        input: tc.input,
      })
    }
    apiMessages.push({ role: 'assistant', content: assistantContent })

    // Execute tool calls and add results (with size limiting)
    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = []
    for (const tc of toolCalls) {
      onToolCall?.(tc.name)
      const result = await handleToolCall(tc.name, tc.input)
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tc.id,
        content: truncateToolResult(result, maxResultChars),
      })
    }
    apiMessages.push({ role: 'user', content: toolResults })
  }

  return {
    fullText,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    cacheReadTokens: totalCacheReadTokens,
    cacheCreationTokens: totalCacheCreationTokens,
  }
}

export interface JSONResult<T> {
  data: T
  inputTokens: number
  outputTokens: number
}

export async function generateJSONWithUsage<T = unknown>(
  prompt: string,
  systemPrompt?: string,
  options?: { model?: string }
): Promise<JSONResult<T>> {
  const client = createClaudeClient()

  const jsonSystemPrompt = [
    systemPrompt,
    'You must respond with valid JSON only. Do not include markdown code fences, explanations, or any text outside of the JSON object.',
  ]
    .filter(Boolean)
    .join('\n\n')

  const stream = await client.messages.stream({
    model: options?.model ?? SONNET,
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
    return {
      data: JSON.parse(jsonString) as T,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    }
  } catch {
    throw new Error(
      `Failed to parse Claude response as JSON.\nRaw response:\n${raw}`
    )
  }
}

export async function generateJSON<T = unknown>(
  prompt: string,
  systemPrompt?: string,
  options?: { model?: string }
): Promise<T> {
  const client = createClaudeClient()

  const jsonSystemPrompt = [
    systemPrompt,
    'You must respond with valid JSON only. Do not include markdown code fences, explanations, or any text outside of the JSON object.',
  ]
    .filter(Boolean)
    .join('\n\n')

  const stream = await client.messages.stream({
    model: options?.model ?? SONNET,
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
