import { type ChatMessage, generateJSON, HAIKU } from '@/lib/claude'

const SUMMARY_PROMPT_SYSTEM =
  'You are a concise summarizer. Summarize the key decisions and changes made in this book planning conversation. Focus on: what was decided about structure, which chapters/sections were added/removed/modified, and any important user preferences expressed. Be concise (max 200 words). Return plain text only, no JSON.'

/**
 * Compresses a conversation history using a sliding window + summary approach.
 *
 * If messages.length <= maxMessages, returns them as-is.
 * Otherwise: keeps the first message (user's book description) + last `keepRecent` messages,
 * and summarizes the middle portion using Haiku.
 */
export async function compressHistory(
  messages: ChatMessage[],
  maxMessages: number = 6
): Promise<{ messages: ChatMessage[]; summary: string | null }> {
  if (messages.length <= maxMessages) {
    return { messages, summary: null }
  }

  const keepRecent = 4
  const firstMessage = messages[0]
  const recentMessages = messages.slice(-keepRecent)
  const middleMessages = messages.slice(1, messages.length - keepRecent)

  if (middleMessages.length === 0) {
    return { messages, summary: null }
  }

  // Build a condensed version of middle messages for summarization
  const middleText = middleMessages
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n\n')

  let summary: string
  try {
    summary = await generateJSON<string>(
      `Summarize the following conversation excerpt:\n\n${middleText}`,
      SUMMARY_PROMPT_SYSTEM,
      { model: HAIKU }
    )
  } catch {
    // If summarization fails, just truncate the text directly
    summary = middleText.slice(0, 500) + '...'
  }

  // If generateJSON returns an object instead of string (edge case), stringify it
  if (typeof summary !== 'string') {
    summary = String(summary)
  }

  const compressedMessages: ChatMessage[] = [firstMessage, ...recentMessages]

  return { messages: compressedMessages, summary }
}
