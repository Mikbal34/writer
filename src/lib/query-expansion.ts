/**
 * Multilingual query expansion for retrieval.
 *
 * A Turkish question about an English/Arabic source frequently
 * fails to surface the key passage because (a) the cross-lingual
 * embedding bridge weakens on specific concepts and (b) the user's
 * wording ("modernite ile geleneğin uzlaşması") differs from the
 * passage's wording ("double movement, from the present
 * situation"). Concept lives in the corpus, but neither vector nor
 * FTS ranks it into the top-K.
 *
 * Expansion fixes both: a small LLM call rewrites the query into a
 * few variants that (1) cross languages (TR↔EN↔AR) and (2) name
 * the likely domain terms / methods the answer would use. Each
 * variant runs its own hybrid retrieval; the union is RRF-merged
 * so a hit from ANY variant reaches the reranker. The original
 * query is always included, so expansion can only add recall,
 * never lose the baseline.
 *
 * Cost: 1 Haiku call (~$0.0002) + N-1 extra embeddings per chat
 * turn. Falls back to [original] on any failure — expansion is a
 * recall boost, not a correctness gate.
 */

import { generateJSONWithUsage, HAIKU } from "@/lib/claude";

const MAX_VARIANTS = 3; // including the original

const SYSTEM_PROMPT =
  "You expand a search query for a MULTILINGUAL academic library " +
  "(sources may be in any language and any field). Given the user's " +
  "question, produce 2 additional retrieval queries that help find " +
  "the relevant passage even when it's in another language or uses " +
  "different terminology than the question. Rules:\n" +
  "- Variant 1: translate the core of the question to ENGLISH and add " +
  "the specific scholarly term / method / proper name the answer most " +
  "likely uses (infer the field from the question itself; e.g. a " +
  "question about reconciling modernity with tradition in a thinker → " +
  "add that thinker's signature method/term).\n" +
  "- Variant 2: keep the question's original language but swap in the " +
  "most likely domain-specific terms / proper names the source would " +
  "use.\n" +
  "- Keep each variant short (a search query, not a sentence).\n" +
  "- Do NOT answer the question. Do NOT repeat the original verbatim.\n" +
  'Output ONLY JSON: { "variants": ["...", "..."] }';

/**
 * Expand a query into [original, ...variants]. Always returns at
 * least the original. Deduplicates and caps at MAX_VARIANTS.
 */
export async function expandQuery(query: string): Promise<string[]> {
  const original = query.trim();
  if (original.length < 6) return [original];
  try {
    const result = await generateJSONWithUsage<{ variants?: string[] }>(
      `User question: "${original}"\n\nReturn JSON with 2 expansion queries.`,
      SYSTEM_PROMPT,
      { model: HAIKU },
    );
    const variants = Array.isArray(result.data?.variants)
      ? result.data!.variants
      : [];
    const cleaned = variants
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter((v) => v.length >= 3 && v.toLowerCase() !== original.toLowerCase());
    // original first (baseline), then unique variants, capped.
    const out = [original];
    for (const v of cleaned) {
      if (out.length >= MAX_VARIANTS) break;
      if (!out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
    }
    return out;
  } catch (err) {
    console.warn(
      "[query-expansion] falling back to original query:",
      err instanceof Error ? err.message : err,
    );
    return [original];
  }
}
