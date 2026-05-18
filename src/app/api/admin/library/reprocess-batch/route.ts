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
 * openAccessUrl, kick off the same setImmediate background pipeline
 * the UI reprocess button uses. filePath wins so manual uploads go
 * through the (faster, pdfjs-first) byte path. Returns the count of
 * triggered jobs immediately — clients poll pdfStatus to watch
 * completion.
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import {
  processLibraryPdfFromBytes,
  processLibraryPdfFromUrl,
} from "@/lib/library-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Read at request time — Next 16's build-time env inlining was
  // dropping this to an empty string when read at module scope.
  const adminSecret = process.env.ADMIN_SESSION_SECRET;
  const secret = req.headers.get("x-admin-secret");
  console.info("[reprocess-batch] auth check", {
    envLen: adminSecret?.length ?? 0,
    headerLen: secret?.length ?? 0,
    match: !!adminSecret && !!secret && secret === adminSecret,
  });
  if (!adminSecret || !secret || secret !== adminSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    await prisma.libraryEntry.update({
      where: { id: entry.id },
      data: { pdfStatus: "pending", pdfError: null },
    });

    setImmediate(async () => {
      try {
        if (entry.filePath) {
          const bytes = await fs.readFile(entry.filePath);
          const filename = path.basename(entry.filePath);
          await processLibraryPdfFromBytes(entry.id, filename, bytes);
        } else if (entry.openAccessUrl) {
          await processLibraryPdfFromUrl(entry.id, entry.openAccessUrl);
        }
      } catch (err) {
        console.error(
          "[reprocess-batch] pipeline failed:",
          entry.id,
          err,
        );
      }
    });
    triggered++;
  }

  const notFound = ids.length - entries.length;
  return NextResponse.json({
    triggered,
    notFound,
    skipped,
  });
}
