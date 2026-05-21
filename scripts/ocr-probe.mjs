import fs from "node:fs";
const KEY = fs.readFileSync("/tmp/.gkey", "utf8").trim();
const TMP = "/tmp/ocrtest";
const PROMPT =
  "You are a precise OCR engine for classical Arabic books. Extract ALL text " +
  "from this scanned page exactly as printed, preserving reading order " +
  "(right-to-left) and paragraph breaks. Output ONLY the raw Arabic text. " +
  "Do NOT translate, transliterate, summarize, or comment. If the page has no " +
  "text, output nothing.";

// [model, $/1M in, $/1M out]
const MODELS = [
  ["gemini-2.5-flash", 0.30, 2.50],
  ["gemini-2.0-flash", 0.10, 0.40],
  ["gemini-2.5-flash-lite", 0.10, 0.40],
  ["gemini-2.0-flash-lite", 0.075, 0.30],
];

const files = fs.readdirSync(TMP).filter((f) => f.endsWith(".png")).sort();
const images = files.map((f) => fs.readFileSync(`${TMP}/${f}`).toString("base64"));
const TOTAL_PAGES = 48000;

async function ocr(model, b64) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT }, { inlineData: { mimeType: "image/png", data: b64 } }] }],
        generationConfig: { temperature: 0 },
      }),
    },
  );
  const j = await res.json();
  if (!res.ok) return { err: `HTTP ${res.status} ${JSON.stringify(j).slice(0, 160)}` };
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
  const u = j.usageMetadata ?? {};
  return { text, in: u.promptTokenCount ?? 0, out: u.candidatesTokenCount ?? 0 };
}

for (const [model, pin, pout] of MODELS) {
  let tin = 0, tout = 0, firstText = "", failed = false;
  for (let i = 0; i < images.length; i++) {
    const r = await ocr(model, images[i]);
    if (r.err) { console.log(`\n### ${model}: ${r.err}`); failed = true; break; }
    tin += r.in; tout += r.out;
    if (i === 0) firstText = r.text;
  }
  if (failed) continue;
  const cost = (tin / 1e6) * pin + (tout / 1e6) * pout;
  const perPage = cost / images.length;
  console.log(`\n========================================================`);
  console.log(`### ${model}`);
  console.log(`tokens ${images.length}pp: in=${tin} out=${tout} | cost $${cost.toFixed(4)} | per-page $${perPage.toFixed(5)} | 48k pages → $${(perPage * TOTAL_PAGES).toFixed(0)}`);
  console.log(`--- page-12 output (first 500 chars) ---`);
  console.log(firstText.slice(0, 500));
}
