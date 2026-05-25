/**
 * Bulk re-upload local source PDFs into the library via the
 * admin-ingest endpoint. Walks the two Desktop _TUMU_TOPLU_YUKLEME
 * folders, groups multi-volume works (filename `_cNN`) into a single
 * entry, and uploads serially — polling each work's pdfStatus before
 * moving on so we never flood the pipeline (the rebuild taught us
 * that lesson).
 *
 *   ADMIN_SESSION_SECRET=… APP_URL=https://quilpen.com \
 *   TARGET_USER_ID=cmn1ulqtk00030purt66j5ow6 \
 *     node scripts/upload-sources.mjs [--dry] [--only=<substr>] [--folder=klasik|tez]
 *
 *   --dry           print the upload plan, don't upload
 *   --only=<substr> only works whose key contains <substr> (test one)
 *   --folder=...    restrict to one source folder
 *
 * Delete this script + the admin-ingest/cleanup endpoints once the
 * backlog is uploaded.
 */
import fs from "node:fs";
import path from "node:path";

const APP_URL = process.env.APP_URL ?? "https://quilpen.com";
const SECRET = process.env.ADMIN_SESSION_SECRET ?? "";
const USER_ID = process.env.TARGET_USER_ID ?? "";
const DRY = process.argv.includes("--dry");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").split("=")[1] ?? "";
const FOLDER_ARG = (process.argv.find((a) => a.startsWith("--folder=")) ?? "").split("=")[1] ?? "";

if (!SECRET || !USER_ID) {
  console.error("Set ADMIN_SESSION_SECRET and TARGET_USER_ID");
  process.exit(1);
}

const FOLDERS = [
  { tag: "tez", dir: "/Users/ikbalkoc/Desktop/tez_kaynaklar_pdf/_TUMU_TOPLU_YUKLEME" },
  { tag: "klasik", dir: "/Users/ikbalkoc/Desktop/klasik_eserler/_TUMU_TOPLU_YUKLEME" },
].filter((f) => !FOLDER_ARG || f.tag === FOLDER_ARG);

// Build the work plan: group files by work key, detect volume number.
function buildPlan() {
  const works = new Map(); // key → { title, files: [{path, name, vol}] }
  for (const { dir } of FOLDERS) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).sort()) {
      if (!/\.(pdf|epub|docx)$/i.test(name)) continue;
      if (/_baski[0-9]/i.test(name)) continue; // skip alternate editions
      // key = filename minus volume marker + ext; vol from _cNN
      const volMatch = name.match(/_c(\d+)/i);
      const vol = volMatch ? parseInt(volMatch[1], 10) : null;
      const key = name
        .replace(/_c\d+/i, "")
        .replace(/\.(pdf|epub|docx)$/i, "");
      if (ONLY && !key.toLowerCase().includes(ONLY.toLowerCase())) continue;
      // human title: strip LANG_ prefix, split CamelCase, spaces
      const title = key
        .replace(/^(AR|EN|TR|FR)_/i, "")
        .replace(/_/g, " — ")
        .replace(/([a-z])([A-Z])/g, "$1 $2");
      if (!works.has(key)) works.set(key, { title, files: [] });
      works.get(key).files.push({ path: path.join(dir, name), name, vol: vol ?? 1 });
    }
  }
  // sort each work's files by volume
  for (const w of works.values()) w.files.sort((a, b) => a.vol - b.vol);
  return works;
}

async function ingest({ filePath, name, title, mode, entryId, volumeNumber }) {
  const buf = fs.readFileSync(filePath);
  const fd = new FormData();
  fd.append("file", new Blob([buf]), name);
  fd.append("userId", USER_ID);
  fd.append("title", title);
  fd.append("mode", mode);
  if (entryId) fd.append("entryId", entryId);
  if (volumeNumber) fd.append("volumeNumber", String(volumeNumber));
  const res = await fetch(`${APP_URL}/api/library/admin-ingest`, {
    method: "POST",
    headers: { "x-admin-secret": SECRET },
    body: fd,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
  return res.json();
}

async function pollReady(entryId, label) {
  // Poll the diag-free way: hit pdf-status-ish via chunk-diag is heavy;
  // instead just wait a fixed budget scaled to file count. Simpler:
  // poll entry status through the admin reembed GET? No — use a short
  // sleep loop on chunk-diag's recentEntries is overkill. We pace by
  // sleeping; the pipeline runs server-side regardless.
  const start = Date.now();
  const TIMEOUT = 20 * 60 * 1000;
  while (Date.now() - start < TIMEOUT) {
    const r = await fetch(`${APP_URL}/api/library/chunk-diag`, {
      headers: { "x-admin-secret": SECRET },
    }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    const e = r?.recentEntries?.find((x) => x.title && label.includes(x.title.slice(0, 20)));
    const st = e?.pdfStatus;
    if (st === "ready" || st === "failed") return st;
    await new Promise((s) => setTimeout(s, 10000));
  }
  return "timeout";
}

async function main() {
  const works = buildPlan();
  const keys = [...works.keys()].sort();
  console.log(`\n${keys.length} works to upload (${FOLDERS.map((f) => f.tag).join("+")})${ONLY ? ` [only: ${ONLY}]` : ""}\n`);
  if (DRY) {
    for (const k of keys) {
      const w = works.get(k);
      console.log(`${w.files.length === 1 ? "single" : `${w.files.length}-vol`} | ${w.title}`);
    }
    return;
  }
  let ok = 0, fail = 0;
  for (let i = 0; i < keys.length; i++) {
    const w = works.get(keys[i]);
    const tag = `[${i + 1}/${keys.length}]`;
    try {
      if (w.files.length === 1) {
        const r = await ingest({ filePath: w.files[0].path, name: w.files[0].name, title: w.title, mode: "single" });
        console.log(`${tag} single  → ${w.title}  (entry ${r.entryId.slice(0, 8)})`);
      } else {
        let entryId = null;
        for (const f of w.files) {
          const r = await ingest({ filePath: f.path, name: f.name, title: w.title, mode: "volume", entryId, volumeNumber: f.vol });
          entryId = r.entryId;
        }
        console.log(`${tag} ${w.files.length}-vol → ${w.title}  (entry ${entryId.slice(0, 8)})`);
      }
      // Pace: wait for this work to settle before the next.
      const st = await pollReady(w.files[0].name, w.title.slice(0, 20));
      console.log(`        ↳ ${st}`);
      ok++;
    } catch (err) {
      console.log(`${tag} ✗ ${w.title} — ${err.message}`);
      fail++;
    }
  }
  console.log(`\nDONE: ${ok} ok, ${fail} failed`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
