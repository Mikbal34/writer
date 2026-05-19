/**
 * DEPRECATED — use POST /api/library/backfill-contextual instead.
 *
 * This script drove the work over `railway ssh`; the WebSocket
 * dropped mid-run on the first 4500-chunk Arabic book and
 * stranded ~200 entries. The container-internal route runs the
 * exact same orchestration inside the long-lived Next.js process,
 * so SSH stability no longer matters. Kept here as a fallback if
 * the in-process runner ever needs to be bypassed.
 *
 * To trigger:
 *   curl -X POST https://quilpen.com/api/library/backfill-contextual \
 *     -H "x-admin-secret: $ADMIN_SESSION_SECRET"
 *   curl https://quilpen.com/api/library/backfill-contextual \
 *     -H "x-admin-secret: $ADMIN_SESSION_SECRET"   # poll status
 *
 * ---
 *
 * Backfill missing LibraryChunk.contextualPrefix + re-embed those
 * chunks using prefix+content, and fill LibraryEntry.summary for
 * any entry that didn't get one during the main rechunk pass.
 *
 * Why a separate script: the rechunk-all backfill ran 20 entries in
 * parallel, each firing 3 parallel Haiku calls = ~60 concurrent
 * requests against Anthropic. That bursted past the per-key rate
 * cap and the chunk-level retry policy (2 attempts, sub-second
 * backoff) couldn't recover most of the failures. Result: ~%0.3
 * contextual coverage, ~2/149 summaries.
 *
 * This script is deliberately serial and patient:
 *   - 1 entry at a time, no parallelism
 *   - within an entry, batched calls (10 chunks per Haiku request)
 *   - generous backoff (2s/8s/32s) handled by contextual-chunks
 *     module; per-entry pause of 3s on top
 *   - missing summaries also generated here
 *   - re-embed prefix+content per touched chunk
 *
 * Designed to leave already-prefixed chunks alone — idempotent,
 * safe to re-run.
 *
 * Run on the Railway container:
 *   railway ssh --service writer-agent-app \
 *     "cd /app && node scripts/backfill-contextual.mjs"
 */

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";
const DRY = process.argv.includes("--dry");
const ENTRY_PAUSE_MS = 3_000;
const EMBED_BATCH = 50;
const APP_URL = process.env.NEXTAUTH_URL ?? "https://quilpen.com";
const ADMIN_SECRET = process.env.ADMIN_SESSION_SECRET ?? "";

if (!DATABASE_URL) {
  console.error("DATABASE_URL not set — run via `railway ssh`/`railway run`");
  process.exit(1);
}
if (!DRY && !ADMIN_SECRET) {
  console.error("ADMIN_SESSION_SECRET not set in env");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, {
  ssl: DATABASE_URL.includes("proxy.rlwy.net") ? "require" : false,
  max: 2,
});

async function embedBatch(texts) {
  const res = await fetch(`${PYTHON_SERVICE_URL}/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts }),
  });
  if (!res.ok) {
    throw new Error(`/embed HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.embeddings;
}

async function main() {
  console.log("[backfill-contextual] finding entries with missing prefixes…");
  const rows = await sql`
    SELECT le.id, le.title, le."authorSurname", le."authorName", le.year, le.summary,
           COUNT(lc.id)::int AS total,
           COUNT(*) FILTER (WHERE lc."contextualPrefix" IS NOT NULL)::int AS has_ctx,
           COUNT(*) FILTER (WHERE lc."contextualPrefix" IS NULL)::int AS missing_ctx
    FROM "LibraryEntry" le
    JOIN "LibraryChunk" lc ON lc."libraryEntryId" = le.id
    GROUP BY le.id, le.title, le."authorSurname", le."authorName", le.year, le.summary
    HAVING COUNT(*) FILTER (WHERE lc."contextualPrefix" IS NULL) > 0
       OR le.summary IS NULL
    ORDER BY missing_ctx DESC
  `;
  console.log(`[backfill-contextual] ${rows.length} entries need work`);
  if (DRY) {
    for (const r of rows.slice(0, 20)) {
      console.log(
        `  ${r.id.slice(0, 12)} | ${r.has_ctx}/${r.total} ctx, summary=${r.summary ? "✓" : "✗"} | ${r.title?.slice(0, 60)}`,
      );
    }
    if (rows.length > 20) console.log(`  …and ${rows.length - 20} more`);
    await sql.end();
    return;
  }

  let touched = 0;
  let chunksUpdated = 0;
  let summariesGen = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const tag = `[${i + 1}/${rows.length}]`;
    console.log(
      `${tag} ${r.title?.slice(0, 50)} — ${r.missing_ctx}/${r.total} missing prefix${r.summary ? "" : " + summary"}`,
    );

    // Trigger the per-entry contextual + summary pipeline via the
    // batch-reprocess admin endpoint — it already orchestrates
    // extraction → chunk → contextual → embed → summary using the
    // updated batched policy. Setting status=pending makes it
    // re-extract from the on-disk PDF, but since the new pipeline
    // now uses contextualizeChunksBatched the rate-limit problem
    // shouldn't repeat at this slower (1-entry-at-a-time) cadence.
    try {
      const res = await fetch(
        `${APP_URL}/api/library/batch-reprocess`,
        {
          method: "POST",
          headers: {
            "x-admin-secret": ADMIN_SECRET,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ entryIds: [r.id] }),
        },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.log(`  ✗ HTTP ${res.status} ${body.slice(0, 100)}`);
        continue;
      }
      touched++;
    } catch (err) {
      console.log(`  ✗ trigger failed: ${err.message}`);
      continue;
    }

    // Wait until this entry's pdfStatus settles before moving on —
    // that guarantees serial Haiku usage. Polling cheaper than
    // sleeping a fixed budget since some books are 100 chunks and
    // some are 2000.
    const start = Date.now();
    const timeoutMs = 25 * 60 * 1000; // 25 min/book upper bound
    while (Date.now() - start < timeoutMs) {
      const [s] = await sql`
        SELECT "pdfStatus" FROM "LibraryEntry" WHERE id = ${r.id}
      `;
      if (s.pdfStatus === "ready" || s.pdfStatus === "failed") break;
      await new Promise((res) => setTimeout(res, 8_000));
    }

    // Per-entry pause so the embed/Haiku pools breathe.
    await new Promise((res) => setTimeout(res, ENTRY_PAUSE_MS));

    // Quick stat recheck for the log.
    const [post] = await sql`
      SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE "contextualPrefix" IS NOT NULL)::int AS ctx
      FROM "LibraryChunk" WHERE "libraryEntryId" = ${r.id}
    `;
    const [postSum] = await sql`
      SELECT (summary IS NOT NULL) AS has_summary FROM "LibraryEntry" WHERE id = ${r.id}
    `;
    chunksUpdated += post.ctx;
    if (postSum.has_summary) summariesGen++;
    console.log(
      `  → ${post.ctx}/${post.total} ctx now; summary=${postSum.has_summary ? "✓" : "✗"}`,
    );
  }

  console.log("\n=== Summary ===");
  console.log(`Entries touched: ${touched}/${rows.length}`);
  console.log(`Chunks with contextual prefix: ${chunksUpdated}`);
  console.log(`Entries with summary: ${summariesGen}`);

  await sql.end();
}

// Embed helper is currently unused since we rely on the
// batch-reprocess endpoint to do the embed too — left in case we
// switch to direct DB updates later.
void embedBatch;
void EMBED_BATCH;

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
