/**
 * Karşılaştırmalı soru splitter.
 *
 * "X ve Y'nin farkı" / "X ile Y nasıl ayrılır" / "X, Y, Z arasındaki ilişki"
 * tipi sorular tek vektör olarak embed edildiğinde retrieval HER İKİ tarafı
 * iyi yakalayamaz — vektör compositional kavramları zayıf temsil eder.
 *
 * Bu helper, Haiku ile soruyu yan-yan kavramsal parçalara böler:
 *   "Wolfson ve Frank'ın Eş'arî kelâm yorumları arasındaki fark"
 *     → ["Wolfson'ın Eş'arî kelâm yorumu", "Frank'ın Eş'arî kelâm yorumu"]
 *
 * Karşılaştırmalı değilse boş array döner. Çağıran query expansion'ın
 * variant listesine sub-query'leri ekler; her sub-query için ayrı retrieve
 * çalışır, RRF ile birleştirilir.
 *
 * Cost: 1 Haiku call (~$0.0002). Fail → boş array, pipeline normal akar.
 */
import { generateJSONWithUsage, HAIKU } from "@/lib/claude";

/**
 * Önce ucuz pattern match — sadece comparative sinyali olan sorular Haiku'ya gider.
 * Spesifik sorularda (Q07 Gazzâlî Münkız vb.) Haiku false-positive sub-queries
 * üretirdi → balanced retrieve devreye girip alakasız chunks getiriyordu.
 */
function isLikelyComparative(query: string): boolean {
  const tr = /\b(vs|versus|karşı|farkl?ı|farkı|arasındaki fark|nasıl ayrı|karşılaştır|kıyasla|ayrılık|ayrım)\b/i
  const en = /\b(vs|versus|difference|compare|contrast|against|distinguish|differ)\b/i
  return tr.test(query) || en.test(query)
}

const SYSTEM_PROMPT =
  "You are a query analyzer for an academic RAG system. Given a question, decide if " +
  "it COMPARES two or more authors / concepts / works / positions. If yes, split it " +
  "into SELF-CONTAINED sub-queries (one per side). Each sub-query must retrieve well " +
  "on its own.\n\n" +
  "Rules:\n" +
  "- Same language as the question.\n" +
  "- Maximum 4 sub-queries.\n" +
  "- Empty array if NOT comparative.\n" +
  "- Do NOT include conjunctions like 've', 'and', 'ile', 'vs' in sub-queries.\n\n" +
  "Examples:\n" +
  '  Q: "Wolfson ve Frank\'ın Eş\'arî kelâm yorumları arasındaki fark nedir?"\n' +
  '     → {"subqueries":["Wolfson\'ın Eş\'arî kelâm yorumu","Frank\'ın Eş\'arî kelâm yorumu"]}\n' +
  '  Q: "Durkheim ve Eliade\'ın kutsal anlayışları nasıl ayrılır?"\n' +
  '     → {"subqueries":["Durkheim\'ın kutsal anlayışı","Eliade\'ın kutsal anlayışı"]}\n' +
  '  Q: "Mâtürîdî tevhid argümanı nedir?"\n' +
  '     → {"subqueries":[]}\n' +
  '  Q: "Turner\'ın communitas ile Douglas\'ın purity yaklaşımları nasıl etkileşir?"\n' +
  '     → {"subqueries":["Turner communitas kavramı","Douglas purity kavramı"]}\n\n' +
  'Output ONLY JSON: {"subqueries":[...]}';

export async function splitComparativeQuery(query: string): Promise<string[]> {
  const q = query.trim();
  if (q.length < 10) return [];
  if (!isLikelyComparative(q)) return []; // Pattern check — Haiku call'u skip
  try {
    const result = await generateJSONWithUsage<{ subqueries?: string[] }>(
      `Question: "${q}"\n\nReturn JSON.`,
      SYSTEM_PROMPT,
      { model: HAIKU },
    );
    const list = Array.isArray(result.data?.subqueries)
      ? result.data!.subqueries
      : [];
    return list
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length < 200)
      .slice(0, 4);
  } catch {
    return [];
  }
}
