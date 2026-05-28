/**
 * Writing endpoint eval runner.
 *
 * - WRITING_EVAL_TEST projesinin 5 subsection'ını çeker.
 * - Her birine POST /api/projects/[id]/write/[subId]/generate (eval-mode) atar.
 * - Response: { fullText, context: {citationCheck, review}, latencyMs }.
 * - Aggregate: avg citation valid rate, avg review score, fabricated bibIds.
 *
 * Çalıştırma:
 *   TARGET=https://quilpen.app npx tsx scripts/eval/run-writing-eval.ts
 *
 * EVAL_TOKEN ve USER_ID env'dan değil hardcoded — bu test data'sına özel.
 */
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const TARGET = process.env.TARGET ?? "https://quilpen.app";
const EVAL_TOKEN = "bc72cf52b43fd7427b0da026c03f51ccb623ca41e8a920b9";
const USER_ID = "cmn1ulqtk00030purt66j5ow6"; // beratok2312
const SSH = "ssh -i ~/.ssh/quilpen.pem azureuser@4.180.10.105";
const PSQL = "sudo docker exec quilpen-postgres-1 psql -U quilpen -d quilpen";

interface Subsection {
  id: string;
  subsectionId: string;
  title: string;
  bibCount: number;
}

interface EvalResult {
  subsection: Subsection;
  status: "ok" | "error";
  fullText: string;
  wordCount: number;
  latencyMs: number;
  citation?: {
    total: number;
    valid: number;
    fabricated: string[];
    fabricatedRate: number;
    footnotes: number;
  };
  review?: {
    score: number;
    unsupportedClaims: string[];
    fabricatedCitations: string[];
    missingObjective: boolean;
    coherent: boolean;
    regenerate: boolean;
  };
  allowedBibIds: string[];
  error?: string;
}

async function loadSubsections(projectId: string): Promise<Subsection[]> {
  const sql = `SELECT sub.id || '|' || sub."subsectionId" || '|' || REPLACE(sub.title, '|', '/') || '|' || COUNT(sm.id) FROM "Subsection" sub JOIN "Section" s ON sub."sectionId"=s.id JOIN "Chapter" c ON s."chapterId"=c.id LEFT JOIN "SourceMapping" sm ON sm."subsectionId"=sub.id WHERE c."projectId"='${projectId}' GROUP BY sub.id, sub."subsectionId", sub.title, sub."sortOrder" ORDER BY sub."sortOrder";`;
  const cmd = `${SSH} "${PSQL} -t -A -c \\"${sql}\\""`;
  const raw = execSync(cmd, { encoding: "utf-8" }).trim();
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [id, subsectionId, title, bibCount] = line.split("|");
      return { id, subsectionId, title, bibCount: parseInt(bibCount, 10) };
    });
}

async function runSubsection(projectId: string, sub: Subsection): Promise<EvalResult> {
  const url = `${TARGET}/api/projects/${projectId}/write/${sub.id}/generate`;
  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Eval-Token": EVAL_TOKEN,
        "X-Eval-User-Id": USER_ID,
      },
      body: JSON.stringify({ mode: "fresh" }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return {
        subsection: sub,
        status: "error",
        fullText: "",
        wordCount: 0,
        latencyMs: Date.now() - startedAt,
        allowedBibIds: [],
        error: `HTTP ${res.status}: ${errText.slice(0, 200)}`,
      };
    }
    const json = (await res.json()) as {
      sessionId: string;
      fullText: string;
      wordCount: number;
      latencyMs: number;
      ragChunksCount: number;
      allowedBibIds: string[];
      context: { citationCheck?: unknown; review?: unknown } | null;
    };
    const ctx = (json.context ?? {}) as Record<string, unknown>;
    const citation = ctx.citationCheck as EvalResult["citation"];
    const review = ctx.review as EvalResult["review"];
    return {
      subsection: sub,
      status: "ok",
      fullText: json.fullText,
      wordCount: json.wordCount,
      latencyMs: json.latencyMs,
      citation,
      review,
      allowedBibIds: json.allowedBibIds,
    };
  } catch (err) {
    return {
      subsection: sub,
      status: "error",
      fullText: "",
      wordCount: 0,
      latencyMs: Date.now() - startedAt,
      allowedBibIds: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function fmtPct(n: number | undefined): string {
  if (n === undefined || isNaN(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function fmtScore(n: number | undefined): string {
  if (n === undefined || isNaN(n)) return "—";
  return n.toFixed(2);
}

async function main() {
  const projectId = readFileSync(
    "scripts/eval/writing-test-project-id.txt",
    "utf-8",
  ).trim();
  console.log(`▶ Writing Eval — proje: ${projectId}\n`);

  const subs = await loadSubsections(projectId);
  console.log(`◇ Subsection: ${subs.length}`);
  subs.forEach((s) => console.log(`  ${s.subsectionId} (${s.bibCount} kitap): ${s.title}`));
  console.log();

  const results: EvalResult[] = [];
  for (const sub of subs) {
    process.stdout.write(`◇ Çalışıyor: ${sub.subsectionId} ${sub.title}... `);
    const r = await runSubsection(projectId, sub);
    results.push(r);
    if (r.status === "ok") {
      const cit = r.citation
        ? `cite_valid=${fmtPct(r.citation.valid / Math.max(1, r.citation.total))} fabricated=${r.citation.fabricated.length}`
        : "no-cite-meta";
      const rev = r.review ? `review=${fmtScore(r.review.score)}` : "no-review";
      console.log(`✓ ${r.wordCount}w, ${(r.latencyMs / 1000).toFixed(1)}s, ${cit}, ${rev}`);
    } else {
      console.log(`✗ ${r.error}`);
    }
  }

  // Aggregate
  const ok = results.filter((r) => r.status === "ok");
  const avgLatency = ok.reduce((s, r) => s + r.latencyMs, 0) / Math.max(1, ok.length);
  const avgWords = ok.reduce((s, r) => s + r.wordCount, 0) / Math.max(1, ok.length);
  const totalCitations = ok.reduce((s, r) => s + (r.citation?.total ?? 0), 0);
  const validCitations = ok.reduce((s, r) => s + (r.citation?.valid ?? 0), 0);
  const totalFabricated = ok.reduce((s, r) => s + (r.citation?.fabricated.length ?? 0), 0);
  const reviewScores = ok.map((r) => r.review?.score).filter((x): x is number => typeof x === "number");
  const avgReview = reviewScores.reduce((s, x) => s + x, 0) / Math.max(1, reviewScores.length);
  const regenCount = ok.filter((r) => r.review?.regenerate).length;

  console.log("\n=== ÖZET ===");
  console.log(`OK: ${ok.length}/${results.length}`);
  console.log(`Avg latency: ${(avgLatency / 1000).toFixed(1)}s`);
  console.log(`Avg word count: ${avgWords.toFixed(0)}`);
  console.log(`Citations: ${validCitations}/${totalCitations} valid (${fmtPct(totalCitations > 0 ? validCitations / totalCitations : 0)}), ${totalFabricated} fabricated`);
  console.log(`Avg reviewer score: ${fmtScore(avgReview)} (regenerate flag: ${regenCount}/${ok.length})`);

  // Persist
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = "scripts/eval/results";
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const jsonPath = `${dir}/writing-eval-${ts}.json`;
  writeFileSync(jsonPath, JSON.stringify({ projectId, results, summary: { avgLatency, avgWords, validCitations, totalCitations, totalFabricated, avgReview, regenCount } }, null, 2));

  // Markdown report
  const mdLines: string[] = [
    `# Writing Eval — ${ts}`,
    "",
    `**Proje**: \`${projectId}\``,
    `**OK**: ${ok.length}/${results.length}`,
    `**Avg latency**: ${(avgLatency / 1000).toFixed(1)}s`,
    `**Avg word count**: ${avgWords.toFixed(0)}`,
    `**Citation accuracy**: ${validCitations}/${totalCitations} (${fmtPct(totalCitations > 0 ? validCitations / totalCitations : 0)})`,
    `**Fabricated citations**: ${totalFabricated}`,
    `**Avg reviewer score**: ${fmtScore(avgReview)}`,
    `**Regenerate flag**: ${regenCount}/${ok.length}`,
    "",
    "## Per-Subsection",
    "",
    "| Subsection | Type | Books | Words | Latency | Cite valid | Fabric. | Review | Coherent | Obj? |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const r of results) {
    const cite = r.citation
      ? `${r.citation.valid}/${r.citation.total} (${fmtPct(r.citation.total > 0 ? r.citation.valid / r.citation.total : 0)})`
      : "—";
    const fab = r.citation ? `${r.citation.fabricated.length}` : "—";
    const rev = r.review ? fmtScore(r.review.score) : "—";
    const coh = r.review ? (r.review.coherent ? "✓" : "✗") : "—";
    const obj = r.review ? (r.review.missingObjective ? "✗" : "✓") : "—";
    mdLines.push(
      `| ${r.subsection.subsectionId} ${r.subsection.title.slice(0, 30)} | (${r.subsection.bibCount}) | ${r.wordCount} | ${(r.latencyMs / 1000).toFixed(1)}s | ${cite} | ${fab} | ${rev} | ${coh} | ${obj} |`,
    );
  }

  mdLines.push("");
  mdLines.push("## Full Outputs");
  for (const r of results) {
    mdLines.push("");
    mdLines.push(`### ${r.subsection.subsectionId} — ${r.subsection.title}`);
    if (r.error) {
      mdLines.push("");
      mdLines.push(`**ERROR**: ${r.error}`);
      continue;
    }
    if (r.review) {
      mdLines.push("");
      mdLines.push(`**Review** — score: ${r.review.score.toFixed(2)} | coherent: ${r.review.coherent} | missing obj: ${r.review.missingObjective}`);
      if (r.review.unsupportedClaims.length > 0) {
        mdLines.push(`- Unsupported claims:`);
        r.review.unsupportedClaims.forEach((c) => mdLines.push(`  - ${c}`));
      }
      if (r.review.fabricatedCitations.length > 0) {
        mdLines.push(`- Fabricated: ${r.review.fabricatedCitations.join(", ")}`);
      }
    }
    if (r.citation && r.citation.fabricated.length > 0) {
      mdLines.push("");
      mdLines.push(`**Fabricated bibIds**: ${r.citation.fabricated.join(", ")}`);
    }
    mdLines.push("");
    mdLines.push("```");
    mdLines.push(r.fullText.slice(0, 2000) + (r.fullText.length > 2000 ? "\n…(truncated)" : ""));
    mdLines.push("```");
  }

  const mdPath = `${dir}/writing-eval-${ts}.md`;
  writeFileSync(mdPath, mdLines.join("\n"));
  console.log(`\n✓ Saved: ${jsonPath}`);
  console.log(`✓ Saved: ${mdPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
