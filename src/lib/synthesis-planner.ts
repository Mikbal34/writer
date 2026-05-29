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

/**
 * V3 "akademik düşünür" katmanı: subsection'ın yalnızca POZİSYON haritası
 * değil, YORUM haritası da çıkarılır. Implications — "bu farkın nedeni",
 * "bu farkın sonucu", "bu farkın literatüre etkisi" — her THEMATIC ve
 * COMPARATIVE planı zorunlu kılınır.
 *
 * kind:
 *   cause              → "bu durumun gerisindeki sebep"
 *   consequence        → "bu durumdan doğan sonuç"
 *   literature_impact  → "bu durumun literatür / sonraki tartışmalar
 *                         üzerindeki etkisi"
 */
export interface ImplicationItem {
  claim: string; // 1-2 cümlelik yorum
  kind: "cause" | "consequence" | "literature_impact";
  grounded_in_bibIds: string[]; // hangi kaynaklardan / üzerinde duruyor
  /** "inference_from_contrast" = chunks'ta birebir yok, comparison'dan
   *  çıkıyor. "from_chunk" = chunk metninde açıkça duruyor. */
  basis: "from_chunk" | "inference_from_contrast";
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
  historical_shift: string;
  implications: ImplicationItem[];
}

export interface ComparativePlan {
  topic: string;
  sideA: { label: string; position: string; supporting_bibIds: string[] };
  sideB: { label: string; position: string; supporting_bibIds: string[] };
  convergences: Array<{ point: string; supporting_bibIds: string[] }>;
  difference: string;
  significance: string;
  implications: ImplicationItem[];
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

CRITICAL EVIDENCE DISCIPLINE:
- Every claim you emit MUST be VERBATIM derivable from a specific chunk.
  If a chunk literally says "X holds view Y", you may write that. If you
  are inferring, generalizing, or filling in a familiar argument the
  source is "known" to make — STOP. Do NOT emit it.
- Do NOT enrich the plan with specific analogies, examples, doctrinal
  details, or citations of named works UNLESS that exact content
  appears in the supplied excerpts.
- For every claim, the supporting_bibIds you list MUST correspond to
  chunks whose visible content actually states the claim. If only an
  inference is possible, omit the claim — a small plan is better than
  a plan the writer will be forced to fabricate.

Output rules:
1. Use ONLY bibIds that appear in the chunks. Never invent.
2. Quote 1-2 line position statements in the source's own conceptual
   vocabulary — but the substance must come from chunk text.
3. Each common_point + each divergence MUST be backed by chunk evidence
   you can quote (you do not include the quote in the JSON, but you
   must have one in mind for each claim).
4. historical_shift: only fill if the chunks themselves describe a
   chronological evolution. Empty string otherwise. NEVER infer "well-
   known" classical-to-modern narratives from prior knowledge.
5. Max 5 schools, max 4 common points, max 4 divergences. Fewer is
   better if the chunks do not actually carry more.

IMPLICATIONS (V3 — required, this is what turns a "synthesizer" into a
"thinker"):
Add 2-4 implication items. Each item is one of:
  - "cause": the underlying reason the divergence / historical shift /
    convergence EXISTS (NOT what each position is, but WHY the topology
    looks the way it does).
  - "consequence": what follows from this topology — a methodological,
    doctrinal, or epistemological outcome that the field has to live with.
  - "literature_impact": how this topology shapes subsequent debates or
    research agendas; what later thinkers must engage with because of it.

For each implication set "basis":
  - "from_chunk" if a specific chunk contains the implication outright.
  - "inference_from_contrast" if it follows from comparing the chunks but
    is NOT verbatim in any single one. THIS IS ALLOWED for implications.
    It is NOT allowed for schools / positions / common_points /
    divergences — those must be verbatim.
Implications still must list grounded_in_bibIds — the bibIds whose chunks
the inference is built on.

Output ONLY JSON:
{
  "schools": [{ "name": "...", "position": "...", "representative_bibIds": ["..."] }],
  "common_points": [{ "point": "...", "supporting_bibIds": ["..."] }],
  "divergences": [{ "issue": "...", "positions": [{ "school": "...", "stance": "...", "bibId": "..." }] }],
  "historical_shift": "...",
  "implications": [{ "claim": "...", "kind": "cause|consequence|literature_impact", "grounded_in_bibIds": ["..."], "basis": "from_chunk|inference_from_contrast" }]
}`;

const COMPARATIVE_SYSTEM = `You are an academic synthesis planner for a COMPARATIVE subsection
(X vs Y). You receive a subsection objective and retrieved chunks. Your
job: extract the structural comparison — not summarize each side
separately, but build the contrast that drives the subsection.

CRITICAL EVIDENCE DISCIPLINE:
- Every position statement, convergence, difference, and significance
  claim MUST be VERBATIM derivable from a specific chunk.
- Do NOT enrich the comparison with positions or details that the
  excerpts do not contain, even if the two thinkers are "known" to hold
  those positions. If a chunk does not say it, you do not have it.
- "difference" and "significance" must be supported by what the chunks
  actually state — not by your general knowledge of where X and Y
  diverge in the literature.
- If the chunks for sideA or sideB are weak (1 short chunk, off-topic),
  say so by keeping the position thin or empty; never paper over a gap.

Output rules:
1. Use ONLY bibIds that appear in the chunks. Never invent.
2. sideA / sideB: name the position FIRST (label = "Mâtürîdî", "Wolfson"
   etc.), then the position in its OWN terms with supporting bibIds —
   substance from chunk text only.
3. convergences: where the two sides agree based on chunk evidence.
   Empty array if chunks do not show convergence.
4. difference: 1 analytic paragraph (max 50 words) on the CORE divergence
   the CHUNKS reveal. Not "they disagree about X" — but WHY and on WHAT
   axis, grounded in what the excerpts actually say.
5. significance: 1 paragraph (max 40 words) — what follows from this
   divergence, also grounded in chunk material.

IMPLICATIONS (V3 — required, this is what turns a "synthesizer" into a
"thinker"):
In addition to the structural fields above, add 2-3 implication items.
Each item is one of:
  - "cause": the underlying reason this divergence EXISTS at all (e.g. a
    differing methodological commitment, a different reading of a
    foundational concept, a different theological priority).
  - "consequence": what follows from the divergence — what each tradition
    is forced to accept or reject downstream because of it.
  - "literature_impact": how this divergence shapes later debates,
    research agendas, or how subsequent thinkers must position themselves.

For each implication set "basis":
  - "from_chunk" if a chunk states the implication outright.
  - "inference_from_contrast" if it follows from comparing sideA and
    sideB but is not verbatim in any single chunk. THIS IS ALLOWED for
    implications — it is the whole point of this field. It remains
    FORBIDDEN for the structural fields (sideA / sideB / convergences /
    difference must be verbatim from chunks).
Implications still must list grounded_in_bibIds.

Output ONLY JSON:
{
  "topic": "...",
  "sideA": { "label": "...", "position": "...", "supporting_bibIds": ["..."] },
  "sideB": { "label": "...", "position": "...", "supporting_bibIds": ["..."] },
  "convergences": [{ "point": "...", "supporting_bibIds": ["..."] }],
  "difference": "...",
  "significance": "...",
  "implications": [{ "claim": "...", "kind": "cause|consequence|literature_impact", "grounded_in_bibIds": ["..."], "basis": "from_chunk|inference_from_contrast" }]
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
    if (p.implications && p.implications.length > 0) {
      lines.push("");
      lines.push("### Implications (USE AT LEAST ONE in your closing paragraph)");
      p.implications.forEach((im) => {
        const tag = im.kind === "cause" ? "WHY" : im.kind === "consequence" ? "SO WHAT" : "LITERATURE IMPACT";
        const basisTag = im.basis === "from_chunk" ? "" : " [inference from contrast]";
        lines.push(`- **[${tag}]** ${im.claim} — grounded in: ${im.grounded_in_bibIds.join(", ")}${basisTag}`);
      });
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
    if (p.implications && p.implications.length > 0) {
      lines.push("");
      lines.push("### Implications (USE AT LEAST ONE in your closing paragraph)");
      p.implications.forEach((im) => {
        const tag = im.kind === "cause" ? "WHY" : im.kind === "consequence" ? "SO WHAT" : "LITERATURE IMPACT";
        const basisTag = im.basis === "from_chunk" ? "" : " [inference from contrast]";
        lines.push(`- **[${tag}]** ${im.claim} — grounded in: ${im.grounded_in_bibIds.join(", ")}${basisTag}`);
      });
    }
  }

  lines.push("");
  lines.push(
    "**Writer instructions:**\n" +
      "- Write the body around this CONVERSATION (positions, tensions, shifts) — NOT as a sequential source-by-source summary.\n" +
      "- The plan is your ARGUMENTATIVE SKELETON. The RELEVANT SOURCE EXCERPTS section is your EVIDENCE — verify every claim and citation against it.\n" +
      "- If a plan claim is not directly supported by the excerpts you can see, DROP THE CLAIM or weaken it. Do NOT fabricate the evidence to match the plan.\n" +
      "- Cite the listed bibIds with `[cite:bibId,p=X]` markers — page MUST come from the excerpts.\n" +
      "- Do NOT add specific doctrinal claims, analogies, or named-work references that appear neither in the plan nor in the excerpts.\n" +
      "- **IMPLICATIONS ARE REQUIRED.** Your closing paragraph (the last 2-4 sentences of the subsection) MUST surface at least one of the listed implications — i.e. answer one of: WHY this looks the way it does, SO WHAT follows from it, or HOW it shapes later debates. Implications marked '[inference from contrast]' are allowed even though the chunk does not state them verbatim — they are the analytic move the subsection is supposed to make. Frame the implication as your own analytic claim, not a quote.\n" +
      "- A subsection that ends without any implication sentence is incomplete, even if all positions are correctly summarised.",
  );
  return lines.join("\n");
}
