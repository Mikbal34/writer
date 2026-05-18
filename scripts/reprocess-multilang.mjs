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
const APP_URL =
  process.env.NEXTAUTH_URL ?? "https://quilpen.com";
const COOKIE = process.env.COOKIE ?? "";
const DRY = process.argv.includes("--dry");

if (!DATABASE_URL) {
  console.error("DATABASE_URL not set — run via `railway ssh`/`railway run`");
  process.exit(1);
}

if (!DRY && !COOKIE) {
  console.error(
    "COOKIE not set. Either pass --dry to just list candidates, or set\n" +
      "COOKIE='__Secure-next-auth.session-token=...' so the reprocess\n" +
      "endpoint accepts the request.",
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

  let triggered = 0;
  let failed = 0;
  for (const e of candidates) {
    try {
      const res = await fetch(
        `${APP_URL}/api/library/entries/${e.id}/reprocess`,
        {
          method: "POST",
          headers: {
            Cookie: COOKIE,
            "Content-Type": "application/json",
          },
        },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        failed++;
        console.log(`  ✗ ${e.id} ${e.title?.slice(0, 50)} → HTTP ${res.status} ${body.slice(0, 100)}`);
        continue;
      }
      triggered++;
      console.log(`  ✓ ${e.id} ${e.title?.slice(0, 50)}`);
      // Stagger so background workers + Python /embed don't get
      // hammered. Each reprocess takes ~10-30s; trickling at 2s/req
      // means a 50-entry batch finishes processing in roughly the
      // same wall-clock time as the trigger loop.
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      failed++;
      console.log(`  ✗ ${e.id}: ${err.message}`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Triggered: ${triggered}`);
  console.log(`Failed:    ${failed}`);
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
