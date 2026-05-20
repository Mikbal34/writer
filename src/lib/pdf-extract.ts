/**
 * PDF text extraction via pdfjs-dist (Node mode).
 *
 * Replaces the Python PyMuPDF extractor for native-text PDFs. PyMuPDF
 * is fast but occasionally mis-decodes Turkish/Arabic font encodings,
 * leaving the chunk text drifting from what the viewer actually renders
 * — the AI then cites passages the highlighter can't find on the page.
 *
 * pdfjs reads the same /ToUnicode CMaps the browser viewer uses, so
 * server-side extracted text matches what the user sees in the reader
 * pane. Multi-language support (Latin, Turkish, Arabic, Cyrillic,
 * Greek, Hebrew) is solid out of the box.
 *
 * What this module does NOT do:
 *   - OCR for scanned/image-only PDFs. extractPdfPages() flags the
 *     document via needsOcr when too many pages return no text; the
 *     caller (library-pipeline) routes those through the existing
 *     Python /ocr endpoint.
 *   - Advanced layout reconstruction (multi-column reading order,
 *     table extraction). pdfjs reads top-to-bottom by emission order,
 *     which matches the visual text layer; single-column academic
 *     books work fine.
 */

import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// pdfjs spawns a "worker" by dynamically importing pdf.worker.mjs.
// Under Next 16's bundled server output that import resolves to a
// `.next/server/chunks/pdf.worker.mjs` path that is never emitted,
// so EVERY getDocument() throws "Setting up fake worker failed:
// Cannot find module …" and the caller silently falls back to the
// slow Python OCR path — which drops heading + page-label
// extraction (sectionTitle / pdfPageLabel come back NULL on every
// chunk). Railway runs `next start` with node_modules present on
// disk, so the real worker file IS there; we just have to point
// pdfjs at it. Resolve the absolute path via node's own resolver
// and hand pdfjs a file:// URL it can import. Guarded so it only
// runs server-side and only sets the src once.
if (typeof window === "undefined" && !pdfjs.GlobalWorkerOptions.workerSrc) {
  try {
    const req = createRequire(import.meta.url);
    const workerPath = req.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
  } catch (err) {
    console.warn(
      "[pdf-extract] could not resolve pdf.worker.mjs — extraction will fall back to OCR:",
      err instanceof Error ? err.message : err,
    );
  }
}

export interface ExtractedPage {
  /** 1-indexed PDF page number (matches pdfjs's getPage(N) and what
   *  the viewer toolbar shows). */
  pageNumber: number;
  /** Printed book page label from the PDF's /PageLabels tree. NULL
   *  when the PDF doesn't carry labels — citation surfaces fall
   *  back to pageNumber in that case. */
  pageLabel: string | null;
  /** Closest preceding section heading detected during extraction
   *  (e.g. "Chapter 3", "BÖLÜM 2: KAVRAMSAL ÇERÇEVE"). Propagates
   *  forward to subsequent pages until the next heading is seen.
   *  NULL until a first heading is found. */
  sectionTitle: string | null;
  /** Cleaned per-page text (page-number lines, separators stripped). */
  content: string;
}

export interface ExtractResult {
  pages: ExtractedPage[];
  totalPages: number;
  /** True when more than half the pages came back with insufficient
   *  text — signals that the document is image-only and the caller
   *  should re-extract via OCR. */
  needsOcr: boolean;
}

const MIN_TEXT_CHARS = 30;

interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
}

function textContentToString(items: unknown[]): string {
  let out = "";
  for (const raw of items) {
    const item = raw as PdfTextItem;
    if (typeof item.str !== "string") continue;
    out += item.str;
    if (item.hasEOL) out += "\n";
  }
  return out;
}

// ── Junk-page detection ───────────────────────────────────────────
// Patterns that flag a page as front-matter / TOC / back-matter
// rather than real book content. Embedding such pages produces
// high-similarity false positives (the book title + author are
// stamped on the colophon, so a generic "bu kitap" query matches
// the colophon more strongly than the actual argument pages).
// Filtering them out cleans both the chunk corpus and the prompts
// the LLM eventually sees.

const FRONT_MATTER_PATTERNS = [
  /\bISBN[-\s]*1?[03]?[:\s]/i,
  /\bcopyright\b/i,
  /©.*?(?:all rights reserved|reserved)/i,
  /library of congress/i,
  /cataloging[- ]in[- ]publication/i,
  /printed in/i,
  /first published/i,
  /(?:tüm|bütün) hakları saklıdır/i,
  /yayınevi sertifika/i,
  /matbaa sertifika/i,
  /\bbaskı\s*:|baskı ve cilt|kapak (?:tasarım|tasarımı)/i,
  /yayına hazırlayan/i,
  /yayın yönetmeni/i,
  /metis yayınları|i̇leti̇şi̇m yayınları|i̇mge ki̇tabevi̇|alfa yayınları|i̇nkılâp/i,
  // Arabic publication / copyright phrases — classical Arabic works
  // (Maturidi corpus, Ghazali editions) carry their colophons in
  // Arabic, so the English/Turkish patterns alone don't catch the
  // front matter and it ends up embedded as retrievable content.
  /جميع الحقوق محفوظة/, // "all rights reserved"
  /\bدار\s+(?:النشر|الكتب|الفكر|الكتاب|المعارف)\b/, // "House of (Press/Books/Thought/Knowledge)"
  /\bمكتبة\s+\S+/, // "Library of …"
  /\bالناشر\s*:/, // "Publisher:"
  /\bرقم\s*الإيداع/, // "deposit number" — ISBN/registration equivalent
  /\bالطبعة\s+(?:الأولى|الثانية|الثالثة|الرابعة)/, // "First/Second/Third/Fourth edition"
];

const TOC_HEADINGS = [
  /^\s*içindekiler\s*$/i,
  /^\s*contents\s*$/i,
  /^\s*table of contents\s*$/i,
  /^\s*fihrist\s*$/i,
  // Arabic — "the index / contents" (Modern Standard Arabic and
  // classical-era variants both appear in the corpus).
  /^\s*الفهرس\s*$/,
  /^\s*فهرس\s+(?:المحتويات|المواضيع|الكتاب)\s*$/,
  /^\s*المحتويات\s*$/,
];

const BACK_MATTER_HEADINGS = [
  /^\s*kaynak[çc]a\s*$/i,
  /^\s*bibliography\s*$/i,
  /^\s*references\s*$/i,
  /^\s*works cited\s*$/i,
  /^\s*dizin\s*$/i,
  /^\s*index\s*$/i,
  /^\s*notes?\s*$/i,
  // Arabic — bibliography / source list / index. Classical works
  // sometimes also use "ثبت المصادر" (lit. "register of sources").
  /^\s*(?:المصادر(?: والمراجع)?|قائمة المصادر|ثبت المصادر)\s*$/,
  /^\s*المراجع\s*$/,
  /^\s*الكشاف\s*$/, // analytical index
];

function isFrontMatterPage(text: string, pageNumber: number): boolean {
  if (pageNumber > 10) return false;
  let hits = 0;
  for (const re of FRONT_MATTER_PATTERNS) {
    if (re.test(text)) hits++;
    if (hits >= 2) return true;
  }
  return false;
}

function isTOCPage(text: string): boolean {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return false;
  if (lines.slice(0, 3).some((l) => TOC_HEADINGS.some((re) => re.test(l)))) {
    return true;
  }
  if (lines.length < 8) return false;
  // Heuristic: >50% of lines end with a page-number-shaped token —
  // catches TOC continuation pages even when the heading itself
  // only appears on the first one.
  const numericLines = lines.filter(
    (l) => /[.\s]\d{1,4}\s*$/.test(l) && l.length > 4,
  ).length;
  return numericLines / lines.length > 0.5;
}

// Heading detection: returns the first line on the page that looks
// like a chapter / section heading, or null if there isn't one.
// Heuristics (combined):
//   - "BÖLÜM N", "CHAPTER N", "Kısım N" all-caps or title-case
//   - "1.", "1.1", "1.1.1" numeric prefixes followed by a title
//   - lines that are all-caps and 8-80 chars (typical chapter heads)
//   - "PART I", "PART II" roman numerals
// Excludes:
//   - lines that look like page numbers, ISBNs, dates
//   - long sentence lines (>100 chars with multiple sentences)
const HEADING_PATTERNS: RegExp[] = [
  /^\s*(?:BÖLÜM|B[oö]l[uü]m|CHAPTER|Chapter|KISIM|K[iı]s[iı]m|PART|Part|SECTION|Section)\s+(?:[0-9IVXLCM]+|BIR|İKİ|ÜÇ|DÖRT|BEŞ)\b.{0,100}$/,
  /^\s*[0-9]+\.[0-9]+(?:\.[0-9]+)?\s+\S.{2,80}$/, // 1.1 Heading, 2.3.1 Heading
  /^\s*[0-9]+\.?\s+[A-ZÇŞĞÜÖİ][A-ZÇŞĞÜÖİ\s]{4,80}$/, // 1. ALL CAPS
  // Arabic chapter/section structure: book ("الباب"), chapter
  // ("الفصل"), section ("القسم"), subsection ("المبحث"), part
  // ("الجزء"). The ordinals can be either Arabic numerals ("الأول")
  // or Western digits stamped alongside ("الفصل 1").
  /^\s*(?:الباب|الفصل|القسم|المبحث|الجزء)\s+(?:الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|[0-9٠-٩]+)\b.{0,100}$/,
];

function detectHeading(text: string): string | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  // Look at the first 10 lines (headings sit at the top, but a
  // header strip residual / standalone page number may consume the
  // first 1-2 lines before the real heading appears).
  const candidates = lines.slice(0, 10);
  for (const line of candidates) {
    if (line.length < 4 || line.length > 100) continue;
    // Skip lines that are obviously chrome rather than headings.
    if (/^\d+$/.test(line)) continue; // bare page number "189"
    if (/^\d+\s+\d+$/.test(line)) continue; // split page number "1 89"
    if (/^[Pp]age\s+\d/.test(line)) continue;
    for (const re of HEADING_PATTERNS) {
      if (re.test(line)) return line;
    }
    // All-caps heading heuristic — must use Turkish-locale case
    // mapping so İ/ı vs I/i ordering doesn't false-negative on
    // Turkish chapter titles ("KENDİSİYLE SAVAŞAN SİSTEM", "DIŞ
    // SINIRLAR"). Default toUpperCase() converts İ→İ (no-op) but
    // ı→I, which then fails the strict identity check below.
    const letters = line.replace(/[^A-Za-zÇŞĞÜÖİçşğüöı]/g, "");
    if (letters.length < 6 || letters.length > 60) continue;
    if (/\d{2,}/.test(line)) continue;
    let isAllCaps: boolean;
    try {
      isAllCaps = letters === letters.toLocaleUpperCase("tr");
    } catch {
      isAllCaps = letters === letters.toUpperCase();
    }
    if (isAllCaps) return line;
  }
  return null;
}

function isBackMatterStart(text: string): boolean {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines
    .slice(0, 5)
    .some((l) => BACK_MATTER_HEADINGS.some((re) => re.test(l)));
}

// Drop headers / footers that repeat across pages (book title in
// the top margin, page-number band at the bottom, etc.) by spotting
// any first/last line that appears in >=30% of the pages — those
// are almost certainly chrome rather than content.
function stripRepeatingHeaderFooter(
  pages: Array<{ pageNumber: number; raw: string }>,
): void {
  const firstFreq = new Map<string, number>();
  const lastFreq = new Map<string, number>();
  for (const p of pages) {
    const lines = p.raw.split("\n").map((l) => l.trim()).filter(Boolean);
    const first = lines[0];
    const last = lines[lines.length - 1];
    if (first && first.length >= 3 && first.length <= 120) {
      firstFreq.set(first, (firstFreq.get(first) ?? 0) + 1);
    }
    if (last && last !== first && last.length >= 3 && last.length <= 120) {
      lastFreq.set(last, (lastFreq.get(last) ?? 0) + 1);
    }
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.3));
  const repeatedFirsts = new Set(
    [...firstFreq.entries()].filter(([, n]) => n >= threshold).map(([k]) => k),
  );
  const repeatedLasts = new Set(
    [...lastFreq.entries()].filter(([, n]) => n >= threshold).map(([k]) => k),
  );
  if (repeatedFirsts.size === 0 && repeatedLasts.size === 0) return;
  for (const p of pages) {
    const lines = p.raw.split("\n");
    let start = 0;
    while (start < lines.length && lines[start].trim() === "") start++;
    if (start < lines.length && repeatedFirsts.has(lines[start].trim())) {
      lines[start] = "";
    }
    let end = lines.length - 1;
    while (end > start && lines[end].trim() === "") end--;
    if (end > start && repeatedLasts.has(lines[end].trim())) {
      lines[end] = "";
    }
    p.raw = lines.join("\n");
  }
}

function cleanPageText(text: string): string {
  // Postgres UTF-8 columns reject NUL bytes — strip before any
  // downstream insert can fail on them.
  let t = text.replace(/\u0000/g, "");
  const lines = t.split("\n");
  const cleaned: string[] = [];
  for (const line of lines) {
    const stripped = line.trim();
    // Lone page numbers / "Page X of Y" / separator runs are pure
    // chrome and confuse downstream chunking. Two extra forms PDFs
    // emit a lot: split-digit page numbers ("1 89" instead of
    // "189") and "page-number + book-title in same line" headers
    // ("186 SAFLIK VE TEHLİKE") that survive the cross-page header
    // strip when each page has a different number on the front.
    if (/^\d{1,4}$/.test(stripped)) continue;
    if (/^\d{1,4}(?:\s+\d{1,4})+$/.test(stripped)) continue;
    if (
      /^\d{1,4}\s+[A-ZÇŞĞÜÖİ][A-ZÇŞĞÜÖİ\s]{4,}$/.test(stripped) ||
      /^[A-ZÇŞĞÜÖİ][A-ZÇŞĞÜÖİ\s]{4,}\s+\d{1,4}$/.test(stripped)
    ) continue;
    if (/^[Pp]age\s+\d+\s+(?:of|\/)\s+\d+$/.test(stripped)) continue;
    if (/^[-_=]{3,}$/.test(stripped)) continue;
    cleaned.push(line);
  }
  t = cleaned.join("\n");
  // Collapse 3+ blank lines into a paragraph break.
  t = t.replace(/\n{3,}/g, "\n\n");
  // Repair end-of-line hyphenation: PDFs wrap long words across
  // lines as "regu-\nlation" / "siy-\nasal". The chunk would
  // otherwise hold "regu lation", which embedding sees as two tiny
  // tokens — fatal for both vector match and the AI-quote
  // highlighter that scans the text layer for an exact phrase.
  // Restrict to letter-letter pairs so legitimate compound hyphens
  // (Kant-Hegel) survive when the hyphen isn't at end-of-line.
  t = t.replace(/([A-Za-zçÇşŞğĞıİöÖüÜ])-\n([a-zçşğıöü])/g, "$1$2");
  return t;
}

/**
 * Extract text page-by-page from a PDF buffer using pdfjs.
 *
 * @param buffer Raw PDF bytes
 * @param options.maxPages Cap on pages to read (used by bibliography
 *   pre-pass to avoid parsing 800-page books for metadata)
 */
export async function extractPdfPages(
  buffer: Buffer | Uint8Array,
  options: { maxPages?: number } = {},
): Promise<ExtractResult> {
  // Force a *plain* Uint8Array view, even when the caller passed a
  // Node Buffer. Buffer IS-A Uint8Array semantically (subclass) so
  // the naive `buffer instanceof Uint8Array ? buffer : …` check
  // takes the first branch and forwards the Buffer untouched —
  // but pdfjs-dist 5.x has an internal Uint8Array constructor-
  // identity check that rejects Buffer instances under Next 16's
  // bundling. Always rebuilding a view over the same ArrayBuffer
  // slice gives us zero-copy bytes with the canonical prototype
  // pdfjs is looking for. Symptom this fixes: "Please provide
  // binary data as `Uint8Array`, rather than `Buffer`" thrown for
  // every PDF upload, forcing the slow Python OCR fallback.
  const data = ArrayBuffer.isView(buffer)
    ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    : new Uint8Array(buffer);

  const loadingTask = pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
  });

  let doc;
  try {
    doc = await loadingTask.promise;
  } catch (err) {
    try {
      await loadingTask.destroy();
    } catch {
      /* ignore */
    }
    throw err;
  }

  try {
    const total = doc.numPages;
    const limit =
      options.maxPages && options.maxPages > 0
        ? Math.min(options.maxPages, total)
        : total;

    // Best-effort page label retrieval — falls back to empty array
    // when the PDF doesn't expose /PageLabels.
    let labels: string[] = [];
    try {
      const raw = await doc.getPageLabels();
      labels = Array.isArray(raw) ? raw : [];
    } catch {
      labels = [];
    }

    // Two passes: (1) pull raw text from every page, (2) clean +
    // junk-filter using cross-page information. The header/footer
    // stripper needs to see all pages to decide what's repeating
    // chrome vs real content, so we can't merge the passes.
    const rawPages: Array<{ pageNumber: number; raw: string }> = [];
    let thinPages = 0;
    let pagesAttempted = 0;
    for (let i = 1; i <= limit; i++) {
      let raw = "";
      try {
        const page = await doc.getPage(i);
        const tc = await page.getTextContent({
          includeMarkedContent: false,
          disableNormalization: false,
        });
        raw = textContentToString(tc.items);
        try {
          page.cleanup();
        } catch {
          /* ignore */
        }
      } catch {
        thinPages++;
        pagesAttempted++;
        continue;
      }
      pagesAttempted++;
      rawPages.push({ pageNumber: i, raw });
    }

    // Cross-page header/footer suppression — finds lines that repeat
    // in the same position across most pages (book title, chapter
    // name, page number band) and silences them.
    stripRepeatingHeaderFooter(rawPages);

    const pages: ExtractedPage[] = [];
    let inBackMatter = false;
    let droppedFront = 0;
    let droppedTOC = 0;
    let droppedBack = 0;
    // Carries forward to subsequent pages until a new heading is
    // spotted, so every chunk that sits under a heading inherits it.
    let currentSection: string | null = null;
    for (const { pageNumber, raw } of rawPages) {
      const cleaned = cleanPageText(raw);
      if (cleaned.trim().length < MIN_TEXT_CHARS) {
        thinPages++;
        continue;
      }

      // Front-matter detection — only checked in the first 10 pages
      // (colophons / copyright / ISBN). Inside isFrontMatterPage.
      if (isFrontMatterPage(cleaned, pageNumber)) {
        droppedFront++;
        continue;
      }

      // Table of contents: starts with a heading or shows the dot-
      // leader page-number pattern in most lines.
      if (isTOCPage(cleaned)) {
        droppedTOC++;
        continue;
      }

      // Once we hit a back-matter heading (Bibliography / Index /
      // Kaynakça / Dizin), everything from that page onwards is
      // reference apparatus rather than content.
      if (inBackMatter || isBackMatterStart(cleaned)) {
        inBackMatter = true;
        droppedBack++;
        continue;
      }

      // Update the running section header before emitting the page —
      // a new heading on this page means subsequent chunks (and
      // chunks on later pages until the next heading) belong to it.
      const pageHeading = detectHeading(cleaned);
      if (pageHeading) currentSection = pageHeading;

      pages.push({
        pageNumber,
        pageLabel: labels[pageNumber - 1] || null,
        sectionTitle: currentSection,
        content: cleaned,
      });
    }

    if (droppedFront + droppedTOC + droppedBack > 0) {
      console.info(
        "[pdf-extract] junk pages dropped:",
        `front=${droppedFront} toc=${droppedTOC} back=${droppedBack}`,
      );
    }

    const needsOcr =
      pagesAttempted > 0 && thinPages / pagesAttempted > 0.5;

    return { pages, totalPages: total, needsOcr };
  } finally {
    try {
      await doc.destroy();
    } catch {
      /* ignore */
    }
  }
}
