import { type ChatMessage, streamChatWithUsage, HAIKU } from '@/lib/claude'

// ---------------------------------------------------------------------------
// Token estimation — rough but fast, no API call needed
// Claude tokenizer averages ~4 chars per token for mixed content
// ---------------------------------------------------------------------------
const CHARS_PER_TOKEN = 4

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 10, 0) // +10 per message overhead
}

// ---------------------------------------------------------------------------
// Chat type definitions for structured compaction prompts
// ---------------------------------------------------------------------------
export type ChatType = 'roadmap' | 'preview' | 'design' | 'style' | 'general'

interface CompactOptions {
  /** Max token budget for conversation history (default: auto-calculated) */
  maxTokens?: number
  /** Token threshold that triggers compaction (default: 80% of maxTokens) */
  compactThreshold?: number
  /** Chat type for structured summarization prompt */
  chatType?: ChatType
  /** Number of recent messages to always preserve */
  keepRecent?: number
  /** Additional context to re-inject after compaction (post-compact cleanup) */
  reinjectContext?: string
}

// ---------------------------------------------------------------------------
// Circuit breaker — stop retrying after consecutive failures
// ---------------------------------------------------------------------------
const MAX_COMPACT_FAILURES = 3
const compactFailureCount = new Map<string, number>()

function getFailureKey(chatType: ChatType): string {
  return `compact_${chatType}`
}

function recordCompactFailure(chatType: ChatType): boolean {
  const key = getFailureKey(chatType)
  const count = (compactFailureCount.get(key) ?? 0) + 1
  compactFailureCount.set(key, count)
  return count >= MAX_COMPACT_FAILURES
}

function resetCompactFailures(chatType: ChatType): void {
  compactFailureCount.delete(getFailureKey(chatType))
}

// ---------------------------------------------------------------------------
// Structured compaction prompts — inspired by Claude Code's 9-section prompt
// ---------------------------------------------------------------------------
const COMPACT_PROMPTS: Record<ChatType, string> = {
  roadmap: `You are summarizing a book roadmap planning conversation. Create a structured summary with these sections:

1. **Book Overview**: Project title, type, topic, target audience, language
2. **Key Decisions**: What was decided about structure — chapters added/removed/modified, section changes
3. **Source Decisions**: Any decisions about academic sources, citation preferences, source density
4. **User Preferences**: Writing style, POV, genre, tone, pacing, or any other preferences expressed
5. **Current State**: What the roadmap looks like now — how many chapters, approximate structure
6. **Pending Items**: Any unresolved questions or things the user still needs to decide

Be concise. Max 300 words. Preserve all database IDs (dbId values) mentioned. Preserve exact user quotes for preferences.`,

  preview: `You are summarizing a book illustration/preview conversation. Create a structured summary with these sections:

1. **Characters Created**: List all characters with their names and key visual traits
2. **Images Generated**: Which scenes/chapters got illustrations, art style used
3. **Art Direction**: Current art style, any style preferences expressed
4. **Pending Work**: What illustrations or characters were discussed but not yet created

Be concise. Max 200 words. Preserve all character names and database IDs.`,

  design: `You are summarizing a book design conversation. Create a structured summary with these sections:

1. **Design Choices**: What preset was applied, what customizations were made
2. **Current Settings**: Key design values (fonts, sizes, colors, page size)
3. **User Preferences**: Any specific design preferences expressed

Be concise. Max 150 words.`,

  style: `You are summarizing a writing style interview conversation. Create a structured summary with these sections:

1. **Style Profile**: All style attributes discovered (POV, genre, tone, pacing, etc.)
2. **Writing Samples**: Any writing samples or examples the user shared
3. **Preferences**: Specific writing preferences expressed

Be concise. Max 200 words. Preserve exact style attribute values.`,

  general: `You are summarizing a conversation. Focus on:
1. Key decisions made
2. Important information shared by the user
3. Current state of work
4. Any pending questions or next steps

Be concise. Max 200 words.`,
}

// ---------------------------------------------------------------------------
// Microcompact — strip old tool results from message history
// Inspired by Claude Code's microcompact layer that removes stale tool data
// ---------------------------------------------------------------------------
function microcompactMessages(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= 6) return messages

  // Tool result patterns that can be safely stripped from older messages
  // Keep recent messages intact, only strip from older ones
  const keepRecentCount = 4
  const cutoff = messages.length - keepRecentCount

  return messages.map((m, idx) => {
    if (idx >= cutoff) return m // preserve recent messages as-is
    if (m.role !== 'assistant') return m

    // Strip large JSON blocks from older assistant messages (tool results embedded in context)
    // These are typically chapter details, library entries, design configs
    let content = m.content

    // Truncate very long assistant messages that contain tool result data
    if (content.length > 1500) {
      // Try to preserve the human-readable explanation, strip the data
      const jsonStart = content.indexOf('```json')
      const jsonBlock = content.indexOf('{')

      if (jsonStart !== -1 && jsonStart < 500) {
        // Has a JSON code block early — likely tool result dump
        content = content.slice(0, jsonStart) + '[...previous tool data cleared...]\n'
      } else if (content.length > 2000) {
        // Just too long — truncate with context preservation
        content = content.slice(0, 800) + '\n[...truncated...]'
      }
    }

    return { ...m, content }
  })
}

// ---------------------------------------------------------------------------
// Main compaction function
// ---------------------------------------------------------------------------
export interface CompactResult {
  messages: ChatMessage[]
  summary: string | null
  wasCompacted: boolean
  estimatedTokensBefore: number
  estimatedTokensAfter: number
}

export async function compressHistory(
  messages: ChatMessage[],
  options: CompactOptions = {}
): Promise<CompactResult> {
  const {
    maxTokens = 30000,
    compactThreshold = Math.floor(maxTokens * 0.8),
    chatType = 'general',
    keepRecent = 4,
    reinjectContext,
  } = options

  const estimatedTokensBefore = estimateMessagesTokens(messages)

  // If under threshold, just apply microcompact and return
  if (estimatedTokensBefore <= compactThreshold) {
    const microcompacted = microcompactMessages(messages)
    const tokensAfter = estimateMessagesTokens(microcompacted)
    return {
      messages: microcompacted,
      summary: null,
      wasCompacted: false,
      estimatedTokensBefore,
      estimatedTokensAfter: tokensAfter,
    }
  }

  // Check circuit breaker
  const failureKey = getFailureKey(chatType)
  if ((compactFailureCount.get(failureKey) ?? 0) >= MAX_COMPACT_FAILURES) {
    console.warn(`[conversation] Circuit breaker open for ${chatType} — skipping compaction`)
    // Fallback: aggressive microcompact + keep fewer messages
    const fallbackMessages = [
      messages[0],
      ...messages.slice(-(keepRecent - 1)),
    ]
    return {
      messages: fallbackMessages,
      summary: null,
      wasCompacted: false,
      estimatedTokensBefore,
      estimatedTokensAfter: estimateMessagesTokens(fallbackMessages),
    }
  }

  // --- LAYER 1: Microcompact first ---
  const microcompacted = microcompactMessages(messages)
  const tokensAfterMicro = estimateMessagesTokens(microcompacted)

  // If microcompact brought us under threshold, done
  if (tokensAfterMicro <= compactThreshold) {
    return {
      messages: microcompacted,
      summary: null,
      wasCompacted: false,
      estimatedTokensBefore,
      estimatedTokensAfter: tokensAfterMicro,
    }
  }

  // --- LAYER 2: Full summarization ---
  const firstMessage = microcompacted[0]
  const recentMessages = microcompacted.slice(-keepRecent)
  const middleMessages = microcompacted.slice(1, microcompacted.length - keepRecent)

  if (middleMessages.length === 0) {
    return {
      messages: microcompacted,
      summary: null,
      wasCompacted: false,
      estimatedTokensBefore,
      estimatedTokensAfter: tokensAfterMicro,
    }
  }

  // Build middle text for summarization
  const middleText = middleMessages
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n\n')

  // Use chat-type-specific structured prompt
  const compactPrompt = COMPACT_PROMPTS[chatType]

  let summary: string
  try {
    const result = await streamChatWithUsage(
      [{ role: 'user', content: `Summarize the following conversation excerpt:\n\n${middleText}` }],
      compactPrompt,
      undefined,
      { model: HAIKU }
    )
    summary = result.fullText
    resetCompactFailures(chatType)
  } catch (err) {
    console.error(`[conversation] Compaction failed for ${chatType}:`, err)
    const circuitOpen = recordCompactFailure(chatType)
    if (circuitOpen) {
      console.warn(`[conversation] Circuit breaker tripped for ${chatType} after ${MAX_COMPACT_FAILURES} failures`)
    }
    // Fallback: truncate directly
    summary = middleText.slice(0, 500) + '...'
  }

  // If generateJSON returns an object instead of string (edge case), stringify it
  if (typeof summary !== 'string') {
    summary = String(summary)
  }

  // --- POST-COMPACT CLEANUP: Re-inject critical context ---
  const summaryWithContext = reinjectContext
    ? `${summary}\n\n---\nCurrent Context:\n${reinjectContext}`
    : summary

  // Build compacted message list
  const compactedMessages: ChatMessage[] = [
    firstMessage,
    // Inject summary as a system-like user message so the model has context
    { role: 'user', content: `[Previous conversation summary]\n${summaryWithContext}` },
    { role: 'assistant', content: 'I understand the context from our previous conversation. How can I help you continue?' },
    ...recentMessages,
  ]

  const estimatedTokensAfter = estimateMessagesTokens(compactedMessages)

  return {
    messages: compactedMessages,
    summary,
    wasCompacted: true,
    estimatedTokensBefore,
    estimatedTokensAfter,
  }
}
