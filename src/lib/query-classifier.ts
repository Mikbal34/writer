/**
 * Query classifier — soru tipine göre adaptive retrieval pipeline'ı seçmek için.
 *
 * Mevcut sabit pipeline (topK=8, cap=1, HyDE kapalı) hep aynı sonucu veriyor
 * (recall=0.539 tavanı) çünkü her soru tipini AYNI parametre ile çalıştırıyor.
 *
 * Adaptive: classifier → 3 farklı preset → her kategori için optimize.
 *
 * Cost: 1 Haiku call per chat (~$0.0003). Fail-safe: hata olursa "specific" döner.
 */
import { generateJSONWithUsage, HAIKU } from "@/lib/claude";

export type QueryType = "specific" | "thematic" | "comparative";

const SYSTEM_PROMPT =
  "Classify the user's research question into EXACTLY ONE type:\n\n" +
  "- 'specific': asks about a SINGLE concept/work/author/idea\n" +
  "  Examples: 'Wolfson atomism Leukippos', 'Mâtürîdî tevhid argümanı',\n" +
  "             'Gazzâlî kuşku metodu', 'Cüveynî İrşâd akıl-nakil'\n\n" +
  "- 'thematic': asks for BROAD coverage of a topic across MULTIPLE sources\n" +
  "  Examples: 'Klasik kelâm Allah sıfatları' (5+ kelâm scholars expected),\n" +
  "             'Hac antropolojisi yaklaşımları' (multiple anthropologists),\n" +
  "             'Modern Türkiye hac literatürü' (multiple Turkish authors)\n\n" +
  "- 'comparative': EXPLICITLY compares/contrasts 2+ authors/works/positions\n" +
  "  Examples: 'Wolfson vs Frank Eş'arî yorumları',\n" +
  "             'Durkheim ile Eliade kutsal anlayışı farkı',\n" +
  "             'Mâtürîdî ile Eş'arî gelenekleri arasındaki fark'\n\n" +
  "Default 'specific' if uncertain (safer, less risk of broadening too much).\n" +
  'Output ONLY JSON: {"type": "specific"|"thematic"|"comparative"}. No markdown.';

export async function classifyQuery(query: string): Promise<QueryType> {
  const q = query.trim();
  if (q.length < 6) return "specific";
  try {
    const res = await generateJSONWithUsage<{ type?: string }>(
      `Question: "${q}"\n\nReturn JSON.`,
      SYSTEM_PROMPT,
      { model: HAIKU },
    );
    const t = (res.data?.type ?? "").toLowerCase();
    if (t === "thematic" || t === "comparative") return t;
    return "specific";
  } catch {
    return "specific";
  }
}

/**
 * Soru tipine göre retrieval config — her kategori için optimize parametreler.
 *
 * Eval bulguları:
 *   - cap=1 her kategoride dominant ✓
 *   - HyDE: T'ye +9pp katkı, S/K'ya zarar → sadece T için aç
 *   - Top-K: S için 5 yeter (gereksiz chunk), T için 12 gerek (5+ kaynak)
 */
export interface RetrievalConfig {
  topK: number;
  capPerEntry: number;
  useHyDE: boolean;
}

export const CONFIGS: Record<QueryType, RetrievalConfig> = {
  specific: {
    topK: 5,            // tek doğru kaynak yeter, fazla chunk gürültü
    capPerEntry: 1,
    useHyDE: false,     // S kategoride -3pp
  },
  thematic: {
    topK: 12,           // 5+ kaynak bekleniyor, geniş kapsama
    capPerEntry: 1,     // her kaynak max 1 chunk → 12 farklı kitap
    useHyDE: true,      // T kategoride +9pp
  },
  comparative: {
    topK: 8,            // 2-4 kaynak bekleniyor
    capPerEntry: 1,
    useHyDE: false,     // K kategoride -4pp
  },
};
