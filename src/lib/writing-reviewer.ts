/**
 * Writing Reviewer Agent (Stage 7) — generation sonrası kalite kontrol.
 *
 * Sonnet bir subsection paragrafı yazdıktan sonra Haiku judge kontrol eder:
 *   1. Unsupported claims — chunks'tan desteklenmeyen iddia var mı
 *   2. Fabricated citations — [cite:bibId] markerleri allowed listede mi
 *   3. Subsection objective karşılandı mı (description + keyPoints)
 *   4. Genel coherent mi
 *
 * Output: { score, issues, regenerate (bool) }.
 * Yüksek issue → regenerate signal. Max 2 tur (sonsuz döngü engelle).
 *
 * Maliyet: 1 Haiku call per generation (~$0.001). Sonnet $0.17/chat'in %0.6'sı.
 */
import { generateJSONWithUsage, HAIKU } from "@/lib/claude";
import type { SectionGoal } from "@/lib/synthesis-planner";

const REVIEWER_BASE =
  "You are an academic writing reviewer. You evaluate a generated paragraph " +
  "against the source material and the subsection's objective. Your job is to " +
  "flag issues — NOT to rewrite. Return JSON only.";

/**
 * Goal-aware success criteria. Each goal has a distinct purpose and the
 * paragraph's quality is measured against that purpose — not a uniform
 * "did you cite well" checklist. Reviewer scores accordingly.
 */
function goalCriteriaBlock(goal: SectionGoal | undefined): string {
  switch (goal) {
    case "DEFINE":
      return (
        "GOAL = DEFINE. Success criteria:\n" +
        "- termsDefined: are the key terms clearly defined with their conceptual scope?\n" +
        "- scopeSet: does the paragraph establish what is and is NOT in view?\n" +
        "- foundationLaid: is the conceptual foundation sufficient for later subsections to build on?\n" +
        "- Penalize interpretive overreach ('this shows that…', 'consequently…') — DEFINE is descriptive."
      );
    case "CONTEXT":
      return (
        "GOAL = CONTEXT. Success criteria:\n" +
        "- contextEstablished: is the historical / intellectual scene clearly drawn?\n" +
        "- driversIdentified: are the forces shaping the context named (not just events)?\n" +
        "- significanceShown: is one sentence on WHY this context matters present?\n" +
        "- Penalize fact-listing style ('X happened, Y happened, Z happened') and implication overreach."
      );
    case "COMPARE":
      return (
        "GOAL = COMPARE. Success criteria:\n" +
        "- sidesPresented: are both sides given roughly comparable depth in their own terms?\n" +
        "- contrastAxisClear: is the analytic axis of divergence stated, not just 'they differ'?\n" +
        "- convergencesNoted: are points of agreement acknowledged where the chunks show them?\n" +
        "- Penalize collapse into a single 'they all roughly agree' blob; the point is the contrast."
      );
    case "SYNTHESIZE":
      return (
        "GOAL = SYNTHESIZE. Success criteria:\n" +
        "- sourcesIntegrated: do sources speak TO each other, not just BESIDE each other?\n" +
        "- agreementsExtracted: are common moves named?\n" +
        "- divergencesShown: are real disagreements surfaced, not papered over?\n" +
        "- Penalize sequential source-by-source summary even when each summary is accurate."
      );
    case "LITERATURE_GAP":
      return (
        "GOAL = LITERATURE_GAP. Success criteria:\n" +
        "- literatureMapped: are the existing positions named and grouped?\n" +
        "- gapIdentified: is what is missing or overdone stated explicitly (not vaguely)?\n" +
        "- interventionDefined: does the closing name WHERE this thesis intervenes?\n" +
        "- Penalize generic 'more research is needed' style closings — gap must be specific."
      );
    case "THESIS_CONCLUSION":
      return (
        "GOAL = THESIS_CONCLUSION. Success criteria:\n" +
        "- argumentsRestated: is the thesis restated in fresh words, not summary?\n" +
        "- contributionClarified: are the load-bearing claims surfaced clearly?\n" +
        "- researchAgendaProduced: are open research lines named as a forward-looking agenda?\n" +
        "- Penalize 'bridge to next chapter' closing — this is the last word."
      );
    default:
      return "GOAL = unspecified. Apply general academic quality criteria.";
  }
}

function buildReviewerSystemPrompt(goal: SectionGoal | undefined): string {
  return [
    REVIEWER_BASE,
    "",
    "Evaluation dimensions:",
    "1. 'unsupportedClaims' — claims NOT backed by the retrieved excerpts. List max 3, brief.",
    "2. 'fabricatedCitations' — markers referencing bibIds outside the allowed list.",
    "3. 'missingObjective' — true if the paragraph fails to address the goal's success criteria below.",
    "4. 'coherent' — true if academically structured.",
    "5. 'score' — 0-1 (1 perfect). Anchor against the goal-specific criteria below; do NOT treat all subsections the same.",
    "6. 'regenerate' — true if score < 0.5 OR ≥3 unsupportedClaims OR ≥1 fabricatedCitation OR a critical goal-criterion is missed.",
    "",
    goalCriteriaBlock(goal),
    "",
    'Output ONLY JSON: { "score": 0-1, "unsupportedClaims": [], "fabricatedCitations": [], "missingObjective": bool, "coherent": bool, "regenerate": bool, "goalCriteriaMet": { ... }, "reason"?: "..." }',
  ].join("\n");
}

export interface ReviewerInput {
  subsectionTitle: string;
  subsectionObjective: string; // description + keyPoints birleşmiş
  paragraph: string; // Sonnet output
  allowedBibIds: string[];
  retrievedExcerpts: Array<{ sourceTitle: string; preview: string }>; // ilk 100 char
  /** Goal-aware başarı kriterleri için */
  goal?: SectionGoal;
}

export interface ReviewerResult {
  score: number;
  unsupportedClaims: string[];
  fabricatedCitations: string[];
  missingObjective: boolean;
  coherent: boolean;
  regenerate: boolean;
  /** Goal-spesifik başarı kriterleri (her goal'ın anahtarları farklı) */
  goalCriteriaMet?: Record<string, boolean>;
  reason?: string;
  judgeFailed?: boolean;
}

export async function reviewSubsection(input: ReviewerInput): Promise<ReviewerResult> {
  const excerptBlock = input.retrievedExcerpts
    .slice(0, 8)
    .map((e, i) => `[${i + 1}] ${e.sourceTitle}: ${e.preview.slice(0, 120)}…`)
    .join("\n");
  const allowedBlock = input.allowedBibIds.join(", ");
  const paragraph =
    input.paragraph.length > 4000 ? input.paragraph.slice(0, 4000) + "…" : input.paragraph;

  const userPrompt =
    `SUBSECTION: ${input.subsectionTitle}\n\n` +
    `OBJECTIVE:\n${input.subsectionObjective}\n\n` +
    `ALLOWED bibIds: ${allowedBlock}\n\n` +
    `RETRIEVED EXCERPTS (source material):\n${excerptBlock}\n\n` +
    `GENERATED PARAGRAPH:\n${paragraph}\n\n` +
    `Return JSON evaluation.`;

  try {
    const res = await generateJSONWithUsage<ReviewerResult>(
      userPrompt,
      buildReviewerSystemPrompt(input.goal),
      { model: HAIKU },
    );
    const data = res.data ?? ({} as ReviewerResult);
    return {
      score: typeof data.score === "number" ? Math.max(0, Math.min(1, data.score)) : 0.5,
      unsupportedClaims: Array.isArray(data.unsupportedClaims)
        ? data.unsupportedClaims.filter((s): s is string => typeof s === "string")
        : [],
      fabricatedCitations: Array.isArray(data.fabricatedCitations)
        ? data.fabricatedCitations.filter((s): s is string => typeof s === "string")
        : [],
      missingObjective: Boolean(data.missingObjective),
      coherent: data.coherent !== false,
      regenerate: Boolean(data.regenerate),
      goalCriteriaMet:
        data.goalCriteriaMet && typeof data.goalCriteriaMet === "object"
          ? (data.goalCriteriaMet as Record<string, boolean>)
          : undefined,
      reason: typeof data.reason === "string" ? data.reason : undefined,
    };
  } catch (err) {
    console.warn(
      "[writing-reviewer] judge failed, assuming pass:",
      err instanceof Error ? err.message : err,
    );
    return {
      score: 0.5,
      unsupportedClaims: [],
      fabricatedCitations: [],
      missingObjective: false,
      coherent: true,
      regenerate: false,
      judgeFailed: true,
    };
  }
}
