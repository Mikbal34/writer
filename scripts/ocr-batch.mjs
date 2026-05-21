/**
 * One-time OCR batch for the scanned classical-Arabic corpus.
 *
 * For each work in the klasik source folder:
 *   1. POST the PDF to the Surya OCR service  → {pages:[{page_number,text}]}
 *   2. POST to /api/library/admin-ingest with the PDF file + ocrText (so the
 *      original scan is saved for the viewer, chunks come from clean OCR).
 * Multi-volume works (`_cNN`) become ONE entry with N volumes (first volume
 * creates the parent, rest attach). Serial + status-paced.
 *
 *   OCR_SERVICE_URL=https://<gpu-pod>/ocr   OCR_SERVICE_SECRET=… \
 *   APP_URL=https://quilpen.com  ADMIN_SESSION_SECRET=… \
 *   TARGET_USER_ID=cmn1ulqtk00030purt66j5ow6 \
 *     node scripts/ocr-batch.mjs [--dry] [--only=<substr>] [--cleanup-first]
 *
 *   --dry            print plan, OCR nothing
 *   --only=<substr>  restrict to works whose key contains <substr> (test one)
 *   --cleanup-first  delete the old no-file backlog (scope=nofile) before run
 *
 * Run this AFTER the Surya OCR service is up on a GPU (see ocr-service/README).
 */
import fs from "node:fs";
import path from "node:path";

const SRC_DIR = "/Users/ikbalkoc/Desktop/klasik_eserler/_TUMU_TOPLU_YUKLEME";
const OCR_URL = process.env.OCR_SERVICE_URL ?? "";
const OCR_SECRET = process.env.OCR_SERVICE_SECRET ?? "";
const APP_URL = process.env.APP_URL ?? "https://quilpen.com";
const ADMIN_SECRET = process.env.ADMIN_SESSION_SECRET ?? "";
const USER_ID = process.env.TARGET_USER_ID ?? "";
const DRY = process.argv.includes("--dry");
const CLEANUP = process.argv.includes("--cleanup-first");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").split("=")[1] ?? "";
const CONCURRENCY = Number(process.env.OCR_CONCURRENCY ?? 4);

if (!DRY && (!OCR_URL || !ADMIN_SECRET || !USER_ID)) {
  console.error("Set OCR_SERVICE_URL, ADMIN_SESSION_SECRET, TARGET_USER_ID");
  process.exit(1);
}

// These two are text-layer PDFs (not scanned) and already live in the
// library as file-backed entries — OCR'ing them would just create
// duplicates. Everything else in the folder is a scanned image.
const SKIP_TEXT_LAYER = [/Razi_LevamiulBeyyinat/i, /Razi_MetalibulAliye/i];

function buildPlan() {
  const works = new Map();
  for (const name of fs.readdirSync(SRC_DIR).sort()) {
    if (!/\.pdf$/i.test(name)) continue;
    if (/_baski[0-9]/i.test(name)) continue; // skip alternate editions
    if (SKIP_TEXT_LAYER.some((re) => re.test(name))) continue;
    const volMatch = name.match(/_c(\d+)/i);
    const vol = volMatch ? parseInt(volMatch[1], 10) : 1;
    const key = name.replace(/_c\d+/i, "").replace(/\.pdf$/i, "");
    if (ONLY && !key.toLowerCase().includes(ONLY.toLowerCase())) continue;
    const title = key
      .replace(/^(AR|EN|TR|FR)_/i, "")
      .replace(/_/g, " — ")
      .replace(/([a-z])([A-Z])/g, "$1 $2");
    if (!works.has(key)) works.set(key, { title, files: [] });
    works.get(key).files.push({ path: path.join(SRC_DIR, name), name, vol });
  }
  for (const w of works.values()) w.files.sort((a, b) => a.vol - b.vol);
  return works;
}

// Modal serves long requests via a 303 → poll-the-Location protocol: a
// request over ~150 s returns 303 with a __modal_function_call_id URL that
// answers 303 while pending and 200 when done. We must poll it manually
// (with a delay) — auto-following redirects would burn the redirect limit
// before the result is ready. Big tafsir volumes routinely exceed 150 s.
async function ocrFile(filePath, name) {
  const buf = fs.readFileSync(filePath);
  const fd = new FormData();
  fd.append("file", new Blob([buf]), name);
  const hdr = OCR_SECRET ? { "x-ocr-secret": OCR_SECRET } : {};
  let res = await fetch(OCR_URL, {
    method: "POST",
    headers: hdr,
    body: fd,
    redirect: "manual",
    signal: AbortSignal.timeout(30 * 60 * 1000),
  });
  for (let polls = 0; res.status === 303 || res.status === 302; polls++) {
    const loc = res.headers.get("location");
    if (!loc) break;
    if (polls > 1200) throw new Error("OCR poll timeout (>2.5h)");
    await new Promise((r) => setTimeout(r, 8000));
    res = await fetch(loc, {
      method: "GET",
      headers: hdr,
      redirect: "manual",
      signal: AbortSignal.timeout(30 * 60 * 1000),
    });
  }
  if (!res.ok) throw new Error(`OCR HTTP ${res.status} ${(await res.text()).slice(0, 150)}`);
  const { pages } = await res.json();
  return pages ?? [];
}

async function ingest({ filePath, name, title, mode, entryId, volumeNumber, pages }) {
  const buf = fs.readFileSync(filePath);
  const fd = new FormData();
  fd.append("file", new Blob([buf]), name);
  fd.append("userId", USER_ID);
  fd.append("title", title);
  fd.append("mode", mode);
  fd.append("ocrText", JSON.stringify(pages));
  if (entryId) fd.append("entryId", entryId);
  if (volumeNumber) fd.append("volumeNumber", String(volumeNumber));
  const res = await fetch(`${APP_URL}/api/library/admin-ingest`, {
    method: "POST",
    headers: { "x-admin-secret": ADMIN_SECRET },
    body: fd,
  });
  if (!res.ok) throw new Error(`ingest HTTP ${res.status} ${(await res.text()).slice(0, 150)}`);
  return res.json();
}

async function cleanupNoFile() {
  const res = await fetch(`${APP_URL}/api/library/cleanup-orphan`, {
    method: "POST",
    headers: { "x-admin-secret": ADMIN_SECRET, "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "nofile", userId: USER_ID }),
  });
  const j = await res.json();
  console.log(`cleanup nofile → deleted ${j.deletedCount ?? "?"}`);
}

async function main() {
  const works = buildPlan();
  const keys = [...works.keys()].sort();
  console.log(`\n${keys.length} works${ONLY ? ` [only: ${ONLY}]` : ""}\n`);
  if (DRY) {
    for (const k of keys) {
      const w = works.get(k);
      console.log(`${w.files.length === 1 ? "single" : `${w.files.length}-vol`} | ${w.title}`);
    }
    return;
  }
  if (CLEANUP) await cleanupNoFile();

  // One work at a time within itself (multi-volume must create the parent
  // before attaching ciltler), but CONCURRENCY works run in parallel — each
  // hits its own Modal GPU container. ~Nx faster, ~same total cost.
  async function processWork(w, tag) {
    if (w.files.length === 1) {
      const f = w.files[0];
      const pages = await ocrFile(f.path, f.name);
      const r = await ingest({ ...f, filePath: f.path, title: w.title, mode: "single", pages });
      console.log(`${tag} single (${pages.length}pp) → ${w.title}  ${r.entryId.slice(0, 8)}`);
    } else {
      let entryId = null;
      for (const f of w.files) {
        const pages = await ocrFile(f.path, f.name);
        const r = await ingest({
          filePath: f.path, name: f.name, title: w.title,
          mode: "volume", entryId, volumeNumber: f.vol, pages,
        });
        entryId = r.entryId;
        console.log(`${tag}   c${f.vol} (${pages.length}pp) → ${entryId.slice(0, 8)}`);
      }
      console.log(`${tag} ${w.files.length}-vol → ${w.title}`);
    }
  }

  let cursor = 0, ok = 0, fail = 0;
  async function worker() {
    while (cursor < keys.length) {
      const i = cursor++;
      const w = works.get(keys[i]);
      const tag = `[${i + 1}/${keys.length}]`;
      try {
        await processWork(w, tag);
        ok++;
      } catch (err) {
        console.log(`${tag} ✗ ${w.title} — ${err.message}`);
        fail++;
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`\nDONE: ${ok} ok, ${fail} failed`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
