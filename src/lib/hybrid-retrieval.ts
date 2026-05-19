/**
 * Hybrid retrieval: pgvector semantic + PostgreSQL full-text search,
 * fused with Reciprocal Rank Fusion (RRF).
 *
 * The pure-vector pipeline is good at matching paraphrases and
 * concepts but routinely misses queries that hinge on exact
 * tokens — proper names ("Mâtürîdî"), technical terms ("kelâm"),
 * dates ("1996"), citations ("Genesis 2:7"). Lexical retrieval
 * catches those by design. Combining the two with RRF is the
 * sector-standard answer: typically +20–30 % recall@k on academic
 * corpora versus either method alone, with no model changes.
 *
 * RRF formula (Cormack et al., 2009):
 *   score(d) = Σ over methods  1 / (k + rank_in_method(d))
 *
 * k=60 is the conventional default — large enough that the score
 * decays gracefully past the top results, small enough that the
 * top-3 still dominate the merge. We then pass the fused list to
 * the existing Haiku reranker, so RRF only has to assemble a good
 * recall pool, not a perfect ordering.
 *
 * Language note: the FTS index uses the `simple` text-search
 * configuration so it treats Turkish, Arabic, and English alike —
 * no stemming, no stop-word removal. That gives up some smarts
 * (English plurals don't collapse) but avoids the much worse
 * failure mode of a language-specific config silently dropping
 * tokens for the other languages in the corpus.
 */

import { prisma } from "@/lib/db";

const RRF_K = 60;

export interface RetrievedRow {
  id: string;
  kind: "chunk" | "note";
  entryId: string;
  volumeId: string | null;
  title: string;
  authorSurname: string;
  pageNumber: number | null;
  pdfPageLabel: string | null;
  sectionTitle: string | null;
  content: string;
  noteTitle: string | null;
}

// ── Chunk FTS ────────────────────────────────────────────────────

export async function ftsChunks(
  userId: string,
  query: string,
  entryIds: string[] | null,
  limit: number,
): Promise<RetrievedRow[]> {
  if (!query.trim()) return [];
  // websearch_to_tsquery is the user-friendly query parser —
  // accepts quoted phrases, OR, -negation, and falls back to AND
  // between bare words. Safe with arbitrary input (no SQL meta).
  if (!entryIds || entryIds.length === 0) {
    return prisma.$queryRaw<RetrievedRow[]>`
      SELECT lc.id AS id,
             'chunk' AS kind,
             le.id AS "entryId",
             lc."volumeId" AS "volumeId",
             le.title AS title,
             le."authorSurname" AS "authorSurname",
             lc."pageNumber" AS "pageNumber",
             lc."pdfPageLabel" AS "pdfPageLabel",
             lc."sectionTitle" AS "sectionTitle",
             lc.content AS content,
             NULL AS "noteTitle"
      FROM "LibraryChunk" lc
      JOIN "LibraryEntry" le ON lc."libraryEntryId" = le.id
      WHERE le."userId" = ${userId}
        AND lc."contentTsv" @@ websearch_to_tsquery('simple', ${query})
      ORDER BY ts_rank_cd(lc."contentTsv", websearch_to_tsquery('simple', ${query})) DESC
      LIMIT ${limit}
    `;
  }
  return prisma.$queryRaw<RetrievedRow[]>`
    SELECT lc.id AS id,
           'chunk' AS kind,
           le.id AS "entryId",
           lc."volumeId" AS "volumeId",
           le.title AS title,
           le."authorSurname" AS "authorSurname",
           lc."pageNumber" AS "pageNumber",
           lc."pdfPageLabel" AS "pdfPageLabel",
           lc."sectionTitle" AS "sectionTitle",
           lc.content AS content,
           NULL AS "noteTitle"
    FROM "LibraryChunk" lc
    JOIN "LibraryEntry" le ON lc."libraryEntryId" = le.id
    WHERE le."userId" = ${userId}
      AND le.id = ANY(${entryIds}::text[])
      AND lc."contentTsv" @@ websearch_to_tsquery('simple', ${query})
    ORDER BY ts_rank_cd(lc."contentTsv", websearch_to_tsquery('simple', ${query})) DESC
    LIMIT ${limit}
  `;
}

// ── Note FTS ─────────────────────────────────────────────────────

export async function ftsNotes(
  userId: string,
  query: string,
  entryIds: string[] | null,
  limit: number,
): Promise<RetrievedRow[]> {
  if (!query.trim()) return [];
  if (!entryIds || entryIds.length === 0) {
    return prisma.$queryRaw<RetrievedRow[]>`
      SELECT ln.id AS id,
             'note' AS kind,
             le.id AS "entryId",
             ln."volumeId" AS "volumeId",
             le.title AS title,
             le."authorSurname" AS "authorSurname",
             ln."pageNumber" AS "pageNumber",
             ln."pdfPageLabel" AS "pdfPageLabel",
             NULL AS "sectionTitle",
             ln."contentText" AS content,
             ln.title AS "noteTitle"
      FROM "LibraryNote" ln
      JOIN "LibraryEntry" le ON ln."libraryEntryId" = le.id
      WHERE ln."userId" = ${userId}
        AND ln."contentTsv" @@ websearch_to_tsquery('simple', ${query})
      ORDER BY ts_rank_cd(ln."contentTsv", websearch_to_tsquery('simple', ${query})) DESC
      LIMIT ${limit}
    `;
  }
  return prisma.$queryRaw<RetrievedRow[]>`
    SELECT ln.id AS id,
           'note' AS kind,
           le.id AS "entryId",
           ln."volumeId" AS "volumeId",
           le.title AS title,
           le."authorSurname" AS "authorSurname",
           ln."pageNumber" AS "pageNumber",
           ln."pdfPageLabel" AS "pdfPageLabel",
           NULL AS "sectionTitle",
           ln."contentText" AS content,
           ln.title AS "noteTitle"
    FROM "LibraryNote" ln
    JOIN "LibraryEntry" le ON ln."libraryEntryId" = le.id
    WHERE ln."userId" = ${userId}
      AND le.id = ANY(${entryIds}::text[])
      AND ln."contentTsv" @@ websearch_to_tsquery('simple', ${query})
    ORDER BY ts_rank_cd(ln."contentTsv", websearch_to_tsquery('simple', ${query})) DESC
    LIMIT ${limit}
  `;
}

// ── RRF fusion ───────────────────────────────────────────────────

/**
 * Merge two ranked lists with Reciprocal Rank Fusion. Items
 * present in both lists get their scores summed, so the union
 * favours candidates either method found near the top. Tie-break
 * is the natural sort order returned by `sort()`.
 *
 * The first list wins on row-object identity when both methods
 * return the same id — irrelevant since the data is identical,
 * but makes the result deterministic.
 */
export function rrfMerge<T extends { id: string }>(
  primary: T[],
  secondary: T[],
  k = RRF_K,
): T[] {
  const score = new Map<string, number>();
  const row = new Map<string, T>();
  primary.forEach((r, i) => {
    score.set(r.id, (score.get(r.id) ?? 0) + 1 / (k + i + 1));
    row.set(r.id, r);
  });
  secondary.forEach((r, i) => {
    score.set(r.id, (score.get(r.id) ?? 0) + 1 / (k + i + 1));
    if (!row.has(r.id)) row.set(r.id, r);
  });
  return Array.from(score.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([id]) => row.get(id))
    .filter((r): r is T => r !== undefined);
}
