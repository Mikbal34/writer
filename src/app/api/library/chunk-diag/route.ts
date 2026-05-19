/**
 * GET /api/library/chunk-diag
 *
 * One-shot diagnostic endpoint — admin-only. Returns aggregate +
 * per-entry stats so we can answer "what did backfill actually
 * process and what did it burn money on?" without touching the
 * Postgres CLI. Intended to be deleted once the immediate
 * credit-burn investigation is over; kept admin-secret guarded
 * in the meantime.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const adminSecret = process.env.ADMIN_SESSION_SECRET;
  const secret = req.headers.get("x-admin-secret");
  if (!adminSecret || secret !== adminSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Aggregate ───────────────────────────────────────────────
  const [agg] = await prisma.$queryRawUnsafe<
    Array<{
      total_entries: number;
      entries_with_summary: number;
      total_chunks: number;
      chunks_with_ctx: number;
      chunks_missing_ctx: number;
      chunks_with_embed: number;
      chunks_missing_embed: number;
    }>
  >(`
    SELECT
      (SELECT COUNT(*)::int FROM "LibraryEntry") AS total_entries,
      (SELECT COUNT(*)::int FROM "LibraryEntry" WHERE summary IS NOT NULL) AS entries_with_summary,
      (SELECT COUNT(*)::int FROM "LibraryChunk") AS total_chunks,
      (SELECT COUNT(*)::int FROM "LibraryChunk" WHERE "contextualPrefix" IS NOT NULL) AS chunks_with_ctx,
      (SELECT COUNT(*)::int FROM "LibraryChunk" WHERE "contextualPrefix" IS NULL) AS chunks_missing_ctx,
      (SELECT COUNT(*)::int FROM "LibraryChunk" WHERE embedding IS NOT NULL) AS chunks_with_embed,
      (SELECT COUNT(*)::int FROM "LibraryChunk" WHERE embedding IS NULL) AS chunks_missing_embed
  `);

  // ── Per-entry "what happened to this book" ──────────────────
  const perEntry = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      title: string;
      pdfStatus: string;
      summary_present: boolean;
      total: number;
      with_ctx: number;
      with_embed: number;
      updated_at: Date;
    }>
  >(`
    SELECT le.id,
           le.title,
           le."pdfStatus",
           (le.summary IS NOT NULL) AS summary_present,
           COUNT(lc.id)::int AS total,
           COUNT(*) FILTER (WHERE lc."contextualPrefix" IS NOT NULL)::int AS with_ctx,
           COUNT(*) FILTER (WHERE lc.embedding IS NOT NULL)::int AS with_embed,
           le."updatedAt" AS updated_at
    FROM "LibraryEntry" le
    LEFT JOIN "LibraryChunk" lc ON lc."libraryEntryId" = le.id
    GROUP BY le.id, le.title, le."pdfStatus", le.summary, le."updatedAt"
    ORDER BY le."updatedAt" DESC
    LIMIT 40
  `);

  // ── Most-recently-touched chunks (looking for thrash) ───────
  const recentChunks = await prisma.$queryRawUnsafe<
    Array<{
      entry_title: string;
      ctx: number;
      total: number;
    }>
  >(`
    SELECT le.title AS entry_title,
           COUNT(*) FILTER (WHERE lc."contextualPrefix" IS NOT NULL)::int AS ctx,
           COUNT(*)::int AS total
    FROM "LibraryChunk" lc
    JOIN "LibraryEntry" le ON lc."libraryEntryId" = le.id
    GROUP BY le.title
    HAVING COUNT(*) FILTER (WHERE lc."contextualPrefix" IS NOT NULL) > 0
    ORDER BY ctx DESC
    LIMIT 20
  `);

  // ── pdfStatus distribution ──────────────────────────────────
  const statusBreakdown = await prisma.$queryRawUnsafe<
    Array<{ status: string; count: number }>
  >(`
    SELECT "pdfStatus" AS status, COUNT(*)::int AS count
    FROM "LibraryEntry"
    GROUP BY "pdfStatus"
    ORDER BY count DESC
  `);

  // ── Actionable buckets — names of every entry that needs rework ─
  const stuckOrBroken = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      title: string;
      pdfStatus: string;
      total_chunks: number;
      with_embed: number;
      has_file: boolean;
      has_oa_url: boolean;
      updated_at: Date;
    }>
  >(`
    SELECT le.id,
           le.title,
           le."pdfStatus",
           COUNT(lc.id)::int AS total_chunks,
           COUNT(*) FILTER (WHERE lc.embedding IS NOT NULL)::int AS with_embed,
           (le."filePath" IS NOT NULL) AS has_file,
           (le."openAccessUrl" IS NOT NULL) AS has_oa_url,
           le."updatedAt" AS updated_at
    FROM "LibraryEntry" le
    LEFT JOIN "LibraryChunk" lc ON lc."libraryEntryId" = le.id
    WHERE le."pdfStatus" IN ('embedding', 'none', 'failed')
    GROUP BY le.id, le.title, le."pdfStatus", le."filePath", le."openAccessUrl", le."updatedAt"
    ORDER BY le."updatedAt" DESC
  `);

  // ── Pipeline freshness proxy on "ready" entries ─────────────
  // Heading capture rate on chunks indicates whether they went
  // through the new chunker (step 3 of chunk-quality overhaul):
  //   >50%  →  new pipeline, fine
  //   1–50% →  partial / mixed
  //   ~0%   →  old chunker, would benefit from re-process
  const readyFreshness = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      title: string;
      total_chunks: number;
      with_section: number;
      with_page_label: number;
      summary_present: boolean;
    }>
  >(`
    SELECT le.id,
           le.title,
           (le.summary IS NOT NULL) AS summary_present,
           COUNT(lc.id)::int AS total_chunks,
           COUNT(*) FILTER (WHERE lc."sectionTitle" IS NOT NULL)::int AS with_section,
           COUNT(*) FILTER (WHERE lc."pdfPageLabel" IS NOT NULL)::int AS with_page_label
    FROM "LibraryEntry" le
    LEFT JOIN "LibraryChunk" lc ON lc."libraryEntryId" = le.id
    WHERE le."pdfStatus" = 'ready'
    GROUP BY le.id, le.title, le.summary
    HAVING COUNT(lc.id) > 0
    ORDER BY le."updatedAt" DESC
  `);

  // Bucket the ready ones by how "new-pipeline-shaped" they look.
  const buckets = { newPipeline: 0, mixed: 0, oldChunker: 0 };
  const oldChunkerEntries: Array<{ title: string; total: number; sectionPct: number; pagePct: number }> = [];
  for (const e of readyFreshness) {
    const sectionPct = e.total_chunks > 0 ? (e.with_section / e.total_chunks) * 100 : 0;
    const pagePct = e.total_chunks > 0 ? (e.with_page_label / e.total_chunks) * 100 : 0;
    if (sectionPct >= 50 || pagePct >= 50) buckets.newPipeline += 1;
    else if (sectionPct > 0 || pagePct > 0) buckets.mixed += 1;
    else {
      buckets.oldChunker += 1;
      if (oldChunkerEntries.length < 30) {
        oldChunkerEntries.push({
          title: e.title.slice(0, 80),
          total: e.total_chunks,
          sectionPct: Math.round(sectionPct),
          pagePct: Math.round(pagePct),
        });
      }
    }
  }

  return NextResponse.json({
    aggregate: agg,
    pdfStatusBreakdown: statusBreakdown,
    readyPipelineBuckets: buckets,
    actionable: {
      stuckOrBroken: stuckOrBroken.map((e) => ({
        id: e.id,
        title: e.title.slice(0, 80),
        pdfStatus: e.pdfStatus,
        chunks: e.total_chunks,
        withEmbed: e.with_embed,
        hasFile: e.has_file,
        hasOaUrl: e.has_oa_url,
        updatedAt: e.updated_at,
      })),
      oldChunkerSample: oldChunkerEntries,
    },
    entriesWithCtxProgress: recentChunks,
    recentEntries: perEntry.map((e) => ({
      title: e.title.slice(0, 80),
      pdfStatus: e.pdfStatus,
      summary: e.summary_present,
      total: e.total,
      ctxPct:
        e.total > 0 ? Math.round((e.with_ctx / e.total) * 100) : 0,
      embedPct:
        e.total > 0 ? Math.round((e.with_embed / e.total) * 100) : 0,
      updatedAt: e.updated_at,
    })),
  });
}
