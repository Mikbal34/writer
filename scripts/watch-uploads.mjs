// Live watcher for user UI uploads: emit a line when a new library entry
// appears or transitions to a terminal state. Each stdout line → a chat
// notification. Used while the user uploads from _YUKLENECEK.
import postgres from "postgres";

const USER = "cmn1ulqtk00030purt66j5ow6";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 2 });
const seen = new Map(); // id -> status
let first = true;

while (true) {
  try {
    const r = await sql`
      SELECT id, title, "pdfStatus" st, "fileType" ft,
        (SELECT COUNT(*)::int FROM "LibraryChunk" c WHERE c."libraryEntryId" = e.id) ch
      FROM "LibraryEntry" e
      WHERE "userId" = ${USER} AND "createdAt" > NOW() - INTERVAL '3 hours'
      ORDER BY "createdAt"`;
    for (const x of r) {
      const prev = seen.get(x.id);
      if (prev === x.st) continue;
      seen.set(x.id, x.st);
      if (first) continue; // don't dump pre-existing on startup
      const t = (x.title || "?").slice(0, 42);
      if (prev === undefined) console.log(`📥 YENİ: ${t} (${x.ft || "?"}) → ${x.st}`);
      else if (x.st === "ready") console.log(`✅ READY: ${t} — ${x.ch} chunk`);
      else if (x.st === "failed") console.log(`❌ FAILED: ${t}`);
      else if (x.st !== "none") console.log(`   ${t} → ${x.st}`);
    }
    // volumes (multi-volume uploads): emit terminal states
    const vols = await sql`
      SELECT vol.id, vol."volumeNumber" n, vol."pdfStatus" st, e.title,
        (SELECT COUNT(*)::int FROM "LibraryChunk" c WHERE c."volumeId" = vol.id AND c.embedding IS NOT NULL) emb
      FROM "LibraryEntryVolume" vol JOIN "LibraryEntry" e ON e.id = vol."libraryEntryId"
      WHERE e."userId" = ${USER} AND vol."createdAt" > NOW() - INTERVAL '3 hours'`;
    for (const v of vols) {
      const key = "v:" + v.id;
      if (seen.get(key) === v.st) continue;
      seen.set(key, v.st);
      if (first) continue;
      const t = (v.title || "?").slice(0, 34);
      if (v.st === "ready") console.log(`✅ CİLT ${v.n} READY: ${t} — ${v.emb} chunk`);
      else if (v.st === "failed") console.log(`❌ CİLT ${v.n} FAILED: ${t}`);
    }
    first = false;
  } catch {
    /* transient — keep polling */
  }
  await new Promise((s) => setTimeout(s, 15000));
}
