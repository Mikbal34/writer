import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { embedQuery } from "@/lib/library-pipeline";

export type VerificationStatus = "unverified" | "verified" | "suspected" | "failed";
export type VerificationMethod =
  | "exact"
  | "fuzzy"
  | "semantic"
  | "page_neighbor"
  | "not_found"
  | "no_quote";

export interface VerifyInput {
  projectId: string;
  subsectionId: string;
  bibliographyId: string;
  /** Target page from the citation. `null` means "page unspecified". */
  page: number | null;
  /** The pull-quote the writer wrote into <span data-quote="…">. */
  quote: string | null;
  /** Multi-volume entries: which cilt the citation pointed to. `null`
   *  means single-volume (chunk lookup falls back to entry-level rows). */
  volumeId: string | null;
}

export interface VerifyResult {
  status: VerificationStatus;
  matchScore: number | null;
  matchMethod: VerificationMethod | null;
  matchedPage: number | null;
  matchedSnippet: string | null;
}

// ---------------------------------------------------------------------------
// Quote normalisation — mirrors the rules used elsewhere in the codebase
// (PdfViewerWithHighlights, bibliography-extract) so a quote that matches
// here will also light up in the PDF viewer.
// ---------------------------------------------------------------------------
function normalizeForCompare(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .replace(/[‘’‚‛]/g, "'") // curly → straight quote
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—−]/g, "-") // various dashes → -
    .replace(/\s+/g, " ")
    .trim();
}

export function quoteHashOf(quote: string | null | undefined): string {
  if (!quote) return "";
  const norm = normalizeForCompare(quote);
  if (!norm) return "";
  return createHash("sha1").update(norm).digest("hex").slice(0, 16);
}

// Cosine similarity over two 1024-dim Voyage vectors.
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ---------------------------------------------------------------------------
// 3-tier verifier.
//
//   Tier 1 — exact substring match of the quote in the target page's
//            extracted chunks.
//   Tier 2 — same, but after the shared normalisation (diacritics,
//            quote-style, dashes, whitespace).
//   Tier 3 — Voyage cosine similarity between the quote (or its
//            surrounding context if there's no quote) and the target
//            page's chunk content. Acts as a fallback when OCR
//            damage prevents either string-level match.
//   Tier 4 — page-neighbour fallback: when target-page chunks don't
//            yield a match, scan ±2 pages with Tier 1/2 logic. A hit
//            here is marked `suspected` because the page number the
//            writer entered is probably wrong.
//
// Thresholds (cosine):
//   ≥ 0.78 → verified (semantic)
//   ≥ 0.55 → suspected (semantic)
//   <  0.55 → failed (not_found)
// ---------------------------------------------------------------------------

type Tx = PrismaClient | Prisma.TransactionClient;

type ChunkRow = {
  pageNumber: number | null;
  content: string;
};

async function fetchTargetChunks(
  tx: Tx,
  libraryEntryId: string,
  volumeId: string | null,
  page: number | null,
  pageOffset: number = 0,
): Promise<ChunkRow[]> {
  const where: Prisma.LibraryChunkWhereInput = volumeId
    ? { volumeId }
    : { libraryEntryId, volumeId: null };
  if (page !== null) {
    const target = page + pageOffset;
    where.pageNumber = target;
  }
  return tx.libraryChunk.findMany({
    where,
    select: { pageNumber: true, content: true },
    orderBy: { chunkIndex: "asc" },
  });
}

function snippetAround(text: string, anchor: string, span: number = 160): string {
  if (!anchor || !text) return text.slice(0, span);
  const idx = text.toLowerCase().indexOf(anchor.toLowerCase());
  if (idx === -1) return text.slice(0, span);
  const start = Math.max(0, idx - 40);
  return text.slice(start, start + span).trim();
}

export async function verifyCitation(
  tx: Tx,
  input: VerifyInput,
): Promise<VerifyResult> {
  // Resolve bibliography → libraryEntry.
  const bib = await tx.bibliography.findUnique({
    where: { id: input.bibliographyId },
    select: { libraryEntryId: true, projectId: true },
  });
  if (!bib || bib.projectId !== input.projectId || !bib.libraryEntryId) {
    // No library entry to compare against — manual bibliography or
    // missing PDF. Mark as failed with not_found so the UI shows a
    // red flag.
    return {
      status: "failed",
      matchScore: 0,
      matchMethod: "not_found",
      matchedPage: null,
      matchedSnippet: null,
    };
  }

  const libraryEntryId = bib.libraryEntryId;

  // Pull the target page's chunks (or volume's if multi-volume).
  const targetChunks = await fetchTargetChunks(
    tx,
    libraryEntryId,
    input.volumeId,
    input.page,
  );
  if (targetChunks.length === 0) {
    return {
      status: "failed",
      matchScore: 0,
      matchMethod: "not_found",
      matchedPage: null,
      matchedSnippet: null,
    };
  }
  const joinedTarget = targetChunks.map((c) => c.content).join("\n");

  // No quote — we can't make a string claim. Run a "soft" semantic
  // pass anyway using the chunk content vs a self-embedding; that
  // doesn't tell us much, so just mark it as no_quote.
  if (!input.quote || !input.quote.trim()) {
    return {
      status: "suspected",
      matchScore: null,
      matchMethod: "no_quote",
      matchedPage: input.page,
      matchedSnippet: targetChunks[0]?.content?.slice(0, 200) ?? null,
    };
  }

  const quote = input.quote.trim();
  const qNorm = normalizeForCompare(quote);
  const targetNorm = normalizeForCompare(joinedTarget);

  // Tier 1 — exact substring of the raw quote.
  if (joinedTarget.includes(quote)) {
    return {
      status: "verified",
      matchScore: 1,
      matchMethod: "exact",
      matchedPage: input.page,
      matchedSnippet: snippetAround(joinedTarget, quote),
    };
  }

  // Tier 2 — normalized fuzzy match (case/diacritic/whitespace
  // tolerant).
  if (qNorm && targetNorm.includes(qNorm)) {
    return {
      status: "verified",
      matchScore: 0.95,
      matchMethod: "fuzzy",
      matchedPage: input.page,
      matchedSnippet: snippetAround(joinedTarget, quote),
    };
  }

  // Tier 3 — semantic cosine via Voyage.
  let bestSemanticScore = 0;
  let bestSemanticSnippet: string | null = null;
  try {
    const qVec = await embedQuery(quote);
    if (qVec) {
      // Score each chunk individually and keep the best — single-chunk
      // similarity is a tighter signal than the joined-page average.
      const chunkVecs = await tx.$queryRaw<
        Array<{ content: string; embedding: number[] | null; page_number: number | null }>
      >`
        SELECT content,
               embedding::text::float8[] AS embedding,
               "pageNumber" AS page_number
        FROM "LibraryChunk"
        WHERE ${
          input.volumeId
            ? Prisma.sql`"volumeId" = ${input.volumeId}`
            : Prisma.sql`"libraryEntryId" = ${libraryEntryId} AND "volumeId" IS NULL`
        }
          ${
            input.page !== null
              ? Prisma.sql`AND "pageNumber" = ${input.page}`
              : Prisma.empty
          }
          AND embedding IS NOT NULL
      `;
      for (const c of chunkVecs) {
        if (!c.embedding) continue;
        const score = cosine(qVec, c.embedding);
        if (score > bestSemanticScore) {
          bestSemanticScore = score;
          bestSemanticSnippet = c.content.slice(0, 240);
        }
      }
    }
  } catch (err) {
    console.warn("[citation-verifier] semantic tier failed:", err);
  }

  if (bestSemanticScore >= 0.78) {
    return {
      status: "verified",
      matchScore: bestSemanticScore,
      matchMethod: "semantic",
      matchedPage: input.page,
      matchedSnippet: bestSemanticSnippet,
    };
  }
  if (bestSemanticScore >= 0.55) {
    // Semantic suspected — also try page-neighbour fallback for a
    // string match before settling.
    const neighbour = await tryNeighbourPages(tx, libraryEntryId, input);
    if (neighbour) return neighbour;
    return {
      status: "suspected",
      matchScore: bestSemanticScore,
      matchMethod: "semantic",
      matchedPage: input.page,
      matchedSnippet: bestSemanticSnippet,
    };
  }

  // Tier 4 — page neighbour ±2.
  const neighbour = await tryNeighbourPages(tx, libraryEntryId, input);
  if (neighbour) return neighbour;

  return {
    status: "failed",
    matchScore: bestSemanticScore || 0,
    matchMethod: "not_found",
    matchedPage: null,
    matchedSnippet: bestSemanticSnippet,
  };
}

async function tryNeighbourPages(
  tx: Tx,
  libraryEntryId: string,
  input: VerifyInput,
): Promise<VerifyResult | null> {
  if (input.page === null || !input.quote) return null;
  const quote = input.quote.trim();
  const qNorm = normalizeForCompare(quote);
  for (const offset of [-1, 1, -2, 2]) {
    const candidatePage = input.page + offset;
    if (candidatePage <= 0) continue;
    const chunks = await fetchTargetChunks(
      tx,
      libraryEntryId,
      input.volumeId,
      input.page,
      offset,
    );
    if (chunks.length === 0) continue;
    const joined = chunks.map((c) => c.content).join("\n");
    if (joined.includes(quote) || (qNorm && normalizeForCompare(joined).includes(qNorm))) {
      return {
        status: "suspected",
        matchScore: 0.9,
        matchMethod: "page_neighbor",
        matchedPage: candidatePage,
        matchedSnippet: snippetAround(joined, quote),
      };
    }
  }
  return null;
}

