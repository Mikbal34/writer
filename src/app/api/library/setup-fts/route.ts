/**
 * POST /api/library/setup-fts  — one-shot DDL bootstrap for hybrid
 * retrieval. Adds the `contentTsv` GENERATED STORED column on
 * `LibraryChunk` and `LibraryNote`, plus the matching GIN indexes.
 * Idempotent (IF NOT EXISTS), safe to re-run.
 *
 * Why an endpoint instead of a Prisma migration: Prisma's schema
 * format can't express GENERATED ALWAYS or GIN-on-tsvector cleanly,
 * and the project doesn't have a migrations folder yet (schema
 * lives only as `db push`). Running the DDL through the app's
 * own connection keeps the change auditable in git and avoids
 * needing a separate SSH session.
 *
 * Cost: ADD COLUMN STORED rewrites the whole table to populate
 * the new value. For a 70 K-row LibraryChunk that's ~30–60 s of
 * ACCESS EXCLUSIVE lock — any in-flight insert (e.g. backfill
 * loop) will block and resume after, no data is lost.
 *
 * Admin secret guarded — same secret as backfill / batch-reprocess.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const adminSecret = process.env.ADMIN_SESSION_SECRET;
  const secret = req.headers.get("x-admin-secret");
  if (!adminSecret || secret !== adminSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const log: string[] = [];
  const time = async (label: string, sql: string) => {
    const t0 = Date.now();
    await prisma.$executeRawUnsafe(sql);
    log.push(`${label} — ${Date.now() - t0} ms`);
  };

  try {
    // LibraryChunk: prefix + content. Both can be NULL in old rows,
    // so coalesce defends against `NULL || '...'` producing NULL.
    await time(
      "ALTER LibraryChunk add contentTsv",
      `ALTER TABLE "LibraryChunk"
         ADD COLUMN IF NOT EXISTS "contentTsv" tsvector
         GENERATED ALWAYS AS (
           to_tsvector(
             'simple',
             coalesce("contextualPrefix", '') || ' ' || coalesce(content, '')
           )
         ) STORED`,
    );
    await time(
      "CREATE GIN index LibraryChunk",
      `CREATE INDEX IF NOT EXISTS "LibraryChunk_contentTsv_idx"
         ON "LibraryChunk" USING GIN ("contentTsv")`,
    );

    // LibraryNote: title (nullable) + contentText.
    await time(
      "ALTER LibraryNote add contentTsv",
      `ALTER TABLE "LibraryNote"
         ADD COLUMN IF NOT EXISTS "contentTsv" tsvector
         GENERATED ALWAYS AS (
           to_tsvector(
             'simple',
             coalesce(title, '') || ' ' || coalesce("contentText", '')
           )
         ) STORED`,
    );
    await time(
      "CREATE GIN index LibraryNote",
      `CREATE INDEX IF NOT EXISTS "LibraryNote_contentTsv_idx"
         ON "LibraryNote" USING GIN ("contentTsv")`,
    );

    const [stats] = await prisma.$queryRawUnsafe<
      Array<{
        chunks_total: number;
        chunks_indexed: number;
        notes_total: number;
        notes_indexed: number;
      }>
    >(`
      SELECT
        (SELECT COUNT(*)::int FROM "LibraryChunk") AS chunks_total,
        (SELECT COUNT(*)::int FROM "LibraryChunk" WHERE "contentTsv" IS NOT NULL AND "contentTsv" <> '') AS chunks_indexed,
        (SELECT COUNT(*)::int FROM "LibraryNote") AS notes_total,
        (SELECT COUNT(*)::int FROM "LibraryNote" WHERE "contentTsv" IS NOT NULL AND "contentTsv" <> '') AS notes_indexed
    `);

    return NextResponse.json({ ok: true, log, stats });
  } catch (err) {
    console.error("[setup-fts] failed", err);
    return NextResponse.json(
      {
        ok: false,
        log,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
