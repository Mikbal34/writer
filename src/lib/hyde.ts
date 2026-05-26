/**
 * HyDE — Hypothetical Document Embeddings (Gao et al. 2022).
 *
 * Sorgu vektörü ↔ chunk vektörü cosine fark bazen büyük olur çünkü:
 *   - Sorgu kısa ve interrogative: "Wolfson atom kuramı Leukippos"
 *   - Chunk uzun ve declarative: "The Greek atomists held that all matter…"
 * İki metin **aynı uzayda** ama "soru" vs "cevap" formları farklı bölgelerde.
 *
 * HyDE şunu yapar: LLM'ye sorunun **hipotetik cevabını** yazdırır (academic
 * register, doğru terminoloji), sonra bu hipotetik metni embed eder. Sorgu
 * vektörü artık "soruya cevap olabilecek metne" yakın — chunk match güçlenir.
 *
 * Paper sonuçları: BEIR benchmarklarında recall@K +10-20pp. Anthropic
 * Contextual Retrieval paper'ı da HyDE'yi orthogonal bir tekniк olarak
 * önerir (ikisi birlikte iyi çalışır).
 *
 * Maliyet: chat call başına 1 ek Haiku call (~$0.0003) + 1 ek Voyage embed.
 * Hata → null döner, chat normal akışına devam eder.
 */
import { generateJSONWithUsage, HAIKU } from "@/lib/claude";

const SYSTEM_PROMPT =
  "You are a Hypothetical Document Embeddings (HyDE) generator for an academic " +
  "library search. Given a research question, write a SHORT hypothetical " +
  "passage (2-3 sentences, max 60 words) that would PLAUSIBLY appear in an " +
  "academic source answering this question. Use scholarly tone, proper " +
  "terminology, and the likely terms an actual source would use. Write in the " +
  "same primary language as the question. Do not introduce yourself, do not " +
  "apologize, do not hedge — write directly as if quoting from a hypothetical " +
  "academic source.\n\n" +
  "Examples:\n" +
  '  Q: "Mâtürîdî tevhid argümanı nasıl temellendirilir?"\n' +
  '  A: "Mâtürîdî, Kitâbü\'t-Tevhîd\'de Allah\'ın varlığı ve birliğini akıl ile\n' +
  '      temellendirir. Hudûs delili ve illet-sebep ilişkisi temel argümanlarıdır."\n\n' +
  '  Q: "Wolfson atom kuramı Leukippos etkisi"\n' +
  '  A: "Wolfson, The Philosophy of the Kalam\'da Mu\'tezile atomizminin Yunan\n' +
  '      atomistlerinden (Leucippus, Democritus) bağımsız geliştiğini savunur."\n\n' +
  'Output ONLY JSON: { "hypothetical": "..." }. No markdown, no commentary.';

export async function generateHyde(query: string): Promise<string | null> {
  const q = query.trim();
  if (q.length < 10) return null;
  try {
    const res = await generateJSONWithUsage<{ hypothetical?: string }>(
      `Question: "${q}"\n\nReturn JSON.`,
      SYSTEM_PROMPT,
      { model: HAIKU },
    );
    const text = (res.data?.hypothetical ?? "").trim();
    return text.length > 0 && text.length < 800 ? text : null;
  } catch (err) {
    console.warn(
      "[hyde] generation failed, falling back without HyDE:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
