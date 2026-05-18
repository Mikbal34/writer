/**
 * Contextual chunks — Anthropic's "Contextual Retrieval" pattern.
 *
 * For each chunk, we ask Haiku to generate a 1-2 sentence context
 * that says where the chunk sits in the book (chapter, topic). This
 * context is then PREPENDED to the chunk text before embedding, so
 * the vector incorporates the chunk's identity rather than treating
 * raw prose in isolation. Result (per the 2024 paper): ~35% lift in
 * retrieval precision @ top-K, with no change to chunking or
 * embedding-model architecture.
 *
 * `content` in the DB stays the raw passage so display, AI-quote
 * highlighting, and any verbatim-citation paths are untouched. The
 * generated prefix is stored separately in `pdfPageLabel`-sibling
 * column `contextualPrefix`, and `prefix + "\n\n" + content` is
 * what we feed the /embed endpoint with.
 *
 * Cost: Haiku ~$0.0001 per chunk. 60K-chunk backfill ≈ $6.
 * Throughput: Anthropic's API tolerates ~10 parallel requests per
 * key without rate-limit grief, so we batch.
 */

import { generateJSONWithUsage, HAIKU } from "@/lib/claude";

// Parallel cap: keep well below Anthropic's per-key rate limit
// floor. Earlier 8-parallel test on a 700-chunk book left ~half
// without a context because Haiku 429'd on later waves. Three at
// a time is the sweet spot we've seen for sustained throughput.
const CONTEXT_BATCH_PARALLEL = 3;
const CONTEXT_RETRY_ATTEMPTS = 2;
const CONTEXT_RETRY_BASE_MS = 600;

const SYSTEM_PROMPT =
  "You are summarizing where a passage sits within a book. " +
  "Given the book's title, author, the section heading the passage falls under, " +
  "and the passage text itself, output a 1-2 sentence context (max 30 words) that " +
  "(a) names the book + author succinctly, (b) describes what the passage discusses. " +
  "Write in the same primary language as the passage (Turkish passages → Turkish " +
  "context, English passages → English context). " +
  'Output ONLY JSON: { "context": "..." }. No commentary, no markdown.';

export interface ContextualizableChunk {
  id: string;
  content: string;
  pageNumber?: number | null;
  pageLabel?: string | null;
  sectionTitle?: string | null;
}

export interface BookInfo {
  title: string;
  authorSurname?: string | null;
  authorName?: string | null;
  /** Year may arrive as either a number (legacy) or a string
   *  ("1996" / "2017") depending on which schema column we read. */
  year?: number | string | null;
}

interface OneResult {
  id: string;
  context: string | null;
}

async function contextualizeOne(
  book: BookInfo,
  chunk: ContextualizableChunk,
): Promise<OneResult> {
  const author = chunk
    ? [book.authorName, book.authorSurname].filter(Boolean).join(" ").trim() ||
      "unknown author"
    : "unknown author";
  const sectionLine = chunk.sectionTitle
    ? `Section heading: ${chunk.sectionTitle}\n`
    : "";
  const pageLine = chunk.pageLabel
    ? `Printed page: ${chunk.pageLabel}\n`
    : chunk.pageNumber
      ? `PDF page: ${chunk.pageNumber}\n`
      : "";
  // Trim the body — Haiku doesn't need the whole chunk to write a
  // 30-word context, and shorter input is cheaper + faster.
  const body = chunk.content.length > 1200
    ? chunk.content.slice(0, 1200) + " …"
    : chunk.content;
  const prompt = `Book: ${book.title}
Author: ${author}${book.year ? ` (${book.year})` : ""}
${sectionLine}${pageLine}
Passage:
"""
${body}
"""

Return JSON { "context": "..." } only.`;
  // Retry on transient failures (rate-limit, network blip). Haiku
  // throws "Overloaded" / "rate_limit_error" intermittently when
  // we push more than a couple parallel requests; a short backoff
  // recovers the chunk so we don't leave half the corpus without
  // contextual prefixes.
  let lastErr: unknown;
  for (let attempt = 0; attempt <= CONTEXT_RETRY_ATTEMPTS; attempt++) {
    try {
      const result = await generateJSONWithUsage<{ context?: string }>(
        prompt,
        SYSTEM_PROMPT,
        { model: HAIKU },
      );
      const ctx =
        typeof result.data?.context === "string"
          ? result.data.context.trim()
          : null;
      return { id: chunk.id, context: ctx && ctx.length > 0 ? ctx : null };
    } catch (err) {
      lastErr = err;
      if (attempt < CONTEXT_RETRY_ATTEMPTS) {
        // Exponential backoff with a small jitter to spread the
        // recovery wave across the parallel batch — pure exponential
        // would have all 3 chunks retry at the same instant.
        const wait =
          CONTEXT_RETRY_BASE_MS * Math.pow(2, attempt) +
          Math.floor(Math.random() * 300);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  console.warn(
    "[contextual-chunks] Haiku failed for chunk",
    chunk.id,
    lastErr instanceof Error ? lastErr.message : lastErr,
  );
  return { id: chunk.id, context: null };
}

/**
 * Generate contextual prefixes for every chunk in `chunks`, run
 * up to CONTEXT_BATCH_PARALLEL requests at a time. Returns a map
 * from chunkId → prefix (null when generation failed; caller can
 * fall back to embedding bare content for those).
 */
export async function contextualizeChunks(
  book: BookInfo,
  chunks: ContextualizableChunk[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (chunks.length === 0) return out;

  // Process in fixed-size waves so we never have more than
  // CONTEXT_BATCH_PARALLEL outstanding Haiku requests at once.
  for (let i = 0; i < chunks.length; i += CONTEXT_BATCH_PARALLEL) {
    const batch = chunks.slice(i, i + CONTEXT_BATCH_PARALLEL);
    const results = await Promise.all(
      batch.map((c) => contextualizeOne(book, c)),
    );
    for (const r of results) out.set(r.id, r.context);
  }
  return out;
}

/**
 * Helper for the embedding stage: when we have a contextualPrefix,
 * prepend it before embedding so the vector incorporates the
 * chunk's identity. Plain content otherwise.
 */
export function buildEmbeddingText(
  content: string,
  contextualPrefix: string | null | undefined,
): string {
  if (!contextualPrefix) return content;
  return `${contextualPrefix.trim()}\n\n${content}`;
}

// ── Batched variant ──────────────────────────────────────────────
// Send multiple chunks to Haiku in a single request so 700-chunk
// books don't fire 700 separate API calls. The first contextualize
// implementation did exactly that and got rate-limited mid-backfill,
// landing only ~10-15% of expected prefixes. Sending 10 chunks per
// prompt cuts request count by 10× and keeps the rate-limit budget
// comfortable for unattended runs.

const BATCH_SIZE = 10;
const BATCH_RETRY_ATTEMPTS = 3;
const BATCH_RETRY_BASE_MS = 2_000;

const BATCH_SYSTEM_PROMPT =
  "You are summarizing where each of several passages from a book " +
  "sits within it. For each numbered passage, output a 1-2 sentence " +
  "context (max 30 words) that (a) names the book + author succinctly, " +
  "(b) describes what the passage discusses. Write in the same primary " +
  "language as each passage individually (a Turkish passage gets a " +
  "Turkish context, an English passage gets an English context). " +
  'Output ONLY JSON: { "contexts": [{ "index": 0, "context": "..." }, ' +
  '{ "index": 1, "context": "..." }, ...] }. Include every index. ' +
  "No commentary, no markdown.";

async function contextualizeBatch(
  book: BookInfo,
  batch: ContextualizableChunk[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (batch.length === 0) return out;
  const author =
    [book.authorName, book.authorSurname].filter(Boolean).join(" ").trim() ||
    "unknown author";
  const blocks = batch.map((c, i) => {
    const head = c.sectionTitle ? `Section: ${c.sectionTitle}` : "";
    const page = c.pageLabel
      ? `Page label: ${c.pageLabel}`
      : c.pageNumber
        ? `PDF page: ${c.pageNumber}`
        : "";
    const body = c.content.length > 900
      ? c.content.slice(0, 900) + " …"
      : c.content;
    return `[${i}]\n${[head, page].filter(Boolean).join("\n")}\nPassage:\n"""${body}"""`;
  });
  const prompt = `Book: ${book.title}\nAuthor: ${author}${book.year ? ` (${book.year})` : ""}\n\nPassages:\n\n${blocks.join("\n\n")}\n\nReturn JSON { "contexts": [...] }.`;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= BATCH_RETRY_ATTEMPTS; attempt++) {
    try {
      const result = await generateJSONWithUsage<{
        contexts?: Array<{ index?: number; context?: string }>;
      }>(prompt, BATCH_SYSTEM_PROMPT, { model: HAIKU });
      const contexts = Array.isArray(result.data?.contexts)
        ? result.data!.contexts
        : [];
      const ctxByIndex = new Map<number, string>();
      for (const c of contexts) {
        if (
          typeof c?.index === "number" &&
          typeof c?.context === "string" &&
          c.index >= 0 &&
          c.index < batch.length
        ) {
          const cleaned = c.context.trim();
          if (cleaned.length > 0) ctxByIndex.set(c.index, cleaned);
        }
      }
      // Map back to chunk ids — missing indices stay null and the
      // caller can decide whether to retry them one-by-one later.
      for (let i = 0; i < batch.length; i++) {
        out.set(batch[i].id, ctxByIndex.get(i) ?? null);
      }
      return out;
    } catch (err) {
      lastErr = err;
      if (attempt < BATCH_RETRY_ATTEMPTS) {
        // Exponential backoff with jitter. The previous (3-parallel,
        // 600ms) policy was too tight for 75K-call backfills.
        const wait =
          BATCH_RETRY_BASE_MS * Math.pow(2, attempt) +
          Math.floor(Math.random() * 1_000);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  console.warn(
    "[contextual-chunks] batch Haiku failed",
    lastErr instanceof Error ? lastErr.message : lastErr,
  );
  for (const c of batch) out.set(c.id, null);
  return out;
}

/**
 * Batched alternative to contextualizeChunks() — send BATCH_SIZE
 * chunks per Haiku request so a book with N chunks costs N/10 API
 * calls instead of N. Caller-side parallelism cap (`parallelBatches`)
 * lets you tune burst vs throttle: 1 for unattended backfill
 * (slowest, safest), 3 for live ingestion (fast, may still 429).
 *
 * Drop-in replacement: same return shape as contextualizeChunks
 * (Map<chunkId, string | null>) so the caller doesn't have to
 * branch on which variant produced the prefixes.
 */
export async function contextualizeChunksBatched(
  book: BookInfo,
  chunks: ContextualizableChunk[],
  options: { parallelBatches?: number; batchSize?: number } = {},
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (chunks.length === 0) return out;
  const batchSize = options.batchSize ?? BATCH_SIZE;
  const parallelBatches = Math.max(1, options.parallelBatches ?? 1);

  // Chunks → batches.
  const batches: ContextualizableChunk[][] = [];
  for (let i = 0; i < chunks.length; i += batchSize) {
    batches.push(chunks.slice(i, i + batchSize));
  }

  // Send `parallelBatches` batches at a time. Default 1 = strict
  // serial so backfills don't burst the Haiku rate ceiling.
  for (let i = 0; i < batches.length; i += parallelBatches) {
    const wave = batches.slice(i, i + parallelBatches);
    const results = await Promise.all(
      wave.map((b) => contextualizeBatch(book, b)),
    );
    for (const m of results) {
      for (const [id, ctx] of m) out.set(id, ctx);
    }
  }
  return out;
}
