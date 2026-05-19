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

  return NextResponse.json({
    aggregate: agg,
    pdfStatusBreakdown: statusBreakdown,
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
