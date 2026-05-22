/**
 * POST /api/library/reembed — re-embed existing chunk TEXT with the
 * current model (gemini-embedding-001), no re-extraction.
 *
 * Fixes the mixed-embedding-model problem: the rebuild only
 * re-embedded entries that had a file/OA URL. The no-file entries
 * (e.g. Wolfson's "Philosophy of the Kalam", Arabic classics —
 * uploaded as chunks without a source PDF) kept their OLD
 * gemini-embedding-2 vectors. Those live in a different semantic
 * space than 001 query vectors, so cosine retrieval can't find them
 * — the library suggests questions about them but can't answer.
 *
 * These entries have chunk CONTENT (just stale vectors), so we
 * re-embed the text through the Python /embed service (now 001 +
 * L2-normalized) and overwrite the vector. No PDF work, no
 * re-chunk, no Anthropic spend — only cheap embedding calls.
 *
 * Body: { scope?: 'nofile' | 'all', entryIds?: string[], dryRun?: boolean }
 *   - 'nofile' (default): entries with no filePath and no openAccessUrl
 *     (the model-2 suspects). 'all': every embedded chunk (uniform
 *     sweep). entryIds: restrict to specific entries.
 *
 * Fire-and-forget loop like the backfill runner; GET reports progress.
 * Admin-secret guarded.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";
const EMBED_BATCH = 40;

type ReembedStatus = "idle" | "running" | "completed" | "failed";
interface ReembedState {
  status: ReembedStatus;
  scope: string;
  total: number;
  done: number;
  failed: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  lastError: string | null;
}
let state: ReembedState = {
  status: "idle",
  scope: "",
  total: 0,
  done: 0,
  failed: 0,
  startedAt: null,
  finishedAt: null,
  lastError: null,
};

async function embedBatch(texts: string[]): Promise<number[][] | null> {
  try {
    const res = await fetch(`${PYTHON_SERVICE_URL}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { embeddings: number[][] };
    return data.embeddings ?? null;
  } catch {
    return null;
  }
}

interface ChunkRow {
  id: string;
  content: string;
}

async function fetchTargetChunks(
  scope: string,
  entryIds: string[] | null,
): Promise<ChunkRow[]> {
  if (entryIds && entryIds.length > 0) {
    // For explicit entryIds, embed ALL their chunks regardless of current
    // embedding state — covers both stale-vector re-embeds AND chunks that
    // never got embedded (e.g. ingest failed at the embedding step). The
    // `embedding IS NOT NULL` filter only makes sense for the model-sweep
    // scopes below, not for a targeted "fix these entries" request.
    return prisma.$queryRaw<ChunkRow[]>`
      SELECT lc.id, lc.content FROM "LibraryChunk" lc
      WHERE lc."libraryEntryId" = ANY(${entryIds}::text[])
        AND lc.content IS NOT NULL`;
  }
  if (scope === "all") {
    return prisma.$queryRaw<ChunkRow[]>`
      SELECT lc.id, lc.content FROM "LibraryChunk" lc
      WHERE lc.embedding IS NOT NULL AND lc.content IS NOT NULL`;
  }
  // 'nofile': entries with no source file and no OA URL → the model-2
  // suspects the rebuild never touched.
  return prisma.$queryRaw<ChunkRow[]>`
    SELECT lc.id, lc.content
    FROM "LibraryChunk" lc
    JOIN "LibraryEntry" le ON lc."libraryEntryId" = le.id
    WHERE le."filePath" IS NULL AND le."openAccessUrl" IS NULL
      AND lc.embedding IS NOT NULL AND lc.content IS NOT NULL`;
}

async function runLoop(scope: string, entryIds: string[] | null) {
  try {
    const chunks = await fetchTargetChunks(scope, entryIds);
    state.total = chunks.length;
    state.done = 0;
    state.failed = 0;
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH);
      const vectors = await embedBatch(batch.map((c) => c.content.slice(0, 8000)));
      if (!vectors || vectors.length !== batch.length) {
        state.failed += batch.length;
        continue;
      }
      for (let j = 0; j < batch.length; j++) {
        try {
          await prisma.$executeRawUnsafe(
            `UPDATE "LibraryChunk" SET embedding = $1::vector WHERE id = $2`,
            JSON.stringify(vectors[j]),
            batch[j].id,
          );
          state.done += 1;
        } catch {
          state.failed += 1;
        }
      }
    }
    // For a targeted entryIds fix, flip the entries back to 'ready' once
    // their chunks are embedded — they were left 'failed' when ingest
    // couldn't embed (e.g. the Gemini block).
    if (entryIds && entryIds.length > 0 && state.done > 0 && state.failed === 0) {
      await prisma.libraryEntry.updateMany({
        where: { id: { in: entryIds } },
        data: { pdfStatus: "ready", pdfError: null },
      });
    }
    state.status = "completed";
    state.finishedAt = new Date();
  } catch (err) {
    state.status = "failed";
    state.finishedAt = new Date();
    state.lastError = err instanceof Error ? err.message : String(err);
  }
}

export async function POST(req: NextRequest) {
  const adminSecret = process.env.ADMIN_SESSION_SECRET;
  const secret = req.headers.get("x-admin-secret");
  if (!adminSecret || secret !== adminSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (state.status === "running") {
    return NextResponse.json(
      { started: false, message: "already running", state },
      { status: 202 },
    );
  }
  const body = (await req.json().catch(() => ({}))) as {
    scope?: string;
    entryIds?: string[];
    dryRun?: boolean;
  };
  const scope = body.scope === "all" ? "all" : "nofile";
  const entryIds = Array.isArray(body.entryIds) ? body.entryIds : null;

  if (body.dryRun) {
    const chunks = await fetchTargetChunks(scope, entryIds);
    return NextResponse.json({ dryRun: true, scope, targetChunks: chunks.length });
  }

  state = {
    status: "running",
    scope: entryIds ? `entryIds(${entryIds.length})` : scope,
    total: 0,
    done: 0,
    failed: 0,
    startedAt: new Date(),
    finishedAt: null,
    lastError: null,
  };
  setImmediate(() => void runLoop(scope, entryIds));
  return NextResponse.json({ started: true, scope: state.scope }, { status: 202 });
}

export async function GET(req: NextRequest) {
  const adminSecret = process.env.ADMIN_SESSION_SECRET;
  const secret = req.headers.get("x-admin-secret");
  if (!adminSecret || secret !== adminSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ state });
}
