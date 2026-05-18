/**
 * LLM-based reranker — second stage on top of vector retrieval.
 *
 * Vector search is recall-oriented: pgvector returns the N
 * chunks closest in embedding space, but cosine similarity often
 * over-weights surface-level lexical overlap and under-weights
 * actual relevance to the user's intent. Anthropic's "Contextual
 * Retrieval" (2024) and several reranker studies show that running
 * the top-N through an LLM "which of these answers the question
 * best?" pass before feeding them to the generator lifts precision
 * @ top-K from ~%35 to ~%70-80.
 *
 * This module is the rerank stage. The flow becomes:
 *
 *   query  ─▶  embed  ─▶  pgvector top-N (N=30)
 *                              │
 *                              ▼
 *                          rerankChunks()  ─▶  Haiku ranks
 *                              │                them 0-10
 *                              ▼
 *                          top K (K=8) selection
 *                              │
 *                              ▼
 *                       LLM (Sonnet) for answer
 *
 * We use Haiku (cheap, fast) for ranking and Sonnet for the final
 * answer. Reranker prompt asks for a JSON array of {index,score}
 * objects so we can sort + slice cleanly; numeric scores also let
 * downstream code reason about confidence (e.g. "drop all chunks
 * below 5/10" for a strict mode).
 */

import { generateJSONWithUsage, HAIKU } from "@/lib/claude";

const RERANK_SYSTEM_PROMPT =
  "You are a relevance ranker for an academic library search. " +
  "Given the user's question and a numbered list of candidate passages, " +
  "score each passage 0-10 based on how directly it answers the question. " +
  "10 = directly answers; 7-9 = highly relevant context; 4-6 = tangential; " +
  "1-3 = same topic but doesn't help; 0 = unrelated / boilerplate / TOC. " +
  "Return JSON: { \"rankings\": [{ \"index\": <0-based>, \"score\": <0-10> }, ...] }. " +
  "Score every input passage exactly once. No commentary, no markdown.";

export interface RerankableChunk {
  /** Stable identifier so the caller can re-associate after rerank. */
  id: string;
  /** Compact representation shown to the ranker: title + section +
   *  first ~280 chars of content is enough for Haiku to judge. */
  content: string;
  title?: string | null;
  sectionTitle?: string | null;
  pageLabel?: string | null;
}

export interface RerankResult {
  id: string;
  score: number;
}

/**
 * Rank `candidates` by how well each answers `query`. Returns the
 * full list sorted descending by score so the caller can slice
 * top-K (or threshold-filter). On Haiku failure, returns the
 * candidates in their original order with score=null collapsed to
 * 5 — the pipeline degrades gracefully to "vector order" rather
 * than crashing.
 */
export async function rerankChunks(
  query: string,
  candidates: RerankableChunk[],
): Promise<RerankResult[]> {
  if (candidates.length === 0) return [];
  if (candidates.length === 1) return [{ id: candidates[0].id, score: 10 }];

  // Build the numbered passage block. Each passage is trimmed so
  // we stay well inside Haiku's context window even with 30+
  // candidates (typical academic chunk ~800 chars).
  const passageBlock = candidates
    .map((c, i) => {
      const head = c.title
        ? `[${i}] "${c.title}"` +
          (c.sectionTitle ? ` — ${c.sectionTitle}` : "") +
          (c.pageLabel ? ` (s. ${c.pageLabel})` : "") +
          ":"
        : `[${i}]`;
      const body = c.content.length > 280
        ? c.content.slice(0, 280) + "…"
        : c.content;
      return `${head}\n${body}`;
    })
    .join("\n\n");

  const prompt = `Question: ${query}\n\nCandidate passages:\n${passageBlock}\n\nReturn JSON { "rankings": [...] }.`;

  try {
    const result = await generateJSONWithUsage<{
      rankings?: Array<{ index?: number; score?: number }>;
    }>(prompt, RERANK_SYSTEM_PROMPT, { model: HAIKU });
    const rankings = Array.isArray(result.data?.rankings)
      ? result.data!.rankings
      : [];
    // Score every candidate, defaulting to 0 if the ranker forgot
    // it. This keeps the output the same length as the input and
    // makes top-K slicing predictable.
    const scoreByIndex = new Map<number, number>();
    for (const r of rankings) {
      if (
        typeof r?.index === "number" &&
        typeof r?.score === "number" &&
        r.index >= 0 &&
        r.index < candidates.length
      ) {
        scoreByIndex.set(r.index, Math.max(0, Math.min(10, r.score)));
      }
    }
    const scored: RerankResult[] = candidates.map((c, i) => ({
      id: c.id,
      score: scoreByIndex.get(i) ?? 0,
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored;
  } catch (err) {
    console.warn(
      "[rerank] Haiku ranker failed, falling back to vector order:",
      err instanceof Error ? err.message : err,
    );
    // Degrade gracefully — return candidates in their original
    // (vector) order with a neutral score so caller can still
    // slice top-K without crashing.
    return candidates.map((c) => ({ id: c.id, score: 5 }));
  }
}
