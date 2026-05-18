/**
 * Text chunking — node port of python-service/services/chunker.py.
 *
 * Splits per-page text into overlapping chunks that respect sentence
 * and paragraph boundaries. Used by the library extraction pipeline
 * once it pulls page text via pdfjs (src/lib/pdf-extract.ts).
 *
 * Kept ~byte-identical to the Python implementation so we can roll
 * back to the Python service if anything regresses — the chunk-level
 * embedding output is downstream of this and won't notice as long as
 * the cleanup + split boundaries match.
 */

export interface ChunkerInputPage {
  pageNumber: number;
  pageLabel?: string | null;
  content: string;
}

export interface ChunkerOutput {
  pageNumber: number;
  pageLabel: string | null;
  chunkIndex: number;
  content: string;
}

export interface ChunkOptions {
  chunkSize?: number;
  overlap?: number;
}

/**
 * Split each page's text into overlapping chunks.
 *
 * Default sizing mirrors the Python defaults so embedding token
 * budgets stay aligned.
 */
export function chunkByPage(
  pages: ChunkerInputPage[],
  options: ChunkOptions = {},
): ChunkerOutput[] {
  const chunkSize = options.chunkSize ?? 1000;
  const overlap = options.overlap ?? 200;
  const out: ChunkerOutput[] = [];

  for (const page of pages) {
    // Postgres UTF-8 columns reject NUL bytes; strip both at page-text
    // level and after the split (belt + braces — _split_text returns
    // substrings of the input but anything leaking through here kills
    // a whole batch insert).
    const text = (page.content ?? "").replace(/\u0000/g, "");
    if (!text.trim()) continue;

    const pieces = splitText(text, chunkSize, overlap);
    for (let i = 0; i < pieces.length; i++) {
      const cleaned = pieces[i].replace(/\u0000/g, "");
      if (!cleaned.trim()) continue;
      out.push({
        pageNumber: page.pageNumber,
        pageLabel: page.pageLabel ?? null,
        chunkIndex: i,
        content: cleaned,
      });
    }
  }

  return out;
}

function splitText(text: string, chunkSize: number, overlap: number): string[] {
  if (text.length <= chunkSize) return [text];

  const sentences = splitIntoSentences(text);
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const sentence of sentences) {
    const sLen = sentence.length;

    // If a single sentence exceeds chunkSize, flush what we have and
    // hard-split the long sentence at chunkSize windows.
    if (sLen > chunkSize) {
      if (current.length > 0) {
        chunks.push(current.join(" "));
        current = [];
        currentLen = 0;
      }
      const step = Math.max(1, chunkSize - overlap);
      for (let i = 0; i < sLen; i += step) {
        chunks.push(sentence.slice(i, i + chunkSize));
      }
      continue;
    }

    // Adding this sentence would overflow — emit the current chunk
    // first, then start a new one seeded with overlap from the tail.
    if (currentLen + sLen + 1 > chunkSize && current.length > 0) {
      chunks.push(current.join(" "));
      const overlapText = buildOverlap(current, overlap);
      current = overlapText ? [overlapText] : [];
      currentLen = overlapText.length;
    }

    current.push(sentence);
    currentLen += sLen + 1; // +1 for the joining space
  }

  if (current.length > 0) chunks.push(current.join(" "));
  return chunks;
}

function splitIntoSentences(text: string): string[] {
  // First split on paragraph boundaries (blank lines).
  const paragraphs = text.split(/\n\s*\n/);
  const out: string[] = [];
  for (const rawPara of paragraphs) {
    const para = rawPara.trim();
    if (!para) continue;
    // Sentence boundary: punctuation + whitespace + uppercase-or-
    // open-quote. Matches the Python regex (covers Latin uppercase,
    // Latin-1 Supplement, Latin Extended, Cyrillic, plus opening
    // quotes/parens — handles common abbreviations OK).
    const parts = para.split(
      /(?<=[.!?])\s+(?=[A-ZÀ-ɏЀ-ӿ"'(])/u,
    );
    for (const part of parts) {
      const p = part.trim();
      if (p) out.push(p);
    }
  }
  return out;
}

function buildOverlap(chunks: string[], target: number): string {
  if (chunks.length === 0 || target <= 0) return "";
  const result: string[] = [];
  let total = 0;
  for (let i = chunks.length - 1; i >= 0; i--) {
    const s = chunks[i];
    if (total + s.length > target && result.length > 0) break;
    result.unshift(s);
    total += s.length + 1;
  }
  return result.join(" ");
}
