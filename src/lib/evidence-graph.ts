/**
 * Evidence Graph (Stage 4) — chunks'tan önce claim/evidence yapısı.
 *
 * Mevcut akış: chunks → Sonnet (ham metin, model kendisi sentez yapar)
 * Yeni akış:   chunks → Haiku ile claim/evidence çıkar → Sonnet (structured)
 *
 * Faydaları:
 *   1. Sonnet ham chunk noise'undan kurtulur — sentez işini Haiku önceden yapar
 *   2. Her claim'in supporting_sources'ı net → hallucination zor
 *   3. Sonnet'a daha kontrollü "use these claims" prompt
 *
 * Maliyet: 1 Haiku call per generation (~$0.001). Sonnet input token'ı
 * marjinal azalır (claims daha kompakt).
 *
 * Output şekli:
 *   {
 *     "claims": [
 *       { "statement": "Mâtürîdî tevhidi akıl ile temellendirir",
 *         "supporting_bibIds": ["bib_42", "bib_18"],
 *         "supporting_pages": ["45", "120"],
 *         "confidence": 0.88 }
 *     ]
 *   }
 */
import { generateJSONWithUsage, HAIKU } from "@/lib/claude";

const EVIDENCE_SYSTEM_PROMPT =
  "You are an evidence extractor for an academic RAG system. Given a research " +
  "subsection objective and retrieved chunks, extract a structured list of CLAIMS " +
  "with their supporting sources.\n\n" +
  "Rules:\n" +
  "1. Each claim must be DIRECTLY supported by at least one chunk.\n" +
  "2. Do NOT invent claims not in the chunks.\n" +
  "3. Group multiple chunks that support the same claim.\n" +
  "4. Confidence (0-1): how strongly the chunks support the claim. 1 = explicit, " +
  "0.7 = strong inference, 0.5 = weak inference.\n" +
  "5. Max 8 claims. Prioritize claims directly relevant to the subsection.\n" +
  "6. supporting_pages: page numbers (string) from the chunks if available.\n\n" +
  'Output ONLY JSON: { "claims": [{ "statement": "...", ' +
  '"supporting_bibIds": ["bib_xxx"], "supporting_pages": ["45"], "confidence": 0.8 }] }.';

export interface EvidenceClaim {
  statement: string;
  supporting_bibIds: string[];
  supporting_pages: string[];
  confidence: number;
}

export interface EvidenceGraphInput {
  subsectionObjective: string;
  chunks: Array<{
    bibId: string;
    sourceTitle: string;
    page: string | null;
    content: string;
  }>;
}

export interface EvidenceGraphResult {
  claims: EvidenceClaim[];
  /** Toplam chunk → claim coverage oranı */
  coverageRate: number;
  /** Çıkarım başarısız ise: chunks aynen kalsın */
  failed?: boolean;
}

export async function buildEvidenceGraph(
  input: EvidenceGraphInput,
): Promise<EvidenceGraphResult> {
  if (input.chunks.length === 0) {
    return { claims: [], coverageRate: 0 };
  }
  const chunkBlock = input.chunks
    .map((c, i) => {
      const page = c.page ? ` (p.${c.page})` : "";
      const preview = c.content.length > 400 ? c.content.slice(0, 400) + "…" : c.content;
      return `[${i + 1}] bibId=${c.bibId}${page} ${c.sourceTitle}\n${preview}`;
    })
    .join("\n\n");
  const userPrompt =
    `SUBSECTION OBJECTIVE:\n${input.subsectionObjective}\n\n` +
    `RETRIEVED CHUNKS:\n${chunkBlock}\n\n` +
    `Extract claims supported by these chunks. Return JSON.`;
  try {
    const res = await generateJSONWithUsage<{ claims?: EvidenceClaim[] }>(
      userPrompt,
      EVIDENCE_SYSTEM_PROMPT,
      { model: HAIKU },
    );
    const rawClaims = Array.isArray(res.data?.claims) ? res.data!.claims : [];
    const cleaned: EvidenceClaim[] = rawClaims
      .filter((c): c is EvidenceClaim => typeof c?.statement === "string" && c.statement.length > 0)
      .map((c) => ({
        statement: c.statement.trim(),
        supporting_bibIds: Array.isArray(c.supporting_bibIds)
          ? c.supporting_bibIds.filter((b): b is string => typeof b === "string")
          : [],
        supporting_pages: Array.isArray(c.supporting_pages)
          ? c.supporting_pages.filter((p): p is string => typeof p === "string")
          : [],
        confidence: typeof c.confidence === "number" ? Math.max(0, Math.min(1, c.confidence)) : 0.7,
      }))
      .slice(0, 8);
    // Coverage: kaç chunk en az 1 claim'i destekliyor
    const usedBibIds = new Set<string>();
    for (const c of cleaned) for (const b of c.supporting_bibIds) usedBibIds.add(b);
    const totalBibIds = new Set(input.chunks.map((c) => c.bibId)).size;
    const coverageRate = totalBibIds > 0 ? usedBibIds.size / totalBibIds : 0;
    return { claims: cleaned, coverageRate };
  } catch (err) {
    console.warn(
      "[evidence-graph] build failed, falling back to raw chunks:",
      err instanceof Error ? err.message : err,
    );
    return { claims: [], coverageRate: 0, failed: true };
  }
}

/**
 * Evidence graph'i Sonnet'a verilecek prompt block'una dönüştür.
 * Ham chunks yerine yapılandırılmış evidence görür.
 */
export function formatEvidenceForPrompt(claims: EvidenceClaim[]): string {
  if (claims.length === 0) return "";
  const lines: string[] = [
    "## STRUCTURED EVIDENCE",
    "",
    "The retrieved sources have been pre-analyzed. Use these claims as your " +
      "evidence base. Each claim is supported by specific bibIds — cite those " +
      "exact bibIds when you use the claim.",
    "",
  ];
  claims.forEach((c, i) => {
    lines.push(`### Claim ${i + 1} (confidence: ${(c.confidence * 100).toFixed(0)}%)`);
    lines.push(`**${c.statement}**`);
    const supports = c.supporting_bibIds
      .map((b, idx) => {
        const page = c.supporting_pages[idx];
        return page ? `${b} (p.${page})` : b;
      })
      .join(", ");
    if (supports) lines.push(`Supported by: ${supports}`);
    lines.push("");
  });
  return lines.join("\n");
}
