/**
 * POST /api/admin/library/reprocess-batch
 *
 * Internal one-shot endpoint used by scripts/reprocess-multilang.mjs
 * (and any future bulk-rerun tool) to re-trigger the pdfjs extraction
 * pipeline for a list of LibraryEntry ids without needing a user
 * session cookie. Guards on a static admin secret because the script
 * runs from the Railway container where session cookies aren't
 * available.
 *
 * Request:
 *   POST /api/admin/library/reprocess-batch
 *   x-admin-secret: <ADMIN_SESSION_SECRET>
 *   Content-Type: application/json
 *   { "entryIds": ["id1", "id2", ...] }
 *
 * Behavior: for every entry that exists and has either filePath or
 * openAccessUrl, clear its chunks and enqueue a fresh ingest on the
 * worker queue (the worker reads the R2 file, or re-downloads the URL).
 * Returns the count of triggered jobs immediately — clients poll
 * pdfStatus to watch completion.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { enqueueIngest } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Read at request time — Next 16's build-time env inlining was
  // dropping this to an empty string when read at module scope.
  const adminSecret = process.env.ADMIN_SESSION_SECRET;
  const secret = req.headers.get("x-admin-secret");
  if (!adminSecret || !secret || secret !== adminSecret) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        // Temporary diag — these only ship the first 8 chars so we
        // can see why the compare fails without exposing the secret.
        debug: {
          envLen: adminSecret?.length ?? 0,
          envFirst8: adminSecret?.slice(0, 8) ?? "(empty)",
          headerLen: secret?.length ?? 0,
          headerFirst8: secret?.slice(0, 8) ?? "(empty)",
          haveEnv: !!adminSecret,
          haveHeader: !!secret,
        },
      },
      { status: 401 },
    );
  }

  let body: { entryIds?: unknown };
  try {
    body = (await req.json()) as { entryIds?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ids = Array.isArray(body.entryIds)
    ? body.entryIds.filter((x): x is string => typeof x === "string")
    : [];
  if (ids.length === 0) {
    return NextResponse.json(
      { error: "entryIds array required" },
      { status: 400 },
    );
  }

  const entries = await prisma.libraryEntry.findMany({
    where: { id: { in: ids } },
    select: { id: true, filePath: true, openAccessUrl: true, title: true },
  });

  let triggered = 0;
  const skipped: Array<{ id: string; reason: string }> = [];
  for (const entry of entries) {
    if (!entry.filePath && !entry.openAccessUrl) {
      skipped.push({ id: entry.id, reason: "no file and no URL" });
      continue;
    }

    // Fresh slate so the worker re-extracts instead of resuming embed.
    await prisma.libraryChunk.deleteMany({
      where: { libraryEntryId: entry.id, volumeId: null },
    });
    await prisma.libraryEntry.update({
      where: { id: entry.id },
      data: { pdfStatus: "queued", pdfError: null },
    });
    await enqueueIngest({ kind: "entry", entryId: entry.id }, { batch: true });
    triggered++;
  }

  const notFound = ids.length - entries.length;
  return NextResponse.json({
    triggered,
    notFound,
    skipped,
  });
}
