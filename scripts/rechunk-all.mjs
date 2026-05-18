/**
 * Re-chunk every LibraryEntry through the new chunk pipeline:
 *   • Junk page / TOC / back-matter filtering (Adım 1)
 *   • Hyphen-break repair (Adım 2)
 *   • Heading detection + sectionTitle (Adım 3)
 *   • Semantic chunking (Adım 4)
 *   • Defensive junk chunk filter (Adım 5)
 *   • Contextual prefixes via Haiku (Adım 6)
 *
 * Tetikleme yolu — admin batch endpoint (scripts/reprocess-multilang
 * ile aynı pattern): /api/library/batch-reprocess.
 *
 * Bütün entries için, dil filtresi YOK. PDF olmayan / dosyası
 * eksik olanlar endpoint'te zaten skip ediliyor.
 *
 * Throttle: 20 entry/batch, batch'ler arası 90s. Backfill her bir
 * kitap için ~20-60s tutuyor (Haiku batched 8 paralel + embedding).
 *
 * Run (Railway container):
 *   railway ssh --service writer-agent-app \
 *     "cd /app && node scripts/rechunk-all.mjs"
 */

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
const APP_URL = process.env.NEXTAUTH_URL ?? "https://quilpen.com";
const ADMIN_SECRET = process.env.ADMIN_SESSION_SECRET ?? "";
const DRY = process.argv.includes("--dry");
const BATCH_SIZE = 20;
const PAUSE_MS = 90_000;

if (!DATABASE_URL) {
  console.error("DATABASE_URL not set — run via `railway ssh`/`railway run`");
  process.exit(1);
}
if (!DRY && !ADMIN_SECRET) {
  console.error("ADMIN_SESSION_SECRET not set in env.");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, {
  ssl: DATABASE_URL.includes("proxy.rlwy.net") ? "require" : false,
  max: 4,
});

async function main() {
  console.log("[rechunk-all] listing entries with file on disk…");
  const rows = await sql`
    SELECT id, title, "authorSurname"
    FROM "LibraryEntry"
    WHERE "filePath" IS NOT NULL OR EXISTS (
      SELECT 1 FROM "LibraryEntryVolume" v WHERE v."libraryEntryId" = "LibraryEntry".id AND v."filePath" IS NOT NULL
    )
    ORDER BY "createdAt" ASC
  `;
  console.log(`[rechunk-all] ${rows.length} entries eligible`);

  if (DRY) {
    for (const r of rows.slice(0, 30)) {
      console.log(`  ${r.id.slice(0, 12)} ${r.authorSurname ?? "—"} — ${r.title?.slice(0, 70)}`);
    }
    if (rows.length > 30) console.log(`  …and ${rows.length - 30} more`);
    await sql.end();
    return;
  }

  const ids = rows.map((r) => r.id);
  let triggered = 0;
  let skipped = 0;
  let notFound = 0;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const res = await fetch(`${APP_URL}/api/library/batch-reprocess`, {
      method: "POST",
      headers: {
        "x-admin-secret": ADMIN_SECRET,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ entryIds: batch }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.log(`  ✗ batch ${i}-${i + batch.length}: HTTP ${res.status} ${body.slice(0, 200)}`);
      continue;
    }
    const data = await res.json();
    triggered += data.triggered ?? 0;
    skipped += data.skipped?.length ?? 0;
    notFound += data.notFound ?? 0;
    console.log(
      `  ✓ batch ${Math.floor(i / BATCH_SIZE) + 1}: ` +
        `triggered ${data.triggered}, skipped ${data.skipped?.length ?? 0}, ` +
        `notFound ${data.notFound ?? 0}`,
    );
    if (data.skipped?.length > 0) {
      for (const s of data.skipped.slice(0, 5)) {
        console.log(`     skipped ${s.id}: ${s.reason}`);
      }
    }
    if (i + BATCH_SIZE < ids.length) {
      console.log(`  …pause ${Math.round(PAUSE_MS / 1000)}s before next batch`);
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Triggered: ${triggered}`);
  console.log(`Skipped:   ${skipped}`);
  console.log(`Not found: ${notFound}`);
  console.log(
    "\nBackground processing continues server-side. Monitor pdfStatus to " +
      "see ready vs failed counts; new chunks land with sectionTitle + " +
      "contextualPrefix populated.",
  );
  await sql.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
