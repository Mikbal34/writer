/**
 * Lightweight prose statistics for the Writing Twin analyser.
 *
 * The point isn't precision — it's giving Claude objective numbers it
 * can use as raw input instead of guessing. With these in hand the
 * model commits to `medium` / `long` / `deductive` instead of falling
 * back to `varied` / `mixed` whenever it's unsure.
 *
 * Heuristic-only, no NLP libs. Works for Turkish + English equally
 * well because we lean on punctuation rather than tokenisation.
 */

export interface TextStats {
  // Aggregate counts
  paragraphCount: number;
  sentenceCount: number;
  wordCount: number;

  // Sentence-length distribution (in words)
  avgSentenceWords: number;
  medianSentenceWords: number;
  shortSentencePct: number; // < 15 words
  longSentencePct: number;  // > 25 words

  // Paragraph-length distribution (in sentences)
  avgParagraphSentences: number;
  shortParagraphPct: number; // 1-3 sentences
  longParagraphPct: number;  // 7+ sentences

  // Structure cues
  topicSentenceFirstPct: number;   // paragraphs whose 1st sentence is short + declarative
  deductiveCueHitPct: number;      // paragraphs starting with an enumeration/deductive cue
  inductiveCueHitPct: number;      // paragraphs ending with a conclusion cue

  // Voice & person
  firstPersonHits: number;         // count of 1st-person markers
  passiveLikeHits: number;         // -dı/-mıştır/-mış endings (Turkish passive proxy)

  // Top transition phrases (already observed in the text)
  topTransitions: string[];        // up to 12
}

// Cue lists — kept short, language-mixed. Detection is case-insensitive
// and word-boundary-aware so "İlk olarak" matches but "İlkbahar" doesn't.
const DEDUCTIVE_PREFIX_CUES = [
  'i̇lk olarak', 'ilk olarak', 'birinci olarak', 'ikinci olarak',
  'üçüncü olarak', 'dördüncü olarak', 'beşinci olarak',
  'öncelikle', 'evvela', 'evvelâ',
  'first', 'firstly', 'second', 'secondly', 'third', 'thirdly',
  'in conclusion', 'sonuç olarak', 'son olarak',
];

const INDUCTIVE_END_CUES = [
  'sonuç olarak', 'dolayısıyla', 'bu nedenle', 'bu yüzden',
  'therefore', 'thus', 'hence', 'so', 'in sum',
];

const TRANSITION_CANDIDATES = [
  // Turkish
  'ancak', 'fakat', 'lakin', 'oysa', 'oysaki',
  'ayrıca', 'üstelik', 'kaldı ki', 'nitekim',
  'çünkü', 'zira', 'şöyle ki',
  'bu yüzden', 'bu nedenle', 'bu sebeple',
  'dolayısıyla', 'böylece', 'sonuç olarak', 'kısacası',
  'örneğin', 'mesela', 'söz gelimi', 'sözgelimi',
  'ilk olarak', 'birinci olarak', 'ikinci olarak', 'üçüncü olarak',
  'dördüncü olarak', 'beşinci olarak', 'son olarak', 'öte yandan',
  'aksi halde', 'aksine', 'bunun yanında', 'bununla birlikte',
  // English
  'however', 'moreover', 'furthermore', 'in addition', 'on the other hand',
  'therefore', 'thus', 'hence', 'consequently',
  'for example', 'for instance', 'in particular',
  'first', 'second', 'third', 'finally', 'in conclusion',
];

const FIRST_PERSON_TOKENS = [
  'ben', 'bana', 'benim', 'beni', 'bende', 'benden',
  'biz', 'bize', 'bizim', 'bizi', 'bizde', 'bizden',
  'i ', "i'm", "i'll", "i'd", "i've", 'me ', 'my ', 'we ', 'us ', 'our ',
];

// Crude Turkish passive proxy — modal-final -mıştır / -mış / -dı + -mıştır
// stems that show up in formal academic writing. Far from grammatical,
// but works as a coarse signal.
const PASSIVE_LIKE_RE = /\b\w{2,}(?:mıştır|miştir|muştur|müştür|ılmış|ilmiş|ulmuş|ülmüş|ılır|ilir|ulur|ülür|ılmak|ilmek|ulmak|ülmek)\b/giu;

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function splitSentences(paragraph: string): string[] {
  // Conservative split: . ! ? followed by space + capital letter, or end of
  // string. Won't be perfect with abbreviations but the distribution is
  // what matters for averages, not exact boundaries.
  return paragraph
    .split(/(?<=[.!?])\s+(?=[A-ZÇĞİÖŞÜ"'„«—])/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function wordsOf(s: string): string[] {
  return s.split(/\s+/).filter((w) => w.length > 0);
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

export function computeTextStats(text: string): TextStats {
  const paragraphs = splitParagraphs(text);
  const lower = text.toLowerCase();

  const sentenceLengths: number[] = [];
  const paragraphSentenceCounts: number[] = [];
  let topicFirstCount = 0;
  let deductiveStartCount = 0;
  let inductiveEndCount = 0;

  for (const p of paragraphs) {
    const sentences = splitSentences(p);
    paragraphSentenceCounts.push(sentences.length);

    if (sentences.length > 0) {
      const firstWords = wordsOf(sentences[0]).length;
      // Topic-sentence-first heuristic: opening sentence under 20 words
      // and the paragraph has at least 2 more sentences after it.
      if (firstWords <= 20 && sentences.length >= 2) topicFirstCount++;

      const pStart = sentences[0].toLowerCase().trim();
      if (DEDUCTIVE_PREFIX_CUES.some((cue) => pStart.startsWith(cue))) {
        deductiveStartCount++;
      }

      const pEnd = sentences[sentences.length - 1].toLowerCase().trim();
      if (INDUCTIVE_END_CUES.some((cue) => pEnd.startsWith(cue))) {
        inductiveEndCount++;
      }
    }

    for (const s of sentences) {
      sentenceLengths.push(wordsOf(s).length);
    }
  }

  const totalWords = wordsOf(text).length;
  const sentenceCount = sentenceLengths.length;
  const avgSentenceWords =
    sentenceCount === 0 ? 0 : Math.round(totalWords / sentenceCount);
  const med = median(sentenceLengths);
  const shortS = sentenceLengths.filter((n) => n < 15).length;
  const longS = sentenceLengths.filter((n) => n > 25).length;

  const paragraphCount = paragraphs.length;
  const avgParagraphSentences =
    paragraphCount === 0
      ? 0
      : Math.round(sentenceCount / paragraphCount);
  const shortP = paragraphSentenceCounts.filter((n) => n >= 1 && n <= 3).length;
  const longP = paragraphSentenceCounts.filter((n) => n >= 7).length;

  // Transition frequency — count occurrences of each candidate phrase
  // in the lowercased text, keep the top 12.
  const transitionHits = new Map<string, number>();
  for (const phrase of TRANSITION_CANDIDATES) {
    // Word-boundary regex; phrase may contain spaces.
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|\\s)${escaped}(?=[\\s,.;:!?]|$)`, 'giu');
    const matches = lower.match(re);
    if (matches && matches.length > 0) {
      transitionHits.set(phrase, matches.length);
    }
  }
  const topTransitions = [...transitionHits.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([phrase]) => phrase);

  // First-person + passive-like markers.
  let firstPerson = 0;
  for (const tok of FIRST_PERSON_TOKENS) {
    const re = new RegExp(`\\b${tok.trim()}\\b`, 'gi');
    const m = lower.match(re);
    if (m) firstPerson += m.length;
  }
  const passiveLike = (text.match(PASSIVE_LIKE_RE) ?? []).length;

  const pct = (n: number, total: number) =>
    total === 0 ? 0 : Math.round((n / total) * 100);

  return {
    paragraphCount,
    sentenceCount,
    wordCount: totalWords,
    avgSentenceWords,
    medianSentenceWords: med,
    shortSentencePct: pct(shortS, sentenceCount),
    longSentencePct: pct(longS, sentenceCount),
    avgParagraphSentences,
    shortParagraphPct: pct(shortP, paragraphCount),
    longParagraphPct: pct(longP, paragraphCount),
    topicSentenceFirstPct: pct(topicFirstCount, paragraphCount),
    deductiveCueHitPct: pct(deductiveStartCount, paragraphCount),
    inductiveCueHitPct: pct(inductiveEndCount, paragraphCount),
    firstPersonHits: firstPerson,
    passiveLikeHits: passiveLike,
    topTransitions,
  };
}

/**
 * Aggregate stats across multiple samples for the multi-sample analyser.
 * Pct fields are weighted by the original sentence/paragraph counts so
 * a long sample pulls the means harder than a short one — that's the
 * correct behaviour for "which writing habit is most representative".
 */
export function combineStats(perSample: TextStats[]): TextStats {
  if (perSample.length === 0) {
    return {
      paragraphCount: 0,
      sentenceCount: 0,
      wordCount: 0,
      avgSentenceWords: 0,
      medianSentenceWords: 0,
      shortSentencePct: 0,
      longSentencePct: 0,
      avgParagraphSentences: 0,
      shortParagraphPct: 0,
      longParagraphPct: 0,
      topicSentenceFirstPct: 0,
      deductiveCueHitPct: 0,
      inductiveCueHitPct: 0,
      firstPersonHits: 0,
      passiveLikeHits: 0,
      topTransitions: [],
    };
  }

  const totalP = perSample.reduce((a, s) => a + s.paragraphCount, 0);
  const totalS = perSample.reduce((a, s) => a + s.sentenceCount, 0);
  const totalW = perSample.reduce((a, s) => a + s.wordCount, 0);

  const wAvgSentence = totalS === 0
    ? 0
    : Math.round(perSample.reduce((a, s) => a + s.avgSentenceWords * s.sentenceCount, 0) / totalS);
  const wMedSentence = Math.round(
    perSample.reduce((a, s) => a + s.medianSentenceWords, 0) / perSample.length,
  );
  const wPct = (key: keyof TextStats, total: number) => {
    if (total === 0) return 0;
    const weighted = perSample.reduce((a, s) => {
      const weight = key.startsWith('short') || key.startsWith('long') || key === 'topicSentenceFirstPct' || key === 'deductiveCueHitPct' || key === 'inductiveCueHitPct'
        ? (key === 'shortSentencePct' || key === 'longSentencePct' ? s.sentenceCount : s.paragraphCount)
        : 1;
      return a + (s[key] as number) * weight;
    }, 0);
    return Math.round(weighted / total);
  };

  // Merge transitions across samples — sum hit counts; keep only
  // transitions that appear in at least 2 samples when >1 sample given.
  const tCount = new Map<string, number>();
  for (const s of perSample) for (const t of s.topTransitions) tCount.set(t, (tCount.get(t) ?? 0) + 1);
  const minHits = perSample.length >= 2 ? 2 : 1;
  const topTransitions = [...tCount.entries()]
    .filter(([, n]) => n >= minHits)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([phrase]) => phrase);

  return {
    paragraphCount: totalP,
    sentenceCount: totalS,
    wordCount: totalW,
    avgSentenceWords: wAvgSentence,
    medianSentenceWords: wMedSentence,
    shortSentencePct: wPct('shortSentencePct', totalS),
    longSentencePct: wPct('longSentencePct', totalS),
    avgParagraphSentences: totalP === 0
      ? 0
      : Math.round(totalS / totalP),
    shortParagraphPct: wPct('shortParagraphPct', totalP),
    longParagraphPct: wPct('longParagraphPct', totalP),
    topicSentenceFirstPct: wPct('topicSentenceFirstPct', totalP),
    deductiveCueHitPct: wPct('deductiveCueHitPct', totalP),
    inductiveCueHitPct: wPct('inductiveCueHitPct', totalP),
    firstPersonHits: perSample.reduce((a, s) => a + s.firstPersonHits, 0),
    passiveLikeHits: perSample.reduce((a, s) => a + s.passiveLikeHits, 0),
    topTransitions,
  };
}
