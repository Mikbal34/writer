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
  /** Section title the page sits under (propagated by pdf-extract).
   *  Copied onto every chunk derived from this page so retrieval
   *  and display surfaces can show a breadcrumb. */
  sectionTitle?: string | null;
  content: string;
}

export interface ChunkerOutput {
  pageNumber: number;
  pageLabel: string | null;
  sectionTitle: string | null;
  chunkIndex: number;
  content: string;
}

export interface ChunkOptions {
  /** Target chunk size in chars (semantic boundaries respected,
   *  so actual size floats between minChunkSize and maxChunkSize). */
  chunkSize?: number;
  /** Overlap (chars) between consecutive chunks for context bleed. */
  overlap?: number;
  /** Below this, an emitted chunk is rolled into the next one rather
   *  than being a standalone fragment. Prevents 12-char "intro" chunks
   *  from polluting retrieval. */
  minChunkSize?: number;
  /** Hard ceiling. We split mid-sentence only as a last resort if a
   *  single paragraph blows past this. */
  maxChunkSize?: number;
}

// Heading regex re-used by chunker for in-page heading splits.
// Mirrors pdf-extract's HEADING_PATTERNS so the boundaries line up.
const CHUNKER_HEADING_PATTERNS: RegExp[] = [
  /^\s*(?:BÖLÜM|B[oö]l[uü]m|CHAPTER|Chapter|KISIM|K[iı]s[iı]m|PART|Part|SECTION|Section)\s+[0-9IVXLCM]+/,
  /^\s*[0-9]+\.[0-9]+(?:\.[0-9]+)?\s+\S/, // 1.1 Heading
];

function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 4 || trimmed.length > 100) return false;
  for (const re of CHUNKER_HEADING_PATTERNS) {
    if (re.test(trimmed)) return true;
  }
  // All-caps standalone line
  const letters = trimmed.replace(/[^A-Za-zÇŞĞÜÖİçşğüöı]/g, "");
  return (
    letters.length >= 6 &&
    letters.length <= 60 &&
    letters === letters.toUpperCase() &&
    !/\d{2,}/.test(trimmed)
  );
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

    const pieces = semanticSplit(text, {
      target: chunkSize,
      overlap,
      min: options.minChunkSize ?? 150,
      max: options.maxChunkSize ?? 1500,
    });
    for (let i = 0; i < pieces.length; i++) {
      const cleaned = pieces[i].replace(/\u0000/g, "");
      if (!cleaned.trim()) continue;
      out.push({
        pageNumber: page.pageNumber,
        pageLabel: page.pageLabel ?? null,
        sectionTitle: page.sectionTitle ?? null,
        chunkIndex: i,
        content: cleaned,
      });
    }
  }

  return out;
}

interface SplitOpts {
  target: number;
  overlap: number;
  min: number;
  max: number;
}

// Semantic split: respect headings and paragraph boundaries when
// possible, fall back to sentence-level split (via splitText) only
// for paragraphs that exceed `max`. Goal: keep each chunk's content
// thematically coherent so embedding quality stays high.
function semanticSplit(text: string, opts: SplitOpts): string[] {
  // First: break the page wherever a heading-shaped line opens a
  // new paragraph block. Headings always start a fresh chunk so
  // the embedding for a chunk doesn't mix two unrelated sections.
  const blocks = splitOnHeadings(text);
  // Pack the blocks into ~target-sized chunks; oversize blocks
  // fall through to the legacy sentence-based splitter.
  return packBlocks(blocks, opts);
}

function splitOnHeadings(text: string): string[] {
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  if (paragraphs.length === 0) return [text];
  const blocks: string[] = [];
  let current: string[] = [];
  for (const para of paragraphs) {
    const firstLine = para.split("\n", 1)[0];
    if (looksLikeHeading(firstLine) && current.length > 0) {
      blocks.push(current.join("\n\n"));
      current = [para];
    } else {
      current.push(para);
    }
  }
  if (current.length > 0) blocks.push(current.join("\n\n"));
  return blocks;
}

function packBlocks(blocks: string[], opts: SplitOpts): string[] {
  const out: string[] = [];
  let buf: string[] = [];
  let bufLen = 0;
  const flush = () => {
    if (buf.length === 0) return;
    out.push(buf.join("\n\n"));
    buf = [];
    bufLen = 0;
  };
  for (const block of blocks) {
    if (block.length > opts.max) {
      // Block exceeds the hard ceiling — flush whatever is pending
      // and sentence-split this monolith with overlap via the
      // legacy splitter (kept around so behavior is well-tested).
      flush();
      const pieces = splitText(block, opts.target, opts.overlap);
      for (const piece of pieces) out.push(piece);
      continue;
    }
    if (bufLen + block.length + 2 > opts.target && bufLen >= opts.min) {
      // Adding this block would overflow target — emit current
      // and seed the next with overlap from the tail of the
      // previously-emitted chunk.
      flush();
      const tail = takeTailOverlap(out[out.length - 1] ?? "", opts.overlap);
      if (tail) {
        buf.push(tail);
        bufLen = tail.length;
      }
    }
    buf.push(block);
    bufLen += block.length + 2;
  }
  flush();
  return out;
}

function takeTailOverlap(text: string, target: number): string {
  if (!text || target <= 0) return "";
  if (text.length <= target) return text;
  const cut = text.slice(-target);
  // Prefer cutting at a sentence boundary inside the tail.
  // [\s\S]* avoids needing the `s` (dotAll) flag for TS targets <ES2018.
  const m = cut.match(/[.!?]\s+(\S[\s\S]*)$/);
  if (m && m.index !== undefined && cut.length - (m.index ?? 0) >= 30) {
    return m[1];
  }
  const space = cut.indexOf(" ");
  return space > 0 ? cut.slice(space + 1) : cut;
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
