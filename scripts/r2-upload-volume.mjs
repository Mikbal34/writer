// Runs INSIDE the Railway container. Walks /data/library-pdfs/**/*.pdf and
// uploads each to Cloudflare R2 (S3 API) via hand-rolled SigV4 — zero deps
// (only node:crypto/https/fs), since the app image has no aws-sdk.
// Key = path relative to STORAGE_ROOT (e.g. <userId>/<entryId>.pdf), matching
// LibraryEntry.filePath after the /data/library-pdfs prefix is stripped.
// Idempotent/resumable: HEAD first, skip if object exists with same size.
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import crypto from "node:crypto";

const ROOT = process.env.STORAGE_ROOT || "/data/library-pdfs";
const ACCOUNT = process.env.R2_ACCOUNT;
const BUCKET = process.env.R2_BUCKET;
const AK = process.env.R2_AK;
const SK = process.env.R2_SK;
const HOST = `${ACCOUNT}.r2.cloudflarestorage.com`;
const REGION = "auto", SERVICE = "s3";

const sha256hex = (b) => crypto.createHash("sha256").update(b).digest("hex");
const hmac = (k, s) => crypto.createHmac("sha256", k).update(s).digest();

function signingKey(date) {
  let k = hmac("AWS4" + SK, date);
  k = hmac(k, REGION); k = hmac(k, SERVICE); k = hmac(k, "aws4_request");
  return k;
}

function encodeKey(key) {
  return key.split("/").map(encodeURIComponent).join("/");
}

function req(method, key, { bodyStream, contentLength } = {}) {
  return new Promise((resolve, reject) => {
    const now = new Date();
    const amzdate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const datestamp = amzdate.slice(0, 8);
    const payloadHash = "UNSIGNED-PAYLOAD";
    const canonicalUri = "/" + BUCKET + "/" + encodeKey(key);
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
    const canonicalHeaders =
      `host:${HOST}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzdate}\n`;
    const canonicalReq =
      `${method}\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
    const scope = `${datestamp}/${REGION}/${SERVICE}/aws4_request`;
    const strToSign =
      `AWS4-HMAC-SHA256\n${amzdate}\n${scope}\n${sha256hex(canonicalReq)}`;
    const sig = crypto.createHmac("sha256", signingKey(datestamp))
      .update(strToSign).digest("hex");
    const auth =
      `AWS4-HMAC-SHA256 Credential=${AK}/${scope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;
    const headers = {
      Host: HOST, "x-amz-date": amzdate, "x-amz-content-sha256": payloadHash,
      Authorization: auth,
    };
    if (contentLength != null) headers["Content-Length"] = contentLength;
    const r = https.request(
      { method, host: HOST, path: canonicalUri, headers },
      (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => resolve({ status: res.statusCode, body, headers: res.headers }));
      },
    );
    r.on("error", reject);
    if (bodyStream) bodyStream.pipe(r);
    else r.end();
  });
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile() && /\.(pdf|epub|docx)$/i.test(e.name)) out.push(p);
  }
  return out;
}

async function withRetry(fn, label, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === tries) throw e;
      console.log(`  retry ${i} (${label}): ${String(e.message || e).slice(0, 80)}`);
      await new Promise((s) => setTimeout(s, 1500 * i));
    }
  }
}

(async () => {
  let files = walk(ROOT);
  console.log(`Bulunan dosya: ${files.length}`);
  if (process.env.LIMIT) files = files.slice(0, Number(process.env.LIMIT));
  let up = 0, skip = 0, fail = 0, bytes = 0;
  for (const f of files) {
    const key = path.relative(ROOT, f);
    const size = fs.statSync(f).size;
    try {
      const head = await withRetry(() => req("HEAD", key), "head:" + key);
      if (head.status === 200 && Number(head.headers["content-length"]) === size) {
        skip++; continue;
      }
      const put = await withRetry(() =>
        req("PUT", key, { bodyStream: fs.createReadStream(f), contentLength: size }), "put:" + key);
      if (put.status === 200) { up++; bytes += size; }
      else { fail++; console.log(`  ✗ ${key}: HTTP ${put.status} ${put.body.slice(0, 120)}`); }
      if ((up + skip) % 25 === 0) console.log(`  ${up + skip}/${files.length} (yeni ${up}, atla ${skip})`);
    } catch (e) {
      fail++; console.log(`  ✗ ${key}: ${String(e.message || e).slice(0, 120)}`);
    }
  }
  console.log(`BİTTİ. yeni=${up} atla=${skip} hata=${fail} | yüklenen ~${(bytes / 1048576).toFixed(0)}MB`);
})();
