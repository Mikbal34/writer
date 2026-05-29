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

export type SynthesisMode = "SPECIFIC" | "THEMATIC" | "COMPARATIVE" | "SYNTHESIS";

/**
 * SectionGoal — subsection'ın bölüm içindeki AMACI. Mode "nasıl"sa,
 * goal "neden". Planner output şemasını ve writer kapanış kuralını
 * goal değiştirir. Mode + goal ortogonal.
 */
export type SectionGoal =
  | "DEFINE"
  | "CONTEXT"
  | "COMPARE"
  | "SYNTHESIZE"
  | "LITERATURE_GAP"
  | "THESIS_CONCLUSION";

/**
 * Planner backend — goal'a göre eşlenir.
 *   OFF        → planner çağrılmaz (DEFINE)
 *   LIGHT      → drivers / relationships / historical_significance
 *                (CONTEXT — descriptive sentez ama implication yok)
 *   COMPARATIVE → mevcut comparative şema (COMPARE)
 *   FULL       → mevcut thematic şema + implications (SYNTHESIZE)
 *   GAP        → literatür haritası + boşluk + müdahale (LITERATURE_GAP)
 *   CONCLUSION → restated_thesis + load_bearing_claims + open_lines
 *                (THESIS_CONCLUSION)
 */
export type PlannerBackend = "OFF" | "LIGHT" | "COMPARATIVE" | "FULL" | "GAP" | "CONCLUSION";

export function plannerBackendForGoal(goal: SectionGoal): PlannerBackend {
  switch (goal) {
    case "DEFINE":
      return "OFF";
    case "CONTEXT":
      return "LIGHT";
    case "COMPARE":
      return "COMPARATIVE";
    case "SYNTHESIZE":
      return "FULL";
    case "LITERATURE_GAP":
      return "GAP";
    case "THESIS_CONCLUSION":
      return "CONCLUSION";
  }
}

export interface PlannerInput {
  subsectionTitle: string;
  subsectionObjective: string; // description + keyPoints birleşmiş
  mode: SynthesisMode;
  /** Subsection'ın bölüm içindeki amacı — planner backend'i seçer */
  goal?: SectionGoal;
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

/**
 * LIGHT plan — CONTEXT subsection'larının ihtiyacı: hafif sentez,
 * implication YOK. Coğrafya, siyasi, eğitim, sosyal etmenleri ve
 * aralarındaki ilişkileri kurar ki Writer "A oldu, B oldu, C oldu"
 * listesi yerine bağlam çıkarsın. Drivers + relationships +
 * historical_significance üç bloktur.
 */
export interface LightPlan {
  drivers: Array<{ label: string; description: string; supporting_bibIds: string[] }>;
  relationships: Array<{ between: string[]; nature: string; supporting_bibIds: string[] }>;
  historical_significance: string; // 1-2 cümle — neden bu bağlam önemli
}

/**
 * GAP plan — LITERATURE_GAP subsection'ları için. Mevcut literatürü
 * haritalandırır, neyin eksik / fazla işlendiğini söyler, tezin
 * müdahale noktasını belirtir.
 */
export interface GapPlan {
  /** Mevcut literatürün haritası — pozisyonlar ve hangi kaynaklar */
  positions: Array<{ stance: string; representative_bibIds: string[] }>;
  /** Yeterince ele alınmamış / atlanmış mevzular */
  what_is_missing: string[];
  /** Aşırı ele alınmış / doygun mevzular */
  what_is_overdone: string[];
  /** Tezin bu boşluğa müdahale ettiği nokta — 1 paragraf */
  where_this_thesis_intervenes: string;
}

/**
 * CONCLUSION plan — THESIS_CONCLUSION subsection'ı için. Tezin
 * tamamının payoff'unu kurar: yeniden ifade, yük taşıyan iddialar,
 * açık araştırma hatları.
 */
export interface ConclusionPlan {
  /** Tezin merkezî iddiasının yeniden ifadesi — 1-2 cümle */
  restated_thesis: string;
  /** Üç yük taşıyan iddia (load-bearing claims) + kaynaklar */
  three_load_bearing_claims: Array<{ claim: string; supporting_bibIds: string[] }>;
  /** Açık araştırma hatları — sonraki çalışmaya gündem */
  open_research_lines: string[];
}

export type PlannerResult =
  | { mode: "THEMATIC"; plan: ThematicPlan; backend: "FULL"; failed?: false }
  | { mode: "SYNTHESIS"; plan: ThematicPlan; backend: "FULL"; failed?: false }
  | { mode: "COMPARATIVE"; plan: ComparativePlan; backend: "COMPARATIVE"; failed?: false }
  | { mode: SynthesisMode; plan: LightPlan; backend: "LIGHT"; failed?: false }
  | { mode: SynthesisMode; plan: GapPlan; backend: "GAP"; failed?: false }
  | { mode: SynthesisMode; plan: ConclusionPlan; backend: "CONCLUSION"; failed?: false }
  | { mode: SynthesisMode; plan: null; backend: PlannerBackend; failed: true; reason: string };

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

const LIGHT_SYSTEM = `You are a context planner for an academic CONTEXT subsection.
Your job is light synthesis — NOT a list of "X happened, Y happened, Z
happened". You identify the DRIVERS shaping the context, the
RELATIONSHIPS between them, and one short paragraph on the historical
SIGNIFICANCE — i.e. why this context matters for the thesis ahead.

EVIDENCE DISCIPLINE: Drivers and relationships must be VERBATIM
derivable from chunks. Use ONLY bibIds that appear in the supplied
chunks. Do NOT emit implication / "this shows that" style claims —
context's job is to set the stage, not interpret it. The Writer will
later use this map to weave context, not list facts.

Output ONLY JSON:
{
  "drivers": [{ "label": "...", "description": "...", "supporting_bibIds": ["..."] }],
  "relationships": [{ "between": ["driverA","driverB"], "nature": "...", "supporting_bibIds": ["..."] }],
  "historical_significance": "..."
}`;

const GAP_SYSTEM = `You are a literature-gap planner for an academic LITERATURE_GAP
subsection. Your job is to map the existing scholarly conversation,
identify what is missing or overdone in it, and state where this thesis
intervenes.

EVIDENCE DISCIPLINE:
- "positions" must be verbatim derivable from chunks (these are real
  positions held by real authors in the supplied excerpts).
- "what_is_missing" and "what_is_overdone" are SCHOLARLY ASSESSMENTS —
  you may infer these from comparing what the chunks DO discuss against
  what a serious thesis on this topic should require. Inference is
  allowed here; that is the whole purpose of this field.
- "where_this_thesis_intervenes" must follow from the gaps you
  identified — one paragraph (max 60 words).
Use ONLY bibIds present in chunks.

Output ONLY JSON:
{
  "positions": [{ "stance": "...", "representative_bibIds": ["..."] }],
  "what_is_missing": ["..."],
  "what_is_overdone": ["..."],
  "where_this_thesis_intervenes": "..."
}`;

const CONCLUSION_SYSTEM = `You are a thesis-conclusion planner for a THESIS_CONCLUSION subsection.
Your job is to construct the PAYOFF of the entire thesis — not a
summary, but the load-bearing argumentative spine and the research
agenda that follows from it.

EVIDENCE DISCIPLINE:
- "restated_thesis" should be derivable from the cumulative arc of the
  chunks (which carry the thesis's evidence base).
- "three_load_bearing_claims": three concrete claims the thesis depends
  on. Each must list grounded_in_bibIds whose chunks substantively
  support the claim.
- "open_research_lines": follow-up research agendas that the thesis
  opens up. Inference allowed — this is by definition forward-looking.

Use ONLY bibIds present in chunks.

Output ONLY JSON:
{
  "restated_thesis": "...",
  "three_load_bearing_claims": [{ "claim": "...", "supporting_bibIds": ["..."] }],
  "open_research_lines": ["..."]
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
  // Backend resolution: goal varsa goal'dan, yoksa mod'dan eski mantığa
  // (geri-uyum: goal yoksa COMPARATIVE → COMPARATIVE, THEMATIC/SYNTHESIS
  // → FULL, SPECIFIC → OFF).
  const backend: PlannerBackend = input.goal
    ? plannerBackendForGoal(input.goal)
    : input.mode === "COMPARATIVE"
      ? "COMPARATIVE"
      : input.mode === "THEMATIC" || input.mode === "SYNTHESIS"
        ? "FULL"
        : "OFF";

  if (backend === "OFF" || input.chunks.length === 0) {
    return {
      mode: input.mode,
      plan: null,
      backend,
      failed: true,
      reason: backend === "OFF" ? "DEFINE / SPECIFIC — no planner" : "empty chunks",
    };
  }

  const system =
    backend === "COMPARATIVE"
      ? COMPARATIVE_SYSTEM
      : backend === "LIGHT"
        ? LIGHT_SYSTEM
        : backend === "GAP"
          ? GAP_SYSTEM
          : backend === "CONCLUSION"
            ? CONCLUSION_SYSTEM
            : THEMATIC_SYSTEM;

  const userPrompt =
    `SUBSECTION TITLE: ${input.subsectionTitle}\n\n` +
    `SUBSECTION OBJECTIVE:\n${input.subsectionObjective}\n\n` +
    `RETRIEVED CHUNKS:\n${buildChunkBlock(input.chunks)}\n\n` +
    `Return the synthesis plan as JSON.`;

  try {
    const res = await generateJSONWithUsage<
      ThematicPlan | ComparativePlan | LightPlan | GapPlan | ConclusionPlan
    >(userPrompt, system, { model: HAIKU });
    if (!res.data) {
      return { mode: input.mode, plan: null, backend, failed: true, reason: "empty response" };
    }
    switch (backend) {
      case "COMPARATIVE":
        return { mode: "COMPARATIVE", plan: res.data as ComparativePlan, backend: "COMPARATIVE" };
      case "LIGHT":
        return { mode: input.mode, plan: res.data as LightPlan, backend: "LIGHT" };
      case "GAP":
        return { mode: input.mode, plan: res.data as GapPlan, backend: "GAP" };
      case "CONCLUSION":
        return { mode: input.mode, plan: res.data as ConclusionPlan, backend: "CONCLUSION" };
      case "FULL":
        return {
          mode: input.mode === "SYNTHESIS" ? "SYNTHESIS" : "THEMATIC",
          plan: res.data as ThematicPlan,
          backend: "FULL",
        };
      default:
        return {
          mode: input.mode,
          plan: null,
          backend,
          failed: true,
          reason: "unsupported backend",
        };
    }
  } catch (err) {
    return {
      mode: input.mode,
      plan: null,
      backend,
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
export function formatPlanForPrompt(result: PlannerResult, analysisDepth = 5): string {
  if (result.failed || !result.plan) return "";
  const lines: string[] = ["## SYNTHESIS PLAN (use this as your argumentative skeleton)"];
  lines.push("");
  lines.push(
    `This is NOT a list of sources. This is a pre-built map. ` +
      `Build your paragraphs around the structures below, not around individual sources. ` +
      `Cite the listed bibIds with \`[cite:bibId,p=X]\` markers.`,
  );
  lines.push("");
  lines.push(`**Analysis depth for this subsection: ${analysisDepth}/10.**`);
  lines.push("");

  // LIGHT — CONTEXT
  if (result.backend === "LIGHT") {
    const p = result.plan as LightPlan;
    lines.push("### Drivers (the forces shaping this context)");
    p.drivers.forEach((d) => {
      lines.push(`- **${d.label}** — ${d.description} — supported by: ${d.supporting_bibIds.join(", ")}`);
    });
    if (p.relationships && p.relationships.length > 0) {
      lines.push("");
      lines.push("### Relationships");
      p.relationships.forEach((r) => {
        lines.push(`- ${r.between.join(" ↔ ")}: ${r.nature} — ${r.supporting_bibIds.join(", ")}`);
      });
    }
    if (p.historical_significance && p.historical_significance.trim().length > 0) {
      lines.push("");
      lines.push("### Why this context matters");
      lines.push(p.historical_significance);
    }
    lines.push("");
    lines.push(
      "**Writer instructions (CONTEXT):**\n" +
        "- Use the drivers and relationships above to write a connected context paragraph, NOT a list of facts.\n" +
        "- Do NOT emit implication / 'this shows that' style sentences. Context's job is to set the stage.\n" +
        "- Cite each driver / relationship's supporting bibIds with `[cite:bibId,p=X]`.\n" +
        "- Close on the 'Why this context matters' framing — one sentence, no overreach.",
    );
    return lines.join("\n");
  }

  // GAP — LITERATURE_GAP
  if (result.backend === "GAP") {
    const p = result.plan as GapPlan;
    lines.push("### Positions in the existing literature");
    p.positions.forEach((pos) => {
      lines.push(`- **${pos.stance}** — represented by: ${pos.representative_bibIds.join(", ")}`);
    });
    if (p.what_is_missing && p.what_is_missing.length > 0) {
      lines.push("");
      lines.push("### What is missing");
      p.what_is_missing.forEach((m) => lines.push(`- ${m}`));
    }
    if (p.what_is_overdone && p.what_is_overdone.length > 0) {
      lines.push("");
      lines.push("### What is overdone");
      p.what_is_overdone.forEach((m) => lines.push(`- ${m}`));
    }
    if (p.where_this_thesis_intervenes && p.where_this_thesis_intervenes.trim().length > 0) {
      lines.push("");
      lines.push("### Where this thesis intervenes");
      lines.push(p.where_this_thesis_intervenes);
    }
    lines.push("");
    lines.push(
      "**Writer instructions (LITERATURE_GAP):**\n" +
        "- Open by mapping the positions — don't summarize each author separately; group by stance.\n" +
        "- Identify the missing / overdone moves with measured, fair language.\n" +
        "- **Closing paragraph (REQUIRED):** state explicitly where THIS THESIS intervenes — one or two sentences naming the gap and the contribution. This is the analytic payoff.",
    );
    return lines.join("\n");
  }

  // CONCLUSION — THESIS_CONCLUSION
  if (result.backend === "CONCLUSION") {
    const p = result.plan as ConclusionPlan;
    lines.push("### Restated thesis");
    lines.push(p.restated_thesis);
    if (p.three_load_bearing_claims && p.three_load_bearing_claims.length > 0) {
      lines.push("");
      lines.push("### Three load-bearing claims (the spine of the thesis)");
      p.three_load_bearing_claims.forEach((c, i) => {
        lines.push(`${i + 1}. **${c.claim}** — supported by: ${c.supporting_bibIds.join(", ")}`);
      });
    }
    if (p.open_research_lines && p.open_research_lines.length > 0) {
      lines.push("");
      lines.push("### Open research lines (forward-looking agenda)");
      p.open_research_lines.forEach((l) => lines.push(`- ${l}`));
    }
    lines.push("");
    lines.push(
      "**Writer instructions (THESIS_CONCLUSION):**\n" +
        "- Open by restating the thesis in fresh words — NOT a summary of chapter findings.\n" +
        "- Walk through the three load-bearing claims, citing the listed bibIds.\n" +
        "- **Closing paragraph (REQUIRED):** name the open research lines explicitly as a forward-looking agenda. Do NOT end with a polite 'bridge to next chapter' sentence — this IS the last word.",
    );
    return lines.join("\n");
  }


  if (result.mode === "THEMATIC" || result.mode === "SYNTHESIS") {
    const p = result.plan as ThematicPlan;
    if (result.mode === "SYNTHESIS") {
      lines.push(
        "**This is a SYNTHESIS subsection** — its primary job is implication, not summary. " +
          "Use the positions / common / divergences fields below as background and spend most of the " +
          "subsection on the **Implications** block. Open with one framing paragraph, then build the body " +
          "around WHY / SO WHAT / LITERATURE IMPACT cycles.",
      );
      lines.push("");
    }
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
  const depthTier =
    analysisDepth <= 3 ? "low" : analysisDepth <= 6 ? "mid" : "high";
  const depthRule =
    depthTier === "low"
      ? "- **DEPTH LOW (≤3):** This subsection is explanatory. Stay descriptive. Write what each position holds and how the evidence supports it. Reserve interpretive language for AT MOST a single closing sentence. Do NOT pepper the body with 'this shows that', 'as a result', 'consequently', etc. — those phrases here sound AI-generated, not academic."
      : depthTier === "mid"
        ? "- **DEPTH MID (4-6):** Mix. ~60% description, ~30% structural comparison, ~10% closing implication. Use 1-2 implication sentences total — one in the body where the contrast is sharpest, one in the closing paragraph. Do not over-extend interpretive moves; the subsection's primary job is still mapping the conversation."
        : "- **DEPTH HIGH (7-10):** This subsection is interpretive. Description should be compressed; spend the body on cause / consequence / literature_impact arguments. Each body paragraph should contain at least one analytic move (WHY, SO WHAT, IMPACT). The closing paragraph IS the implication — not a bridge to the next subsection, but the subsection's analytic payoff.";
  lines.push(
    "**Writer instructions:**\n" +
      "- Write the body around this CONVERSATION (positions, tensions, shifts) — NOT as a sequential source-by-source summary.\n" +
      "- The plan is your ARGUMENTATIVE SKELETON. The RELEVANT SOURCE EXCERPTS section is your EVIDENCE — verify every claim and citation against it.\n" +
      "- If a plan claim is not directly supported by the excerpts you can see, DROP THE CLAIM or weaken it. Do NOT fabricate the evidence to match the plan.\n" +
      "- Cite the listed bibIds with `[cite:bibId,p=X]` markers — page MUST come from the excerpts.\n" +
      "- Do NOT add specific doctrinal claims, analogies, or named-work references that appear neither in the plan nor in the excerpts.\n" +
      depthRule +
      "\n- Implications marked '[inference from contrast]' are allowed where they appear: they are an analytic move, not a citation. Frame as your own claim.",
  );
  return lines.join("\n");
}
