/**
 * POST /api/library/setup-vectors  — one-shot vector hygiene.
 *
 * 1. L2-normalize every stored embedding in place (no re-embed).
 *    The 768-dim gemini-embedding-001 vectors were stored
 *    un-normalized (magnitude ≈ 0.59); normalizing makes cosine
 *    and L2 agree and lets an HNSW index rank correctly.
 * 2. Build HNSW cosine indexes on LibraryChunk + LibraryNote so
 *    retrieval stops doing a sequential scan over ~58K vectors.
 *
 * Idempotent: l2_normalize on an already-unit vector is a no-op;
 * indexes use IF NOT EXISTS. Admin-secret guarded. Delete once the
 * vector migration is settled.
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

  const body = (await req.json().catch(() => ({}))) as {
    skipNormalize?: boolean;
  };

  const log: string[] = [];
  const step = async (label: string, sql: string) => {
    const t0 = Date.now();
    const affected = await prisma.$executeRawUnsafe(sql);
    log.push(`${label} — ${Date.now() - t0}ms (rows: ${affected})`);
  };

  // HNSW's parallel build allocates dynamic shared memory, which
  // overflows Railway Postgres's small /dev/shm ("could not resize
  // shared memory segment … No space left on device"). Build
  // single-threaded with a bounded maintenance_work_mem instead —
  // slower but fits. Runs each index in its own transaction so the
  // SET LOCAL sticks to the same connection as the CREATE INDEX.
  const buildIndex = async (label: string, indexSql: string) => {
    const t0 = Date.now();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL max_parallel_maintenance_workers = 0`);
      await tx.$executeRawUnsafe(`SET LOCAL maintenance_work_mem = '128MB'`);
      await tx.$executeRawUnsafe(indexSql);
    }, { timeout: 280_000 });
    log.push(`${label} — ${Date.now() - t0}ms`);
  };

  try {
    // 1. Normalize existing vectors in place (skippable on re-run —
    //    it's a 58s full-table pass and idempotent).
    if (!body.skipNormalize) {
      await step(
        "normalize LibraryChunk embeddings",
        `UPDATE "LibraryChunk" SET embedding = l2_normalize(embedding) WHERE embedding IS NOT NULL`,
      );
      await step(
        "normalize LibraryNote embeddings",
        `UPDATE "LibraryNote" SET embedding = l2_normalize(embedding) WHERE embedding IS NOT NULL`,
      );
    } else {
      log.push("normalize — skipped (skipNormalize)");
    }

    // 2. HNSW cosine indexes, single-threaded build.
    await buildIndex(
      "HNSW cosine index LibraryChunk",
      `CREATE INDEX IF NOT EXISTS "LibraryChunk_embedding_hnsw_cos"
         ON "LibraryChunk" USING hnsw (embedding vector_cosine_ops)`,
    );
    await buildIndex(
      "HNSW cosine index LibraryNote",
      `CREATE INDEX IF NOT EXISTS "LibraryNote_embedding_hnsw_cos"
         ON "LibraryNote" USING hnsw (embedding vector_cosine_ops)`,
    );

    // Verify a sample magnitude is now ~1.0.
    const [check] = await prisma.$queryRawUnsafe<
      Array<{ mag: number; total: number }>
    >(`
      SELECT
        (SELECT sqrt((SELECT sum(v*v) FROM unnest(string_to_array(trim(both '[]' from embedding::text), ',')::float8[]) v))
           FROM "LibraryChunk" WHERE embedding IS NOT NULL LIMIT 1) AS mag,
        (SELECT COUNT(*)::int FROM "LibraryChunk" WHERE embedding IS NOT NULL) AS total
    `);

    return NextResponse.json({
      ok: true,
      log,
      sampleMagnitude: check?.mag,
      embeddedChunks: check?.total,
    });
  } catch (err) {
    console.error("[setup-vectors] failed", err);
    return NextResponse.json(
      { ok: false, log, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
