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

const REVIEWER_SYSTEM_PROMPT =
  "You are an academic writing reviewer. You evaluate a generated paragraph " +
  "against the source material and the subsection's objective. Your job is to " +
  "flag issues — NOT to rewrite. Return JSON only.\n\n" +
  "Evaluation dimensions:\n" +
  "1. 'unsupportedClaims' — claims in the paragraph that are NOT backed by the " +
  "retrieved excerpts. List them (max 3, brief).\n" +
  "2. 'fabricatedCitations' — citation markers that reference bibIds not in " +
  "the allowed list. List the offending bibIds.\n" +
  "3. 'missingObjective' — true if the paragraph fails to address the " +
  "subsection's main objective/keyPoints.\n" +
  "4. 'coherent' — true if the paragraph flows naturally and is academically " +
  "structured.\n" +
  "5. 'score' — overall quality 0-1 (1 = perfect, 0 = unusable).\n" +
  "6. 'regenerate' — true if score < 0.5 OR ≥3 unsupportedClaims OR ≥1 " +
  "fabricatedCitation.\n\n" +
  'Output ONLY JSON: { "score": 0-1, "unsupportedClaims": [], ' +
  '"fabricatedCitations": [], "missingObjective": bool, "coherent": bool, ' +
  '"regenerate": bool, "reason"?: "..." }';

export interface ReviewerInput {
  subsectionTitle: string;
  subsectionObjective: string; // description + keyPoints birleşmiş
  paragraph: string; // Sonnet output
  allowedBibIds: string[];
  retrievedExcerpts: Array<{ sourceTitle: string; preview: string }>; // ilk 100 char
}

export interface ReviewerResult {
  score: number;
  unsupportedClaims: string[];
  fabricatedCitations: string[];
  missingObjective: boolean;
  coherent: boolean;
  regenerate: boolean;
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
      REVIEWER_SYSTEM_PROMPT,
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
