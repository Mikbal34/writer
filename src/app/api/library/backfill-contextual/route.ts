/**
 * POST /api/library/backfill-contextual  — start the loop
 * GET  /api/library/backfill-contextual  — poll progress
 *
 * Container-internal replacement for the railway-ssh-driven
 * `scripts/backfill-contextual.mjs`. One POST kicks off a
 * singleton serial loop inside the Next.js process; subsequent
 * POSTs while it's running are a no-op. GET returns the in-memory
 * job state alongside a fresh DB count so progress is observable
 * from a curl loop without needing log access.
 *
 * Admin-secret guarded (same secret as batch-reprocess) because
 * this triggers heavy paid Haiku traffic across the whole library.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getBackfillState, startBackfill } from "@/lib/backfill-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function checkAuth(req: NextRequest): NextResponse | null {
  const adminSecret = process.env.ADMIN_SESSION_SECRET;
  const secret = req.headers.get("x-admin-secret");
  if (!adminSecret || !secret || secret !== adminSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

async function fetchDbCounts() {
  const [row] = await prisma.$queryRaw<
    Array<{
      total_entries: number;
      entries_no_summary: number;
      total_chunks: number;
      chunks_missing_ctx: number;
    }>
  >`
    SELECT
      (SELECT COUNT(*)::int FROM "LibraryEntry") AS total_entries,
      (SELECT COUNT(*)::int FROM "LibraryEntry" WHERE summary IS NULL) AS entries_no_summary,
      (SELECT COUNT(*)::int FROM "LibraryChunk") AS total_chunks,
      (SELECT COUNT(*)::int FROM "LibraryChunk" WHERE "contextualPrefix" IS NULL) AS chunks_missing_ctx
  `;
  return row;
}

export async function POST(req: NextRequest) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;

  const started = startBackfill();
  const state = getBackfillState();
  return NextResponse.json(
    {
      started,
      message: started
        ? "backfill loop started"
        : "backfill already running — POST is a no-op",
      state,
    },
    { status: 202 },
  );
}

export async function GET(req: NextRequest) {
  const unauth = checkAuth(req);
  if (unauth) return unauth;

  const [state, db] = await Promise.all([
    Promise.resolve(getBackfillState()),
    fetchDbCounts(),
  ]);

  const coverage =
    db.total_chunks > 0
      ? ((db.total_chunks - db.chunks_missing_ctx) / db.total_chunks) * 100
      : 100;

  return NextResponse.json({
    state,
    db: {
      ...db,
      contextualCoveragePct: Number(coverage.toFixed(1)),
    },
  });
}
