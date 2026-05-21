/**
 * Deterministic style features for the writing-twin eval.
 *
 * LLM "does this match the voice?" judging is noisy; measurable
 * surface features are exact and let us compare a generated
 * paragraph against the author's real samples apples-to-apples.
 * Language-rough on purpose (works across TR/EN/AR by splitting on
 * Unicode letters + sentence punctuation) — we only ever compare
 * texts in the SAME language, so absolute calibration doesn't
 * matter, only the generated-vs-reference delta.
 */

export interface StyleFeatures {
  /** words per sentence, mean */
  avgSentenceLen: number;
  /** stdev of sentence length — captures rhythm/variation */
  sentenceLenStd: number;
  /** sentences per paragraph */
  avgParagraphLen: number;
  /** unique / total words over a normalized 400-word window (0-1) */
  typeTokenRatio: number;
  /** commas per sentence */
  commaDensity: number;
  /** semicolons per 1000 words */
  semicolonPer1k: number;
  /** long words (≥9 chars) / total words — terminology-density proxy */
  longWordRatio: number;
  /** first-person pronoun hits per sentence (TR + EN) */
  firstPersonRate: number;
  /** raw counts for context */
  totalWords: number;
  totalSentences: number;
}

const FIRST_PERSON = /\b(ben|biz|bana|bize|benim|bizim|I|we|me|us|my|our|myself|ourselves)\b/giu;

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/[.!?…]+(?:\s|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function words(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function computeStyleFeatures(text: string): StyleFeatures {
  const clean = (text ?? "").trim();
  const sentences = splitSentences(clean);
  const allWords = words(clean);
  const paragraphs = clean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  const sentWordCounts = sentences.map((s) => words(s).length).filter((n) => n > 0);
  const avgSentenceLen =
    sentWordCounts.length > 0
      ? sentWordCounts.reduce((a, b) => a + b, 0) / sentWordCounts.length
      : 0;
  const variance =
    sentWordCounts.length > 1
      ? sentWordCounts.reduce((a, n) => a + (n - avgSentenceLen) ** 2, 0) /
        sentWordCounts.length
      : 0;
  const sentenceLenStd = Math.sqrt(variance);

  const avgParagraphLen =
    paragraphs.length > 0 ? sentences.length / paragraphs.length : sentences.length;

  // Type-token ratio over a fixed window so length doesn't skew it.
  const window = allWords.slice(0, 400).map((w) => w.toLowerCase());
  const typeTokenRatio =
    window.length > 0 ? new Set(window).size / window.length : 0;

  const commaCount = (clean.match(/,/g) ?? []).length;
  const commaDensity = sentences.length > 0 ? commaCount / sentences.length : 0;

  const semicolonCount = (clean.match(/;/g) ?? []).length;
  const semicolonPer1k =
    allWords.length > 0 ? (semicolonCount / allWords.length) * 1000 : 0;

  const longWords = allWords.filter((w) => w.length >= 9).length;
  const longWordRatio = allWords.length > 0 ? longWords / allWords.length : 0;

  const firstPersonHits = (clean.match(FIRST_PERSON) ?? []).length;
  const firstPersonRate =
    sentences.length > 0 ? firstPersonHits / sentences.length : 0;

  return {
    avgSentenceLen: round(avgSentenceLen),
    sentenceLenStd: round(sentenceLenStd),
    avgParagraphLen: round(avgParagraphLen),
    typeTokenRatio: round(typeTokenRatio, 3),
    commaDensity: round(commaDensity, 2),
    semicolonPer1k: round(semicolonPer1k, 2),
    longWordRatio: round(longWordRatio, 3),
    firstPersonRate: round(firstPersonRate, 3),
    totalWords: allWords.length,
    totalSentences: sentences.length,
  };
}

function round(n: number, places = 1): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

// Features that define "voice match" + a sensible scale to
// normalize each difference (so a 5-word sentence-length gap and a
// 0.1 TTR gap are weighted comparably).
const MATCH_FEATURES: Array<{ key: keyof StyleFeatures; scale: number }> = [
  { key: "avgSentenceLen", scale: 8 },
  { key: "sentenceLenStd", scale: 6 },
  { key: "avgParagraphLen", scale: 3 },
  { key: "typeTokenRatio", scale: 0.15 },
  { key: "commaDensity", scale: 1.2 },
  { key: "semicolonPer1k", scale: 6 },
  { key: "longWordRatio", scale: 0.12 },
  { key: "firstPersonRate", scale: 0.5 },
];

export interface StyleComparison {
  reference: StyleFeatures;
  generated: StyleFeatures;
  perFeature: Array<{ feature: string; reference: number; generated: number; normDiff: number }>;
  /** 0-100; 100 = identical surface style on the measured features */
  matchScore: number;
}

export function compareStyle(
  reference: StyleFeatures,
  generated: StyleFeatures,
): StyleComparison {
  const perFeature = MATCH_FEATURES.map(({ key, scale }) => {
    const r = reference[key] as number;
    const g = generated[key] as number;
    const normDiff = Math.min(1, Math.abs(g - r) / scale);
    return {
      feature: key,
      reference: r,
      generated: g,
      normDiff: round(normDiff, 3),
    };
  });
  const meanDiff =
    perFeature.reduce((a, f) => a + f.normDiff, 0) / perFeature.length;
  return {
    reference,
    generated,
    perFeature,
    matchScore: Math.round((1 - meanDiff) * 100),
  };
}
