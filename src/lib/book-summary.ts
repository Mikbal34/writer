/**
 * Book-level summary generation + query routing.
 *
 * Generic chat questions ("bu kitap ne anlatıyor", "ana fikir
 * nedir", "summarize this") are a bad fit for vector RAG: short
 * queries match too many chunks weakly, the colophon page often
 * wins on title overlap, and the LLM ends up "answering" from
 * front-matter junk. The classic fix is a precomputed book
 * summary that the system serves directly for these queries,
 * letting RAG focus on the specific factual / passage-level
 * questions it's good at.
 *
 * This module covers both halves:
 *   - generateBookSummary: one-shot per book at extraction time.
 *   - isGenericBookQuery: query router heuristic the chat handler
 *     uses to decide between "summary path" and "RAG path".
 */

import { generateJSONWithUsage, HAIKU } from "@/lib/claude";

interface SummaryInput {
  title: string;
  authorSurname?: string | null;
  authorName?: string | null;
  /** Sample chunks (even-spaced across the book) used as evidence
   *  for the summary. Caller pulls these from LibraryChunk after
   *  embedding completes. */
  sampleChunks: Array<{ content: string; pageNumber?: number | null }>;
}

const SUMMARY_SYSTEM_PROMPT =
  "You write a tight 250-400 word academic book summary based on the " +
  "passages provided. Cover: (1) the book's main argument or central " +
  "thesis, (2) its method/approach, (3) the principal concepts or case " +
  "studies it leans on, (4) the audience or scholarly context. Write in " +
  "the same primary language as the passages (Turkish passages → Turkish " +
  "summary, English → English). No hedging, no commentary about what's " +
  "missing. Output JSON only: { \"summary\": \"...\" }.";

export async function generateBookSummary(
  input: SummaryInput,
): Promise<string | null> {
  if (input.sampleChunks.length === 0) return null;

  // Even-spaced sample of up to 12 chunks, prefer the middle 80%
  // (skip front matter that survived junk-filter, e.g. preface
  // pages, and the back matter where ack/glossary lives).
  const total = input.sampleChunks.length;
  const startBand = Math.floor(total * 0.1);
  const endBand = Math.floor(total * 0.9);
  const usable = input.sampleChunks.slice(
    startBand,
    endBand > startBand ? endBand : total,
  );
  const pool = usable.length >= 8 ? usable : input.sampleChunks;
  const sampleCount = Math.min(12, pool.length);
  const step = Math.max(1, Math.floor(pool.length / sampleCount));
  const samples = Array.from({ length: sampleCount }, (_, i) =>
    pool[Math.min(i * step, pool.length - 1)],
  );

  const author = [input.authorName, input.authorSurname]
    .filter(Boolean)
    .join(" ")
    .trim();
  const passageBlock = samples
    .map(
      (c, i) =>
        `Passage ${i + 1}${c.pageNumber ? ` (p. ${c.pageNumber})` : ""}:\n"${
          c.content.length > 600 ? c.content.slice(0, 600) + "…" : c.content
        }"`,
    )
    .join("\n\n");

  const prompt = `Book: ${input.title}${author ? `\nAuthor: ${author}` : ""}\n\nSampled passages:\n\n${passageBlock}\n\nWrite the summary now.`;

  try {
    const result = await generateJSONWithUsage<{ summary?: string }>(
      prompt,
      SUMMARY_SYSTEM_PROMPT,
      { model: HAIKU },
    );
    const s = typeof result.data?.summary === "string"
      ? result.data.summary.trim()
      : null;
    return s && s.length >= 100 ? s : null;
  } catch (err) {
    console.warn(
      "[book-summary] Haiku failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

// ── Query router ──────────────────────────────────────────────────
// Whether a chat question is a "summary-style" question that the
// stored book summary should answer directly. Conservative: only
// routes when the query reads as a metadata-level ask. Anything
// specific (proper nouns, multi-clause, comparative) goes through
// RAG as usual.

const SUMMARY_TRIGGERS = [
  // Turkish
  /^\s*bu kitap (?:ne (?:anlat[ıi]yor|hakk[ıi]nda)|hakk[ıi]nda|ne der)\??\s*$/i,
  /\bana (?:fikir|tez|argüman|iddia|konu)(?:lar[ıi])?\b.{0,40}\??\s*$/i,
  /(?:kitab[ıi]n|eserin) (?:konusu|i[çc]eri[ğg]i|özeti|temas[ıi])\b.{0,40}\??\s*$/i,
  /\b(?:k[ıi]saca |özetle |bir c[üu]mleyle )(?:bahset|anlat|özetle)/i,
  /^[a-zçşğüöı]+ (?:ne demek istiyor|hangi konuyu işliyor)\??\s*$/i,
  // English
  /^\s*what (?:is|does) this book (?:about|say|argue)\??\s*$/i,
  /\b(?:main|central|key) (?:argument|thesis|claim|idea|point)\b.{0,40}\??\s*$/i,
  /^\s*(?:summarize|summarise|tldr|tl;?dr)\b.{0,80}\??\s*$/i,
];

export function isGenericBookQuery(query: string): boolean {
  const trimmed = query.trim();
  // Short queries (<10 words) are more likely generic; long
  // queries usually pin down a specific fact even if they include
  // "ana fikir" as a phrase.
  if (trimmed.split(/\s+/).length > 14) return false;
  return SUMMARY_TRIGGERS.some((re) => re.test(trimmed));
}
