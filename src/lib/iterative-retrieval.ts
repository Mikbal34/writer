/**
 * Iterative retrieval — multi-step recall sıçramı.
 *
 * Tek-shot retrieval'da top-K yetersiz kalırsa hiçbir geri dönüş yok. Iterative:
 *   1. Normal retrieve (8 chunk)
 *   2. Haiku judge: "Bu chunks soruyu kapsıyor mu? Eksik kalan kavram var mı?"
 *   3. Eksik varsa: missingTopic ile 2. tur retrieve
 *   4. Birinci + ikinci tur merge, cap=1 ile final 8
 *
 * Maliyet: 1 ekstra Haiku call + (insufficient ise) 1 ekstra embed + 1 ekstra
 * pgvector query. ~$0.0005 per chat.
 *
 * Latency: +1-2s (judge) + (varsa) +1-2s (2. tur).
 */
import { generateJSONWithUsage, HAIKU } from "@/lib/claude";

const JUDGE_SYSTEM_PROMPT =
  "You are evaluating whether retrieved passages sufficiently cover a research question. " +
  "Given the question and a brief summary of the top retrieved passages (author + title + " +
  "first 100 chars), decide if there's an important aspect/concept/author the user likely " +
  "needs that is MISSING from the passages. If so, name that missing aspect concretely " +
  "(a noun phrase). If passages cover the question adequately, mark sufficient.\n\n" +
  "Examples:\n" +
  '  Q: "Klasik kelâm Allah sıfatları" + passages all from Mâtürîdî/Bâkıllânî\n' +
  '     → {"sufficient": false, "missingTopic": "Cüveynî sıfat görüşü"}\n' +
  '  Q: "Wolfson atom kuramı Leukippos" + passage from Wolfson Atomism\n' +
  '     → {"sufficient": true}\n' +
  '  Q: "Hac antropolojisi yaklaşımları" + passages from Hammoudi + Bianchi\n' +
  '     → {"sufficient": false, "missingTopic": "Eickelman Muslim Travellers"}\n\n' +
  'Output ONLY JSON: {"sufficient": boolean, "missingTopic"?: string}. No markdown.';

export interface JudgeResult {
  sufficient: boolean;
  missingTopic?: string;
}

export interface JudgeChunkBrief {
  authorSurname: string | null;
  title: string;
  preview: string; // ilk ~100 char
}

export async function judgeSufficiency(
  query: string,
  chunks: JudgeChunkBrief[],
): Promise<JudgeResult> {
  if (chunks.length === 0) return { sufficient: false };
  const passageBlock = chunks
    .map((c, i) => {
      const author = c.authorSurname ?? "?";
      const preview = c.preview.length > 100 ? c.preview.slice(0, 100) + "…" : c.preview;
      return `[${i + 1}] ${author} — ${c.title.slice(0, 60)}: ${preview}`;
    })
    .join("\n");
  try {
    const result = await generateJSONWithUsage<JudgeResult>(
      `Question: "${query}"\n\nTop retrieved passages:\n${passageBlock}\n\nReturn JSON.`,
      JUDGE_SYSTEM_PROMPT,
      { model: HAIKU },
    );
    const data = result.data ?? {};
    return {
      sufficient: Boolean(data.sufficient),
      missingTopic:
        typeof data.missingTopic === "string" && data.missingTopic.trim().length > 0
          ? data.missingTopic.trim()
          : undefined,
    };
  } catch {
    // Fail-safe: judge yapamadıysak sufficient varsay, 2. tur yapma
    return { sufficient: true };
  }
}
