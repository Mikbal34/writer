/**
 * Kütüphane retrieval ortak helper — chat ve yazı endpoint'leri paylaşır.
 *
 * Mevcut chat route'undaki sophisticated pipeline:
 *   1. Query expansion (multilingual variants)
 *   2. Comparative split (X vs Y)
 *   3. HyDE (opsiyonel)
 *   4. Voyage embed her variant
 *   5. Hibrit retrieve (pgvector + Postgres FTS, RRF merge)
 *   6. MMR diversity cap (her kitaptan max N chunk)
 *   7. Top-K slice
 *
 * Yazı endpoint'i bu helper'ı kullansın → library chunks chat seviyesinde.
 * SourceChunk (proje-içi PDF) ayrı path; subsection-scoped, helper'a değil
 * chat seviyesindeki diversity gerek yok orada.
 */
import { prisma } from "@/lib/db";
import { embedQuery } from "@/lib/library-pipeline";
import { expandQuery } from "@/lib/query-expansion";
import { splitComparativeQuery } from "@/lib/comparative-split";
import { generateHyde } from "@/lib/hyde";
import { ftsChunks, rrfMerge, rrfMergeMany } from "@/lib/hybrid-retrieval";

export interface LibraryChunk {
  id: string;
  kind: "chunk";
  entryId: string;
  volumeId: string | null;
  title: string;
  authorSurname: string | null;
  pageNumber: number | null;
  pdfPageLabel: string | null;
  sectionTitle: string | null;
  content: string;
  noteTitle: null;
}

export interface RetrievalOptions {
  userId: string;
  query: string;
  /** scope='picked' + entryIds verilirse sadece o entries içinden ara */
  scope?: "all" | "picked";
  entryIds?: string[];
  /** Kütüphane dilleri — multilingual query expansion için */
  libraryLangs?: string[];
  /** Hybrid pool size (default 60) */
  pool?: number;
  /** Final top-K (default 8) */
  topK?: number;
  /** MMR diversity cap (default 1 — her kitaptan max 1) */
  diversityCap?: number;
  /** HyDE açık mı (default false) */
  useHyDE?: boolean;
  /** Voyage embed model (default voyage-multilingual-2) */
  embedModel?: string;
}

/**
 * Top-K kütüphane chunk'ı getir. Tüm gelişmiş pipeline tek çağrıda.
 * Chat ve yazı endpoint'leri bunu paylaşır.
 */
export async function retrieveLibraryChunks(
  opts: RetrievalOptions,
): Promise<{
  chunks: LibraryChunk[];
  variants: string[];
}> {
  const {
    userId,
    query,
    scope = "all",
    entryIds = [],
    libraryLangs,
    pool = 60,
    topK = 8,
    diversityCap = 1,
    useHyDE = false,
    embedModel,
  } = opts;

  if (!query.trim()) return { chunks: [], variants: [] };
  if (scope === "picked" && entryIds.length === 0) {
    return { chunks: [], variants: [] };
  }

  // 1. Variants: expansion + comparative split + (opsiyonel) HyDE
  const [variants, subqueries, hyde] = await Promise.all([
    expandQuery(query, libraryLangs),
    splitComparativeQuery(query),
    useHyDE ? generateHyde(query) : Promise.resolve(null),
  ]);
  const allSet = new Set<string>(variants);
  for (const s of subqueries) allSet.add(s);
  if (hyde) allSet.add(hyde);
  const allVariants = [...allSet];

  // 2. Embed her variant
  const embedOpts = embedModel ? { model: embedModel } : undefined;
  const vecs = await Promise.all(
    allVariants.map((q) => embedQuery(q, embedOpts)),
  );

  // 3. Her variant için hybrid retrieve (vector + FTS, RRF)
  const hybridFor = async (qText: string, vec: number[]): Promise<LibraryChunk[]> => {
    const vecLiteral = JSON.stringify(vec);
    const [vectorHits, lexicalHits] = await Promise.all([
      scope === "all"
        ? prisma.$queryRaw<LibraryChunk[]>`
            SELECT lc.id AS id, 'chunk' AS kind, le.id AS "entryId",
                   lc."volumeId" AS "volumeId", le.title AS title,
                   le."authorSurname" AS "authorSurname", lc."pageNumber" AS "pageNumber",
                   lc."pdfPageLabel" AS "pdfPageLabel", lc."sectionTitle" AS "sectionTitle",
                   lc.content AS content, NULL AS "noteTitle"
            FROM "LibraryChunk" lc
            JOIN "LibraryEntry" le ON lc."libraryEntryId" = le.id
            WHERE le."userId" = ${userId} AND lc.embedding IS NOT NULL
            ORDER BY lc.embedding <=> ${vecLiteral}::vector
            LIMIT ${pool}
          `
        : prisma.$queryRaw<LibraryChunk[]>`
            SELECT lc.id AS id, 'chunk' AS kind, le.id AS "entryId",
                   lc."volumeId" AS "volumeId", le.title AS title,
                   le."authorSurname" AS "authorSurname", lc."pageNumber" AS "pageNumber",
                   lc."pdfPageLabel" AS "pdfPageLabel", lc."sectionTitle" AS "sectionTitle",
                   lc.content AS content, NULL AS "noteTitle"
            FROM "LibraryChunk" lc
            JOIN "LibraryEntry" le ON lc."libraryEntryId" = le.id
            WHERE le."userId" = ${userId}
              AND le.id = ANY(${entryIds}::text[]) AND lc.embedding IS NOT NULL
            ORDER BY lc.embedding <=> ${vecLiteral}::vector
            LIMIT ${pool}
          `,
      ftsChunks(
        userId,
        qText,
        scope === "all" ? null : entryIds,
        pool,
      ).catch(() => [] as LibraryChunk[]),
    ]);
    return rrfMerge(vectorHits, lexicalHits as LibraryChunk[]) as LibraryChunk[];
  };

  const chunkPools = await Promise.all(
    allVariants.map((qText, i) => {
      const v = vecs[i];
      return v ? hybridFor(qText, v) : Promise.resolve([] as LibraryChunk[]);
    }),
  );
  const mergedPool = (rrfMergeMany(chunkPools) as LibraryChunk[]).slice(0, pool);

  // 4. MMR diversity cap (her kitaptan max N)
  if (diversityCap > 0 && mergedPool.length > topK) {
    const selected: LibraryChunk[] = [];
    const overflow: LibraryChunk[] = [];
    const perEntry = new Map<string, number>();
    for (const item of mergedPool) {
      if (selected.length >= topK) break;
      const c = perEntry.get(item.entryId) ?? 0;
      if (c < diversityCap) {
        selected.push(item);
        perEntry.set(item.entryId, c + 1);
      } else {
        overflow.push(item);
      }
    }
    for (const item of overflow) {
      if (selected.length >= topK) break;
      selected.push(item);
    }
    return { chunks: selected, variants: allVariants };
  }

  return { chunks: mergedPool.slice(0, topK), variants: allVariants };
}
