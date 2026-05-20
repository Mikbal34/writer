/**
 * RAG evaluation harness (internal test tool — not user-facing).
 *
 * Fires a fixed question set at POST /api/library/eval, which runs
 * the real retrieval+answer path and a Haiku judge, then prints a
 * scorecard. Use it to measure whether a pipeline change actually
 * improved answer quality instead of guessing.
 *
 *   ADMIN_SESSION_SECRET=… APP_URL=https://quilpen.com \
 *     node scripts/rag-eval.mjs
 *
 * or via Railway (picks up env automatically):
 *   railway run --service writer-agent-app -- node scripts/rag-eval.mjs
 *
 * Cost: ~1 Sonnet answer + 1 Haiku judge per question. ~12
 * questions ≈ $0.30–0.50 per run. Delete this file + the
 * /api/library/eval endpoint once the measurement work is done.
 *
 * Editing the question set: each item is { q, expect } where
 * `expect` is a short note on what a correct answer should cover —
 * the judge scores the answer against it. Questions are drawn from
 * the actual corpus (kelâm, ritüel, hac, modernite). Swap freely
 * as the library grows.
 */

const APP_URL = process.env.APP_URL ?? "https://quilpen.com";
const SECRET = process.env.ADMIN_SESSION_SECRET ?? "";

if (!SECRET) {
  console.error(
    "ADMIN_SESSION_SECRET not set. Run with `railway run` or export it.",
  );
  process.exit(1);
}

const QUESTIONS = [
  {
    q: "Mâtürîdî ile Eş'arî arasındaki temel kelâmî farklar nelerdir?",
    expect:
      "İki Sünnî kelâm ekolünün akıl-vahiy dengesi, kesb/fiil teorisi, iman tanımı gibi noktalardaki farkları.",
  },
  {
    q: "Gazâlî filozofları hangi gerekçelerle tekfir eder?",
    expect:
      "Tehâfütü'l-felâsife'deki âlemin kıdemi, Tanrı'nın cüz'îleri bilmesi, cismani haşr gibi üç mesele.",
  },
  {
    q: "İbn Teymiyye akıl ile nakil çeliştiğinde nasıl bir çözüm önerir?",
    expect:
      "Der'ü tearuzi'l-akl ve'n-nakl'deki sahih akıl ile sahih naklin çelişmeyeceği tezi.",
  },
  {
    q: "Mary Douglas'a göre kirlilik (pollution) ve tabu neyi ifade eder?",
    expect:
      "Kirliliğin 'yerinde olmayan madde' olarak sembolik sınır ihlali; toplumsal düzen-kategori ilişkisi.",
  },
  {
    q: "Durkheim dinin toplumsal kökenini ve işlevini nasıl açıklar?",
    expect:
      "Dinin kutsal-profan ayrımı üzerinden toplumsal dayanışmayı üreten kolektif temsiller olduğu.",
  },
  {
    q: "Eliade'nin kutsal ve profan ayrımı nedir?",
    expect:
      "Kutsalın tezahürü (hierofani), kutsal mekân/zaman ile profan dünyanın niteliksel farkı.",
  },
  {
    q: "Hac ibadetinin sosyal ve politik boyutları üzerine kaynaklar ne söylüyor?",
    expect:
      "Haccın ümmet bilinci, siyasi otorite, kimlik ve küresel Müslüman hareketliliğiyle ilişkisi.",
  },
  {
    q: "Fazlur Rahman modernite ile İslami geleneğin uzlaşmasını nasıl ele alır?",
    expect:
      "İkili hareket (double movement) yöntemi, Kur'an'ın ahlaki ilkeleri ile tarihsel bağlam ayrımı.",
  },
  {
    q: "İbn Sînâ metafiziğinde Zorunlu Varlık (Vâcibü'l-vücûd) kavramı nedir?",
    expect:
      "Varlığı kendinden zorunlu olan, mahiyeti ile varlığı özdeş ilk ilke; mümkün varlıkların ona dayanması.",
  },
  {
    q: "Catherine Bell ritüel teorisinde 'ritualization' kavramını nasıl tanımlar?",
    expect:
      "Ritüelleştirmenin pratiği diğer eylemlerden ayıran stratejik, bedensel ve bağlamsal bir farklılaştırma oluşu.",
  },
  {
    q: "Hallaq'ın 'imkânsız devlet' (impossible state) tezi neyi savunur?",
    expect:
      "Modern ulus-devletin ahlaki yapısının klasik İslam yönetim/şeriat anlayışıyla bağdaşmadığı.",
  },
  {
    q: "Var olmayan bir konu: kuantum bilgisayarların kelâma etkisi nedir?",
    expect:
      "Korpusta bu konu YOK. Doğru cevap dürüstçe 'kaynaklarda yok' demeli, uydurmamalı.",
  },
];

async function evalOne(item) {
  const res = await fetch(`${APP_URL}/api/library/eval`, {
    method: "POST",
    headers: { "x-admin-secret": SECRET, "Content-Type": "application/json" },
    body: JSON.stringify({ question: item.q, expected: item.expect }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return { error: `HTTP ${res.status} ${t.slice(0, 120)}` };
  }
  return res.json();
}

function bar(n) {
  const v = Math.max(0, Math.min(10, Number(n) || 0));
  return "█".repeat(v) + "░".repeat(10 - v);
}

async function main() {
  console.log(`\nRAG eval — ${QUESTIONS.length} questions → ${APP_URL}\n`);
  const rows = [];
  for (let i = 0; i < QUESTIONS.length; i++) {
    const item = QUESTIONS[i];
    process.stdout.write(`[${i + 1}/${QUESTIONS.length}] ${item.q.slice(0, 55)}… `);
    try {
      const r = await evalOne(item);
      if (r.error) {
        console.log(`✗ ${r.error}`);
        rows.push({ q: item.q, overall: null, err: r.error });
        continue;
      }
      const j = r.judge ?? {};
      const cs = r.citationStats ?? {};
      console.log(
        `overall=${j.overall ?? "?"} (g${j.groundedness ?? "?"}/r${j.relevance ?? "?"}) ` +
          `cite:${cs.valid ?? 0}✓${cs.invalid ? `/${cs.invalid}✗` : ""} cov=${cs.coverage ?? 0}` +
          `${cs.insufficientSrc ? " [no-src]" : ""}`,
      );
      rows.push({
        q: item.q,
        overall: Number(j.overall),
        g: Number(j.groundedness),
        r: Number(j.relevance),
        reason: j.reason,
        src: r.retrievedCount,
        cite: cs,
      });
    } catch (err) {
      console.log(`✗ ${err.message}`);
      rows.push({ q: item.q, overall: null, err: err.message });
    }
  }

  // ── Scorecard ───────────────────────────────────────────────
  console.log("\n=== SCORECARD ===\n");
  const scored = rows.filter((r) => Number.isFinite(r.overall));
  for (const r of rows) {
    if (Number.isFinite(r.overall)) {
      console.log(`${bar(r.overall)} ${r.overall.toFixed(0).padStart(2)}  ${r.q.slice(0, 60)}`);
      if (r.overall < 6 && r.reason) console.log(`            ↳ ${r.reason}`);
    } else {
      console.log(`(error)      ${r.q.slice(0, 60)} — ${r.err}`);
    }
  }
  if (scored.length > 0) {
    const avg = (k) =>
      (scored.reduce((s, r) => s + (Number(r[k]) || 0), 0) / scored.length).toFixed(1);
    console.log("\n--- judge averages (noisy, LLM-scored) ---");
    console.log(`overall:      ${avg("overall")}/10`);
    console.log(`groundedness: ${avg("g")}/10`);
    console.log(`relevance:    ${avg("r")}/10`);
    console.log(`scored ${scored.length}/${rows.length}`);
  }

  // ── Deterministic citation metrics (the reliable ones) ──────
  // Exclude honest "not in sources" answers — they correctly carry
  // no citations, so including them would understate real citation
  // discipline on answerable questions.
  const cited = rows.filter(
    (r) => r.cite && !r.cite.insufficientSrc && Number.isFinite(r.overall),
  );
  if (cited.length > 0) {
    const withCite = cited.filter((r) => r.cite.hasCitations).length;
    const anyInvalid = cited.filter((r) => (r.cite.invalid || 0) > 0).length;
    const avgCov = (
      cited.reduce((s, r) => s + (r.cite.coverage || 0), 0) / cited.length
    ).toFixed(2);
    const avgValid = (
      cited.reduce((s, r) => s + (r.cite.valid || 0), 0) / cited.length
    ).toFixed(1);
    console.log("\n--- citations (deterministic, answerable Qs only) ---");
    console.log(`answerable questions:    ${cited.length}`);
    console.log(`with ≥1 valid citation:  ${withCite}/${cited.length} (${Math.round((withCite / cited.length) * 100)}%)`);
    console.log(`avg valid [n] per answer: ${avgValid}`);
    console.log(`avg coverage ([n]/sent):  ${avgCov}`);
    console.log(`answers w/ invalid [n]:   ${anyInvalid}/${cited.length}`);
    const noSrc = rows.filter((r) => r.cite && r.cite.insufficientSrc).length;
    if (noSrc) console.log(`("not in sources" excluded: ${noSrc})`);
  }
  console.log("");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
