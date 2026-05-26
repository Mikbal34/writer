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

const MAX_VARIANTS_FALLBACK = 3; // includes the original; legacy path
const MAX_VARIANTS_MULTILINGUAL = 6; // original + up to 4 lang + 1 domain

const LEGACY_SYSTEM_PROMPT =
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

const LANG_NAMES: Record<string, string> = {
  en: "English",
  tr: "Turkish",
  ar: "Arabic",
  fr: "French",
  de: "German",
  es: "Spanish",
  it: "Italian",
  ru: "Russian",
  fa: "Persian",
  ur: "Urdu",
  zh: "Chinese",
  ja: "Japanese",
};

function buildMultilingualPrompt(libraryLangs: string[]): string {
  const named = libraryLangs
    .map((l) => LANG_NAMES[l] ?? l.toUpperCase())
    .filter(Boolean);
  const langList = named.length ? named.join(", ") : "English";
  return (
    "You expand a search query for a MULTILINGUAL academic library. " +
    `The library contains sources primarily in these languages: ${langList}. ` +
    "Produce one retrieval-friendly query variant PER library language " +
    "(except if the user's question is already in that language — then SKIP it). " +
    "Each variant should be a short search query (NOT a sentence) using " +
    "scholarly terms / proper names that the source would actually use in that " +
    "language. Preserve Latinized proper nouns (Wolfson, Leucippus) verbatim — " +
    "they often appear in the source as-is.\n\n" +
    "Additionally, produce ONE variant that swaps in domain-specific terminology " +
    "the source would use, in any appropriate language.\n\n" +
    "Rules:\n" +
    "- Do NOT answer the question.\n" +
    "- Do NOT repeat the user's original question verbatim.\n" +
    "- Keep each variant ≤ 15 words.\n" +
    '- Output ONLY JSON: { "variants": ["...", "..."] }'
  );
}

/**
 * Expand a query into [original, ...variants]. Always returns at
 * least the original. Deduplicates.
 *
 * Mode:
 *  - libraryLangs verilirse: kütüphanedeki HER dile bir variant + 1 domain term
 *    variant. Multilingual kütüphaneler (Quilpen) için optimize. Voyage'ın
 *    cross-lingual'i tek başına bridge yapıyor ama her dile özel
 *    Latinleştirilmiş sorgu vektörü retrieve recall'ı belirgin artırır.
 *  - libraryLangs verilmezse: eski 2-variant davranış (EN translation + domain).
 */
export async function expandQuery(
  query: string,
  libraryLangs?: string[],
): Promise<string[]> {
  const original = query.trim();
  if (original.length < 6) return [original];

  const multilingual = libraryLangs && libraryLangs.length > 0;
  const systemPrompt = multilingual
    ? buildMultilingualPrompt(libraryLangs)
    : LEGACY_SYSTEM_PROMPT;
  const maxVariants = multilingual ? MAX_VARIANTS_MULTILINGUAL : MAX_VARIANTS_FALLBACK;
  const expectedCount = multilingual
    ? `${libraryLangs.length + 1} expansion queries (one per library language + 1 domain-term variant)`
    : "2 expansion queries";

  try {
    const result = await generateJSONWithUsage<{ variants?: string[] }>(
      `User question: "${original}"\n\nReturn JSON with ${expectedCount}.`,
      systemPrompt,
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
      if (out.length >= maxVariants) break;
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
