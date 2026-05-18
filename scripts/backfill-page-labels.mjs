/**
 * Backfill LibraryChunk.pdfPageLabel for every chunk that pre-dates
 * the page-label pipeline (i.e. all of them at the moment this lands).
 *
 * Approach: group chunks by (libraryEntryId, volumeId), open each PDF
 * exactly once via pdfjs-dist's getDocument, pull
 * doc.getPageLabels(), and UPDATE every chunk in the group with the
 * matching label for its pageNumber.
 *
 * Skips groups whose PDF:
 *   - has no filePath on disk (rare),
 *   - cannot be opened by pdfjs (corrupt / OCR-only),
 *   - has no /PageLabels entry at all (we leave pdfPageLabel NULL and
 *     the UI falls back to pageNumber, same as today),
 *   - has only identity labels ("1","2","3",…) that match the PDF
 *     index — nothing useful to record.
 *
 * Designed to run on the Railway container so /data/library-pdfs/...
 * is reachable:
 *
 *     railway run --service writer-agent-app node scripts/backfill-page-labels.mjs
 *
 * Idempotent: only fills rows where pdfPageLabel IS NULL.
 */

import postgres from "postgres";
import fs from "node:fs/promises";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error(
    "DATABASE_URL not set — run via `railway run` so the service env is injected",
  );
  process.exit(1);
}

const sql = postgres(DATABASE_URL, {
  ssl: DATABASE_URL.includes("proxy.rlwy.net") ? "require" : false,
  max: 4,
});

async function main() {
  console.log("[backfill] Fetching groups…");
  // (entryId, volumeId) is the granularity of one physical PDF on
  // disk. Coalesce the file path: volumes hold theirs on
  // LibraryEntryVolume.filePath; single-PDF entries hold theirs on
  // LibraryEntry.filePath.
  const groups = await sql`
    SELECT
      lc."libraryEntryId"        AS entry_id,
      lc."volumeId"              AS volume_id,
      COALESCE(lv."filePath", le."filePath") AS file_path,
      COUNT(*)::int              AS chunk_count
    FROM "LibraryChunk" lc
    JOIN "LibraryEntry" le ON le.id = lc."libraryEntryId"
    LEFT JOIN "LibraryEntryVolume" lv ON lv.id = lc."volumeId"
    WHERE lc."pdfPageLabel" IS NULL
    GROUP BY lc."libraryEntryId", lc."volumeId", lv."filePath", le."filePath"
    ORDER BY chunk_count DESC
  `;
  console.log(`[backfill] ${groups.length} (entry, volume) groups to process`);

  let processed = 0;
  let skippedNoFile = 0;
  let skippedPdfjs = 0;
  let skippedNoLabels = 0;
  let skippedIdentity = 0;
  let chunksUpdated = 0;
  const failures = [];

  for (const g of groups) {
    processed++;
    const tag = `[${processed}/${groups.length}]`;

    if (!g.file_path) {
      skippedNoFile++;
      console.log(`${tag} entry=${g.entry_id.slice(0, 12)} vol=${(g.volume_id ?? "-").slice(0, 12)}: no filePath`);
      continue;
    }

    let buf;
    try {
      buf = await fs.readFile(g.file_path);
    } catch (err) {
      skippedNoFile++;
      console.log(`${tag} ${g.file_path}: cannot read (${err.code ?? err.message})`);
      continue;
    }

    let labels;
    let doc;
    try {
      const loadingTask = pdfjs.getDocument({
        data: new Uint8Array(buf),
        useWorkerFetch: false,
        isEvalSupported: false,
        useSystemFonts: false,
        disableFontFace: true,
      });
      doc = await loadingTask.promise;
      labels = await doc.getPageLabels();
    } catch (err) {
      skippedPdfjs++;
      failures.push({ path: g.file_path, error: err.message });
      console.log(`${tag} ${g.file_path}: pdfjs failed (${err.message})`);
      try {
        await doc?.destroy();
      } catch {
        /* ignore */
      }
      continue;
    }

    try {
      await doc.destroy();
    } catch {
      /* ignore */
    }

    if (!Array.isArray(labels) || labels.length === 0) {
      skippedNoLabels++;
      console.log(`${tag} ${g.file_path}: no /PageLabels in PDF (${g.chunk_count} chunks stay null)`);
      continue;
    }

    // Build the (page, label) pairs that are actually different from
    // the identity ("page 5 has label 5") — those are noise.
    const pages = [];
    const labelVals = [];
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      if (typeof label !== "string" || label.length === 0) continue;
      if (label === String(i + 1)) continue;
      pages.push(i + 1);
      labelVals.push(label);
    }

    if (pages.length === 0) {
      skippedIdentity++;
      console.log(`${tag} ${g.file_path}: labels match PDF index — nothing to record`);
      continue;
    }

    const result = g.volume_id
      ? await sql`
          UPDATE "LibraryChunk" lc
          SET "pdfPageLabel" = u.label
          FROM unnest(${pages}::int[], ${labelVals}::text[]) AS u(page, label)
          WHERE lc."libraryEntryId" = ${g.entry_id}
            AND lc."volumeId"       = ${g.volume_id}
            AND lc."pageNumber"     = u.page
            AND lc."pdfPageLabel"   IS NULL
        `
      : await sql`
          UPDATE "LibraryChunk" lc
          SET "pdfPageLabel" = u.label
          FROM unnest(${pages}::int[], ${labelVals}::text[]) AS u(page, label)
          WHERE lc."libraryEntryId" = ${g.entry_id}
            AND lc."volumeId"       IS NULL
            AND lc."pageNumber"     = u.page
            AND lc."pdfPageLabel"   IS NULL
        `;
    chunksUpdated += result.count;
    console.log(`${tag} ${g.file_path}: ${pages.length} labels → ${result.count}/${g.chunk_count} chunks updated`);
  }

  console.log("\n=== Backfill summary ===");
  console.log(`Groups processed:           ${processed}`);
  console.log(`Skipped (no file on disk):  ${skippedNoFile}`);
  console.log(`Skipped (pdfjs error):      ${skippedPdfjs}`);
  console.log(`Skipped (no PageLabels):    ${skippedNoLabels}`);
  console.log(`Skipped (identity labels):  ${skippedIdentity}`);
  console.log(`Chunks updated:             ${chunksUpdated}`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures.slice(0, 20)) {
      console.log(`  - ${f.path}: ${f.error}`);
    }
    if (failures.length > 20) console.log(`  …and ${failures.length - 20} more`);
  }

  await sql.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
