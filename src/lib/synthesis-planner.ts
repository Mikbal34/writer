/**
 * Synthesis Planner — pipeline'ın Evidence ile Write arasına gömülü
 * "düşünme" katmanı.
 *
 * Yazı eval'ı net bir tavan gösterdi: sistem kaynakları doğru çekiyor,
 * doğru citation üretiyor, akademik üslubu tutuyor — ama metinler
 * "Mâtürîdî diyor ki, Rudolph diyor ki" şeklinde **kaynak aktarımı**
 * seviyesinde kalıyor. Akademisyen olunan farkı şu: anlaşma/çatışma/
 * gerilim/sonuç bağlarını **kaynaklar arasında** kuruyor.
 *
 * Pipeline'da yeri:
 *   Roadmap → Retrieval → Evidence → SYNTHESIS PLANNER → Write
 *
 * Mod'a göre çıktı şeması farklı:
 *   THEMATIC    → { schools, common_points, divergences, historical_shift }
 *   COMPARATIVE → { topic, sideA, sideB, difference, significance }
 *   SPECIFIC    → planner çalıştırılmaz; Writer ham chunks görür
 *
 * Writer prompt mod'a göre koşullu blok ekler; ham source listesi
 * yerine bu yapısal evidence'i girdi alır.
 *
 * Maliyet: 1 Haiku call/subsection (~$0.001). Latency +2-3s.
 */
import { generateJSONWithUsage, HAIKU } from "@/lib/claude";

export type SynthesisMode = "SPECIFIC" | "THEMATIC" | "COMPARATIVE";

export interface PlannerInput {
  subsectionTitle: string;
  subsectionObjective: string; // description + keyPoints birleşmiş
  mode: SynthesisMode;
  /** Retrieve'dan gelen chunks — bibId + page metadata ile */
  chunks: Array<{
    bibId: string;
    sourceTitle: string;
    authorSurname?: string;
    page: string | null;
    content: string;
  }>;
}

export interface ThematicPlan {
  schools: Array<{
    name: string;
    position: string;
    representative_bibIds: string[];
  }>;
  common_points: Array<{ point: string; supporting_bibIds: string[] }>;
  divergences: Array<{
    issue: string;
    positions: Array<{ school: string; stance: string; bibId: string }>;
  }>;
  historical_shift: string; // tek paragraf — kronolojik dönüşüm varsa
}

export interface ComparativePlan {
  topic: string;
  sideA: { label: string; position: string; supporting_bibIds: string[] };
  sideB: { label: string; position: string; supporting_bibIds: string[] };
  convergences: Array<{ point: string; supporting_bibIds: string[] }>;
  difference: string; // analitik ana ayrım
  significance: string; // "buradan çıkan sonuç"
}

export type PlannerResult =
  | { mode: "THEMATIC"; plan: ThematicPlan; failed?: false }
  | { mode: "COMPARATIVE"; plan: ComparativePlan; failed?: false }
  | { mode: SynthesisMode; plan: null; failed: true; reason: string };

const THEMATIC_SYSTEM = `You are an academic synthesis planner. You are given a subsection
objective and retrieved chunks from N (4+) sources. Your job is NOT to
summarize sources individually. Your job is to map the INTELLECTUAL
TOPOGRAPHY of the field — what positions exist, where they converge,
where they diverge, what shifted over time.

Output rules:
1. Use ONLY bibIds that appear in the chunks. Never invent.
2. Quote 1-2 line position statements in the source's own
   conceptual vocabulary — but synthesised, not copy-pasted.
3. Each common_point + each divergence MUST list which bibIds support it.
4. historical_shift: a single paragraph (max 60 words) if the chunks
   show a chronological evolution (mütekaddimûn→müteahhirûn, classical→
   modern, vs.). Empty string if no clear shift.
5. Max 5 schools, max 4 common points, max 4 divergences.

Output ONLY JSON:
{
  "schools": [{ "name": "...", "position": "...", "representative_bibIds": ["..."] }],
  "common_points": [{ "point": "...", "supporting_bibIds": ["..."] }],
  "divergences": [{ "issue": "...", "positions": [{ "school": "...", "stance": "...", "bibId": "..." }] }],
  "historical_shift": "..."
}`;

const COMPARATIVE_SYSTEM = `You are an academic synthesis planner for a COMPARATIVE subsection
(X vs Y). You receive a subsection objective and retrieved chunks. Your
job: extract the structural comparison — not summarize each side
separately, but build the contrast that drives the subsection.

Output rules:
1. Use ONLY bibIds that appear in the chunks. Never invent.
2. sideA / sideB: name the position FIRST (label = "Mâtürîdî", "Wolfson"
   etc.), then the position in its OWN terms with supporting bibIds.
3. convergences: where the two sides agree (often more than one expects).
   Empty array if none in chunks.
4. difference: 1 analytic paragraph (max 50 words) on the CORE divergence.
   Not "they disagree about X" — but WHY and on WHAT axis.
5. significance: 1 paragraph (max 40 words) — what follows from this
   divergence for the subsection's broader argument.

Output ONLY JSON:
{
  "topic": "...",
  "sideA": { "label": "...", "position": "...", "supporting_bibIds": ["..."] },
  "sideB": { "label": "...", "position": "...", "supporting_bibIds": ["..."] },
  "convergences": [{ "point": "...", "supporting_bibIds": ["..."] }],
  "difference": "...",
  "significance": "..."
}`;

function buildChunkBlock(chunks: PlannerInput["chunks"]): string {
  return chunks
    .map((c, i) => {
      const author = c.authorSurname ? ` (${c.authorSurname})` : "";
      const page = c.page ? ` p.${c.page}` : "";
      const preview = c.content.length > 500 ? c.content.slice(0, 500) + "…" : c.content;
      return `[${i + 1}] bibId=${c.bibId}${page}${author} — "${c.sourceTitle}"\n${preview}`;
    })
    .join("\n\n");
}

export async function buildSynthesisPlan(input: PlannerInput): Promise<PlannerResult> {
  if (input.mode === "SPECIFIC" || input.chunks.length === 0) {
    return { mode: input.mode, plan: null, failed: true, reason: "SPECIFIC or empty chunks" };
  }
  const system = input.mode === "COMPARATIVE" ? COMPARATIVE_SYSTEM : THEMATIC_SYSTEM;
  const userPrompt =
    `SUBSECTION TITLE: ${input.subsectionTitle}\n\n` +
    `SUBSECTION OBJECTIVE:\n${input.subsectionObjective}\n\n` +
    `RETRIEVED CHUNKS:\n${buildChunkBlock(input.chunks)}\n\n` +
    `Return the synthesis plan as JSON.`;
  try {
    const res = await generateJSONWithUsage<ThematicPlan | ComparativePlan>(
      userPrompt,
      system,
      { model: HAIKU },
    );
    if (!res.data) {
      return { mode: input.mode, plan: null, failed: true, reason: "empty response" };
    }
    if (input.mode === "THEMATIC") {
      return { mode: "THEMATIC", plan: res.data as ThematicPlan };
    }
    return { mode: "COMPARATIVE", plan: res.data as ComparativePlan };
  } catch (err) {
    return {
      mode: input.mode,
      plan: null,
      failed: true,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Plan'i Sonnet prompt'una giden Markdown block'a dönüştür.
 * Ham chunks yerine Writer bu yapısal sentezi görür; "ne düşüneceğini"
 * baştan biliyor, kaynaklara "ne dediler" diye değil "tartışmayı nasıl
 * kurarım" diye bakıyor.
 */
export function formatPlanForPrompt(result: PlannerResult): string {
  if (result.failed || !result.plan) return "";
  const lines: string[] = ["## SYNTHESIS PLAN (use this as your argumentative skeleton)"];
  lines.push("");
  lines.push(
    `This is NOT a list of sources. This is a pre-built map of the intellectual conversation. ` +
      `Build your paragraphs around the CONVERSATION (positions, agreements, divergences, shifts), ` +
      `not around individual sources. Cite the listed bibIds with \`[cite:bibId,p=X]\` markers.`,
  );
  lines.push("");

  if (result.mode === "THEMATIC") {
    const p = result.plan as ThematicPlan;
    lines.push("### Positions in the field");
    p.schools.forEach((s, i) => {
      lines.push(`${i + 1}. **${s.name}** — ${s.position}`);
      if (s.representative_bibIds.length > 0)
        lines.push(`   Supporting: ${s.representative_bibIds.join(", ")}`);
    });
    if (p.common_points && p.common_points.length > 0) {
      lines.push("");
      lines.push("### Common ground");
      p.common_points.forEach((c) =>
        lines.push(`- ${c.point} — supported by: ${c.supporting_bibIds.join(", ")}`),
      );
    }
    if (p.divergences && p.divergences.length > 0) {
      lines.push("");
      lines.push("### Divergences");
      p.divergences.forEach((d) => {
        lines.push(`- **${d.issue}**`);
        d.positions.forEach((pos) =>
          lines.push(`  - ${pos.school}: ${pos.stance} [${pos.bibId}]`),
        );
      });
    }
    if (p.historical_shift && p.historical_shift.trim().length > 0) {
      lines.push("");
      lines.push("### Historical shift");
      lines.push(p.historical_shift);
    }
  } else if (result.mode === "COMPARATIVE") {
    const p = result.plan as ComparativePlan;
    lines.push(`### Topic: ${p.topic}`);
    lines.push("");
    lines.push(`### ${p.sideA.label}`);
    lines.push(p.sideA.position);
    lines.push(`Supporting: ${p.sideA.supporting_bibIds.join(", ")}`);
    lines.push("");
    lines.push(`### ${p.sideB.label}`);
    lines.push(p.sideB.position);
    lines.push(`Supporting: ${p.sideB.supporting_bibIds.join(", ")}`);
    if (p.convergences && p.convergences.length > 0) {
      lines.push("");
      lines.push("### Convergences");
      p.convergences.forEach((c) =>
        lines.push(`- ${c.point} — supported by: ${c.supporting_bibIds.join(", ")}`),
      );
    }
    lines.push("");
    lines.push("### Core difference (use this as your central analytic claim)");
    lines.push(p.difference);
    lines.push("");
    lines.push("### Significance (build your closing paragraph around this)");
    lines.push(p.significance);
  }

  lines.push("");
  lines.push(
    "**Writer instruction:** Write the body around this CONVERSATION. Open with the topic/" +
      "field framing, then build paragraphs around POSITIONS and their tensions. Cite the " +
      "listed bibIds with `[cite:bibId,p=X]` markers (page from retrieved excerpts). Do NOT " +
      "sequentially summarize each source. Do NOT add ungrounded claims beyond the plan.",
  );
  return lines.join("\n");
}
