/**
 * Synthesis-mode detection + prompt block.
 *
 * Default chat RAG answers "what does the source say about X?"
 * Synthesis mode answers "what do my N sources collectively say
 * about X, and where do they agree or disagree?" This is the
 * differentiator vs Elicit / Consensus / Scite — those have it as
 * a paid feature; we get it almost free because we already have
 * the retrieval pipeline.
 *
 * Trigger: heuristic on the user's question (compare / contrast /
 * positions / each source / pro-con / debate phrasing). Falls back
 * to plain RAG when detection misses — synthesis is a stylistic
 * lift, not a different retrieval path, so a missed trigger just
 * means the user gets the normal answer.
 *
 * Guardrail: needs chunks from ≥ 2 distinct entries. A "compare"
 * question that only finds excerpts from one book has nothing to
 * compare; fall back to normal mode.
 */

// Compare / contrast verbs in Turkish + English. Conservative on
// purpose — we'd rather miss a synthesis case than mis-trigger on
// a normal factual query.
const SYNTHESIS_TRIGGERS: RegExp[] = [
  /\b(karşılaştır|karşılaştırmalı|karşılaştırd)\w*/i, // karşılaştır(malı/dı/ır)
  /\b(compare|contrast|versus|vs\.?)\b/i,
  /\bne\s+dik\s+gel(ir|iyor)\b/i,
  /\b(pozisyon|görüş|yaklaşım|tutum)lar(ı|ın)\b/i, // pozisyonlar(ı/ın), görüşler...
  /\b(her\s+(bir\s+)?(kaynak|kitap|yazar))\b/i,             // her (bir) kaynak/kitap/yazar
  /\b(her\s+ikisi|her\s+üçü|hepsi(ne|nde))\b/i,                // her ikisi/üçü, hepsine/de
  /\b(agree|disagree|consensus|debate|conflict|differ)\b/i,
  /\bne\s+ölçüde\s+(aynı|farklı|benzer)\b/i,
  /\b(midir|mıdır|mudur|müdür)\?/i,                       // yes/no debate questions
  /\bdo\s+(they|the\s+sources|all\s+(authors|sources))\b/i,
  /\bbir\s+karşılaştırma\b/i,                          // "bir karşılaştırma"
  /\bsentez\b/i,                                          // "sentez"
];

export function isSynthesisQuery(query: string): boolean {
  const trimmed = query.trim();
  // Very short queries are unlikely to be synthesis — "modernite?"
  // by itself isn't asking for cross-source comparison.
  if (trimmed.length < 12) return false;
  // Don't fire on questions about a single specific thing on a
  // specific page — those want a direct quote, not a synthesis.
  if (/\b(sayfa|s\.|page|p\.)\s*\d+/i.test(trimmed)) return false;
  return SYNTHESIS_TRIGGERS.some((re) => re.test(trimmed));
}

/**
 * Returns the additional prompt block to inject when synthesis
 * mode is active. The base research prompt rules stay in force
 * (no hallucinated citations, no fabrication beyond excerpts);
 * this just changes the *shape* of the answer.
 */
export const SYNTHESIS_PROMPT_BLOCK = `
SENTEZ MODU:
Bu soru, birden fazla kaynağın pozisyonlarını karşılaştırmayı
gerektiriyor. Cevabını şu yapıyla ver:

## Kaynak pozisyonları
- **{Yazar, Eser adı}** (s. {sayfa}) — *{Destekleyici | Karşıt | Nüanslı | Tangent}* — {Bu kaynağın soruya verdiği cevap, 1-2 cümle, [n] atıflı}
- (her ilgili kaynak için bir satır; soruyla doğrudan ilgili olmayan kaynakları atla)

## Sentez
{Kaynakların ortak çıkardığı sonuç, ayrıştığı noktalar, ve sentezlenmiş cevap.
Hangi pozisyonların güçlü/zayıf delillere dayandığını söyle; ama excerpt'lerde
olmayan değer yargısı ekleme. 3-6 cümle.}

KURALLAR:
- "Kaynak pozisyonları" listesinde her kitabı yalnızca bir kez ele al
  (birden fazla excerpt'i varsa en ilgili olanı seç).
- Tek bir kaynaktan excerpt geldiyse sentez modunu kullanma; bu durumda
  normal cevap yapısına dön.
- Aynı [n] atıf numarasını birden fazla kez kullanabilirsin.
`.trim();

/**
 * Should we activate synthesis mode for this turn? True only when
 * the question reads like a comparison AND retrieval found chunks
 * from ≥ 2 distinct entries.
 */
export function shouldActivateSynthesis(
  query: string,
  distinctEntryIds: Iterable<string>,
): boolean {
  if (!isSynthesisQuery(query)) return false;
  const seen = new Set(distinctEntryIds);
  return seen.size >= 2;
}
