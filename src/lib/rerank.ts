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
import { generateMiniJSON } from "@/lib/mini-llm";

const RERANK_PROVIDER = (process.env.RERANK_PROVIDER ?? "haiku").toLowerCase();
const VOYAGE_RERANK_MODEL = process.env.VOYAGE_RERANK_MODEL ?? "rerank-2";
const VOYAGE_RERANK_URL = "https://api.voyageai.com/v1/rerank";
const COHERE_RERANK_MODEL = process.env.COHERE_RERANK_MODEL ?? "rerank-multilingual-v3.0";
const COHERE_RERANK_URL = "https://api.cohere.com/v2/rerank";

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

  if (RERANK_PROVIDER === "none") {
    // Rerank atla — hibrit retrieve (RRF) sıralamasına güven, identity skor ver.
    // Üst-K seçimi caller'da yapılır (slice(0, K)). 0$ maliyet.
    return candidates.map((c) => ({ id: c.id, score: 5 }));
  }
  if (RERANK_PROVIDER === "voyage") {
    return rerankVoyage(query, candidates);
  }
  if (RERANK_PROVIDER === "cohere") {
    return rerankCohere(query, candidates);
  }
  if (RERANK_PROVIDER === "gemini-flash-lite" || RERANK_PROVIDER === "gemini") {
    return rerankWithMiniLLM(query, candidates, "gemini-flash-lite");
  }
  return rerankHaiku(query, candidates);
}

/**
 * Cohere Rerank-3 (multilingual-v3) — endüstri standart cross-encoder reranker.
 * Perplexity, Glean, vs. kullanıyor. 100+ dil destek. ~$2/1000 query.
 */
async function rerankCohere(
  query: string,
  candidates: RerankableChunk[],
): Promise<RerankResult[]> {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) {
    console.warn("[rerank] COHERE_API_KEY yok, Haiku'ya düşüyorum");
    return rerankHaiku(query, candidates);
  }
  const documents = candidates.map((c) => {
    const head =
      [c.title, c.sectionTitle, c.pageLabel ? `s. ${c.pageLabel}` : null]
        .filter(Boolean)
        .join(" — ") || "";
    const body = c.content.length > 1200 ? c.content.slice(0, 1200) : c.content;
    return head ? `${head}\n${body}` : body;
  });
  try {
    const res = await fetch(COHERE_RERANK_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: COHERE_RERANK_MODEL,
        query,
        documents,
        top_n: candidates.length,
      }),
    });
    if (!res.ok) {
      const txt = (await res.text()).slice(0, 200);
      console.warn(`[rerank] Cohere HTTP ${res.status}: ${txt}`);
      return rerankHaiku(query, candidates);
    }
    const data = (await res.json()) as {
      results?: Array<{ index?: number; relevance_score?: number }>;
    };
    const items = Array.isArray(data.results) ? data.results : [];
    const scoreByIndex = new Map<number, number>();
    for (const r of items) {
      if (
        typeof r?.index === "number" &&
        typeof r?.relevance_score === "number" &&
        r.index >= 0 &&
        r.index < candidates.length
      ) {
        // Cohere döner 0-1, biz 0-10 ölçeği kullanıyoruz.
        scoreByIndex.set(r.index, Math.max(0, Math.min(10, r.relevance_score * 10)));
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
      "[rerank] Cohere failed, falling back to Haiku:",
      err instanceof Error ? err.message : err,
    );
    return rerankHaiku(query, candidates);
  }
}

/**
 * LLM rerank ama Haiku yerine ucuz mini-llm provider. Aynı yaklaşım (LLM'ye
 * "sırala 0-10" der) ama 8× daha ucuz (Gemini Flash-Lite). Haiku rerank ile
 * eşit kaliteli olmasını bekliyoruz (LLM kalitesi vs cross-encoder); A/B
 * eval ile doğrulanır.
 */
async function rerankWithMiniLLM(
  query: string,
  candidates: RerankableChunk[],
  provider: "gemini-flash-lite" | "gemini-flash",
): Promise<RerankResult[]> {
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
    const result = await generateMiniJSON<{
      rankings?: Array<{ index?: number; score?: number }>;
    }>(prompt, RERANK_SYSTEM_PROMPT, { provider, maxTokens: 2048 });
    const rankings = Array.isArray(result.data?.rankings) ? result.data!.rankings : [];
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
      `[rerank] ${provider} failed, falling back to Haiku:`,
      err instanceof Error ? err.message : err,
    );
    return rerankHaiku(query, candidates);
  }
}

async function rerankVoyage(
  query: string,
  candidates: RerankableChunk[],
): Promise<RerankResult[]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    console.warn("[rerank] VOYAGE_API_KEY yok, Haiku'ya düşüyorum");
    return rerankHaiku(query, candidates);
  }
  const documents = candidates.map((c) => {
    const head =
      [c.title, c.sectionTitle, c.pageLabel ? `s. ${c.pageLabel}` : null]
        .filter(Boolean)
        .join(" — ") || "";
    const body = c.content.length > 1200 ? c.content.slice(0, 1200) : c.content;
    return head ? `${head}\n${body}` : body;
  });
  try {
    const res = await fetch(VOYAGE_RERANK_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        documents,
        model: VOYAGE_RERANK_MODEL,
        return_documents: false,
      }),
    });
    if (!res.ok) {
      const txt = (await res.text()).slice(0, 200);
      console.warn(`[rerank] Voyage HTTP ${res.status}: ${txt}`);
      return rerankHaiku(query, candidates);
    }
    const data = (await res.json()) as {
      data?: Array<{ index?: number; relevance_score?: number }>;
    };
    const items = Array.isArray(data.data) ? data.data : [];
    const scoreByIndex = new Map<number, number>();
    for (const r of items) {
      if (
        typeof r?.index === "number" &&
        typeof r?.relevance_score === "number" &&
        r.index >= 0 &&
        r.index < candidates.length
      ) {
        // Voyage döner 0-1, Haiku interface 0-10 — uyumlu olsun diye 10× yap.
        scoreByIndex.set(r.index, Math.max(0, Math.min(10, r.relevance_score * 10)));
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
      "[rerank] Voyage failed, falling back to Haiku:",
      err instanceof Error ? err.message : err,
    );
    return rerankHaiku(query, candidates);
  }
}

async function rerankHaiku(
  query: string,
  candidates: RerankableChunk[],
): Promise<RerankResult[]> {
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
