/**
 * Batch reprocess library PDFs whose chunk content shows signs of
 * PyMuPDF-era extraction artifacts — mainly Turkish and Arabic
 * books where the old pipeline mis-decoded glyphs and left chunk
 * text drifting from what the viewer renders.
 *
 * Strategy: scan LibraryChunk for entries containing Turkish
 * (ç/ş/ğ/ı/ö/ü or their uppercase forms) or Arabic (U+0600-U+06FF)
 * characters, then re-trigger the entry-level reprocess endpoint
 * which now uses the pdfjs node path (commit e3544d5 + this PR).
 *
 * Why call the API instead of the pipeline directly: the endpoint
 * sets pdfStatus and triggers setImmediate background processing
 * identically to the UI button, so the user can monitor progress
 * the same way. It also handles per-entry filePath vs URL routing.
 *
 * Run on the Railway container (cookies + volume mount required):
 *   railway ssh --service writer-agent-app "cd /app && \
 *     COOKIE='__Secure-next-auth.session-token=...' \
 *     node scripts/reprocess-multilang.mjs"
 *
 * Or, for a dry-run that only lists eligible entries:
 *   railway ssh --service writer-agent-app "cd /app && \
 *     node scripts/reprocess-multilang.mjs --dry"
 */

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
const APP_URL = process.env.NEXTAUTH_URL ?? "https://quilpen.com";
const ADMIN_SECRET = process.env.ADMIN_SESSION_SECRET ?? "";
const DRY = process.argv.includes("--dry");
const BATCH_SIZE = 25;

if (!DATABASE_URL) {
  console.error("DATABASE_URL not set — run via `railway ssh`/`railway run`");
  process.exit(1);
}

if (!DRY && !ADMIN_SECRET) {
  console.error(
    "ADMIN_SESSION_SECRET not set in env. The Railway container has it;\n" +
      "this script needs to be run with the writer-agent-app env present.",
  );
  process.exit(1);
}

const sql = postgres(DATABASE_URL, {
  ssl: DATABASE_URL.includes("proxy.rlwy.net") ? "require" : false,
  max: 4,
});

async function main() {
  console.log("[reprocess] finding entries with Turkish or Arabic chunks…");
  // Entries whose chunk text matches either Turkish diacritics or
  // Arabic Unicode range. DISTINCT ON keeps one row per entry. The
  // sample column is just for human readability in the listing.
  const candidates = await sql`
    SELECT DISTINCT le.id, le.title, le."authorSurname"
    FROM "LibraryEntry" le
    JOIN "LibraryChunk" lc ON lc."libraryEntryId" = le.id
    WHERE le."filePath" IS NOT NULL
      AND (
        lc.content ~ '[çÇşŞğĞıİöÖüÜ]'
        OR lc.content ~ '[\\u0600-\\u06FF]'
      )
    ORDER BY le.title
  `;
  console.log(`[reprocess] ${candidates.length} eligible entries`);

  if (DRY) {
    for (const e of candidates) {
      console.log(`  ${e.id} ${e.authorSurname ?? "—"} — ${e.title?.slice(0, 70)}`);
    }
    await sql.end();
    return;
  }

  // Batch the entry IDs into groups so the server doesn't spin up
  // 135 setImmediate jobs at once (Python /embed batches would then
  // pile up). Each batch waits for the next round before continuing.
  const all = candidates.map((c) => c.id);
  let triggered = 0;
  let skipped = 0;
  let notFound = 0;
  for (let i = 0; i < all.length; i += BATCH_SIZE) {
    const batch = all.slice(i, i + BATCH_SIZE);
    const res = await fetch(
      `${APP_URL}/api/library/batch-reprocess`,
      {
        method: "POST",
        headers: {
          "x-admin-secret": ADMIN_SECRET,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ entryIds: batch }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.log(`  ✗ batch ${i}-${i + batch.length}: HTTP ${res.status} ${body.slice(0, 200)}`);
      continue;
    }
    const data = await res.json();
    triggered += data.triggered ?? 0;
    skipped += (data.skipped?.length ?? 0);
    notFound += data.notFound ?? 0;
    console.log(`  ✓ batch ${i / BATCH_SIZE + 1}: triggered ${data.triggered}, skipped ${data.skipped?.length ?? 0}, notFound ${data.notFound ?? 0}`);
    if (data.skipped?.length > 0) {
      for (const s of data.skipped.slice(0, 5)) {
        console.log(`     skipped ${s.id}: ${s.reason}`);
      }
    }
    // Spread batches so the worker pool can actually process before
    // the next batch arrives — each reprocess takes ~10-30s.
    if (i + BATCH_SIZE < all.length) {
      await new Promise((r) => setTimeout(r, 60_000));
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Triggered: ${triggered}`);
  console.log(`Skipped:   ${skipped}`);
  console.log(`Not found: ${notFound}`);
  console.log(
    `Background processing continues server-side. Monitor pdfStatus\n` +
      `with: SELECT id, title, "pdfStatus" FROM "LibraryEntry" WHERE\n` +
      `  id IN (...) — should flip from 'pending'/'extracting'/'embedding' → 'ready'.`,
  );

  await sql.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
