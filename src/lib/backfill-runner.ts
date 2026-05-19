/**
 * Container-internal backfill runner.
 *
 * Why this exists: `scripts/backfill-contextual.mjs` ran on a
 * developer machine and drove the container over `railway ssh`,
 * which dropped the WebSocket mid-book and stranded ~200 entries
 * with missing contextual prefixes. This runner moves the
 * orchestration inside the long-lived Next.js process so SSH
 * stability no longer matters: a single POST starts the loop, the
 * Node event loop keeps it alive between requests, and the only
 * thing that can kill it is a container restart (which is fine —
 * the work is idempotent and resumes from wherever it left off).
 *
 * Strict serial by design. The previous parallel attempt bursted
 * past the Haiku rate limit and landed ~0.3% contextual coverage.
 * One entry at a time + a per-entry pause keeps total throughput
 * predictable and well under Tier-2 RPM, even for a 4000-chunk
 * Arabic book.
 *
 * Progress is observable two ways:
 *   - in-memory `state` (current entry, totals, last error) — for
 *     a UI ticker or quick curl check
 *   - the database itself — chunk-level `contextualPrefix IS NULL`
 *     count is the authoritative remaining-work measure
 */

import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import {
  processLibraryPdfFromBytes,
  processLibraryPdfFromUrl,
} from "@/lib/library-pipeline";

const ENTRY_PAUSE_MS = 3_000;

export type BackfillStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed";

export interface BackfillState {
  status: BackfillStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  total: number;
  done: number;
  failed: number;
  currentEntryId: string | null;
  currentEntryTitle: string | null;
  lastError: string | null;
  recentLog: string[];
}

const LOG_TAIL = 50;

let state: BackfillState = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  total: 0,
  done: 0,
  failed: 0,
  currentEntryId: null,
  currentEntryTitle: null,
  lastError: null,
  recentLog: [],
};

function log(line: string) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log("[backfill]", line);
  state.recentLog.push(stamped);
  if (state.recentLog.length > LOG_TAIL) {
    state.recentLog.splice(0, state.recentLog.length - LOG_TAIL);
  }
}

export function getBackfillState(): BackfillState {
  // Defensive copy so the API handler can't mutate live state.
  return {
    ...state,
    recentLog: [...state.recentLog],
  };
}

interface QueueRow {
  id: string;
  title: string;
  filePath: string | null;
  openAccessUrl: string | null;
  missing_ctx: number;
  total_chunks: number;
  has_summary: boolean;
}

type BackfillMode = "default" | "rebuild-all";

async function fetchQueue(mode: BackfillMode): Promise<QueueRow[]> {
  if (mode === "rebuild-all") {
    // One-shot full rebuild: every entry with a usable source
    // (filePath or openAccessUrl), no other filter. Used after a
    // pipeline-level change that affects all chunks — e.g., the
    // Buffer→Uint8Array fix that lets pdfjs replace the Python OCR
    // fallback, restoring sectionTitle + pdfPageLabel on every
    // book. NOT safe to leave on auto-resume: every restart would
    // re-process the whole library again. Trigger explicitly via
    // POST, let it finish, never auto-resume in this mode.
    return prisma.$queryRaw<QueueRow[]>`
      SELECT le.id,
             le.title,
             le."filePath",
             le."openAccessUrl",
             COUNT(lc.id)::int AS total_chunks,
             COUNT(*) FILTER (WHERE lc."contextualPrefix" IS NULL)::int AS missing_ctx,
             (le.summary IS NOT NULL) AS has_summary
      FROM "LibraryEntry" le
      LEFT JOIN "LibraryChunk" lc ON lc."libraryEntryId" = le.id
      WHERE le."filePath" IS NOT NULL OR le."openAccessUrl" IS NOT NULL
      GROUP BY le.id, le.title, le."filePath", le."openAccessUrl", le.summary
      ORDER BY total_chunks ASC NULLS FIRST
    `;
  }
  // Default mode — only entries that *still need work* by the
  // contextual/summary/chunk-count signals. Idempotent: re-running
  // skips anything already finished, so safe with auto-resume.
  return prisma.$queryRaw<QueueRow[]>`
    SELECT le.id,
           le.title,
           le."filePath",
           le."openAccessUrl",
           COUNT(lc.id)::int AS total_chunks,
           COUNT(*) FILTER (WHERE lc."contextualPrefix" IS NULL)::int AS missing_ctx,
           (le.summary IS NOT NULL) AS has_summary
    FROM "LibraryEntry" le
    LEFT JOIN "LibraryChunk" lc ON lc."libraryEntryId" = le.id
    WHERE le."filePath" IS NOT NULL OR le."openAccessUrl" IS NOT NULL
    GROUP BY le.id, le.title, le."filePath", le."openAccessUrl", le.summary
    HAVING COUNT(*) FILTER (WHERE lc."contextualPrefix" IS NULL) > 0
       OR le.summary IS NULL
       OR COUNT(lc.id) = 0
    ORDER BY missing_ctx DESC
  `;
}

async function processEntry(entry: QueueRow): Promise<void> {
  if (entry.filePath) {
    const bytes = await fs.readFile(entry.filePath);
    const filename = path.basename(entry.filePath);
    await processLibraryPdfFromBytes(entry.id, filename, bytes);
    return;
  }
  if (entry.openAccessUrl) {
    await processLibraryPdfFromUrl(entry.id, entry.openAccessUrl);
    return;
  }
  throw new Error("entry has neither filePath nor openAccessUrl");
}

async function runLoop(mode: BackfillMode = "default"): Promise<void> {
  try {
    log(`mode: ${mode}`);
    const queue = await fetchQueue(mode);
    state.total = queue.length;
    state.done = 0;
    state.failed = 0;
    log(`queue resolved: ${queue.length} entries need backfill`);

    for (let i = 0; i < queue.length; i++) {
      const entry = queue[i];
      state.currentEntryId = entry.id;
      state.currentEntryTitle = entry.title;
      const tag = `[${i + 1}/${queue.length}]`;
      log(
        `${tag} ${entry.title?.slice(0, 60)} — missing_ctx=${entry.missing_ctx}, summary=${entry.has_summary ? "✓" : "✗"}`,
      );

      try {
        await processEntry(entry);
        // Quick post-stat for the log.
        const [stat] = await prisma.$queryRaw<
          Array<{ total: number; ctx: number; summary: boolean }>
        >`
          SELECT COUNT(lc.id)::int AS total,
                 COUNT(*) FILTER (WHERE lc."contextualPrefix" IS NOT NULL)::int AS ctx,
                 (le.summary IS NOT NULL) AS summary
          FROM "LibraryEntry" le
          LEFT JOIN "LibraryChunk" lc ON lc."libraryEntryId" = le.id
          WHERE le.id = ${entry.id}
          GROUP BY le.summary
        `;
        log(
          `  → ctx=${stat?.ctx ?? 0}/${stat?.total ?? 0}, summary=${stat?.summary ? "✓" : "✗"}`,
        );
        state.done += 1;
      } catch (err) {
        state.failed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        state.lastError = `${entry.id}: ${msg}`;
        log(`  ✗ failed: ${msg.slice(0, 200)}`);
      }

      // Per-entry pause so the embed + Haiku pools breathe between
      // books. Inside an entry, contextualizeChunksBatched already
      // throttles to 1 batch at a time.
      await new Promise((r) => setTimeout(r, ENTRY_PAUSE_MS));
    }

    state.status = "completed";
    state.finishedAt = new Date();
    state.currentEntryId = null;
    state.currentEntryTitle = null;
    log(`done: ${state.done} completed, ${state.failed} failed`);
  } catch (err) {
    state.status = "failed";
    state.finishedAt = new Date();
    state.lastError = err instanceof Error ? err.message : String(err);
    log(`fatal: ${state.lastError}`);
  }
}

/**
 * Start the backfill loop. Returns immediately. Subsequent calls
 * while a run is in flight are a no-op (returns false).
 *
 * `mode`:
 *   - "default" — only entries with missing contextual / summary /
 *     no chunks. Idempotent, safe to auto-resume.
 *   - "rebuild-all" — every entry with a file or OA URL,
 *     unconditionally. One-shot use: drive a full pipeline
 *     migration after a code change (e.g., Buffer fix that
 *     re-enables pdfjs → restores sectionTitle + pdfPageLabel).
 *     Don't combine with BACKFILL_AUTO_RESUME=1 or every restart
 *     will rerun the whole library.
 */
export function startBackfill(
  mode: "default" | "rebuild-all" = "default",
): boolean {
  if (state.status === "running") return false;
  state = {
    status: "running",
    startedAt: new Date(),
    finishedAt: null,
    total: 0,
    done: 0,
    failed: 0,
    currentEntryId: null,
    currentEntryTitle: null,
    lastError: null,
    recentLog: [],
  };
  log(`backfill loop starting (mode=${mode})`);
  // Fire-and-forget: the Node event loop keeps the closure alive
  // even after the HTTP response ships. Errors inside runLoop are
  // caught there and reflected in `state.status`.
  setImmediate(() => {
    void runLoop(mode);
  });
  return true;
}
