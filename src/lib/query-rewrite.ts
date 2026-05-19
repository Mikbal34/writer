/**
 * Conversation-aware query rewriting.
 *
 * RAG retrieval pipelines blow up on follow-up questions because
 * the user's literal message is no longer a self-contained query.
 * "Peki ya bu fikrin eleştirileri?" has no anchor without the
 * "modernlik dini" turn three messages back; embedding it cold
 * produces neighbours about nothing in particular.
 *
 * The standard fix (used by LangChain, LlamaIndex, OpenAI Assistants
 * et al.) is to run a small LLM call before retrieval that takes the
 * recent conversation + the latest user turn and rewrites it into a
 * standalone question. The rewritten string drives retrieval; the
 * original message still flows to the answering LLM so the user sees
 * their own words echoed back, not the rephrased version.
 *
 * Cheap operation: Haiku, ~100 input + 50 output tokens, ~$0.0001
 * per call, ~300 ms latency. Skipped entirely when there's no
 * history to anchor against (first user turn in a session).
 */

import { generateJSONWithUsage, HAIKU } from "@/lib/claude";

const SYSTEM_PROMPT =
  "You rewrite a user's latest chat message into a standalone, " +
  "self-contained question that captures everything an outside reader " +
  "would need in order to search a knowledge base for the answer. " +
  "Resolve pronouns and demonstratives (this, that, it, bu, şu, o) " +
  "by inlining what they refer to from the prior conversation. " +
  "Preserve the user's primary language exactly (Turkish stays Turkish, " +
  "English stays English, Arabic stays Arabic). " +
  "If the message is already standalone, return it unchanged. " +
  "Do not add information the user did not imply. Do not answer the " +
  "question — only rewrite it. " +
  'Output ONLY JSON: { "query": "..." }';

const NUM_HISTORY_TURNS_TO_USE = 4;

export interface PriorMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Rewrite the latest user message into a standalone query, given
 * recent conversation. Returns the original message when:
 *   - there is no prior history (first turn — nothing to anchor)
 *   - the rewrite call fails (network blip, JSON parse, rate-limit)
 *
 * Either failure mode is silent on purpose: rewriting is a quality
 * boost, not a correctness gate, so the chat MUST keep working with
 * the original message when the rewrite path goes wrong.
 */
export async function rewriteQuery(
  currentMessage: string,
  priorMessages: PriorMessage[],
): Promise<string> {
  const recent = priorMessages.slice(-NUM_HISTORY_TURNS_TO_USE);
  if (recent.length === 0) return currentMessage;
  const transcript = recent
    .map(
      (m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 600)}`,
    )
    .join("\n");
  const prompt = `Recent conversation:
${transcript}

Latest user message:
"${currentMessage}"

Rewrite the latest message as a standalone question. Return JSON only.`;
  try {
    const result = await generateJSONWithUsage<{ query?: string }>(
      prompt,
      SYSTEM_PROMPT,
      { model: HAIKU },
    );
    const rewritten = result.data?.query?.trim();
    if (!rewritten || rewritten.length < 3) return currentMessage;
    return rewritten;
  } catch (err) {
    console.warn(
      "[query-rewrite] falling back to original message:",
      err instanceof Error ? err.message : err,
    );
    return currentMessage;
  }
}
