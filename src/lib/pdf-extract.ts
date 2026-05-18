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

export interface ExtractedPage {
  /** 1-indexed PDF page number (matches pdfjs's getPage(N) and what
   *  the viewer toolbar shows). */
  pageNumber: number;
  /** Printed book page label from the PDF's /PageLabels tree. NULL
   *  when the PDF doesn't carry labels — citation surfaces fall
   *  back to pageNumber in that case. */
  pageLabel: string | null;
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

function cleanPageText(text: string): string {
  // Postgres UTF-8 columns reject NUL bytes — strip before any
  // downstream insert can fail on them.
  let t = text.replace(/\u0000/g, "");
  const lines = t.split("\n");
  const cleaned: string[] = [];
  for (const line of lines) {
    const stripped = line.trim();
    // Lone page numbers / "Page X of Y" / separator runs are pure
    // chrome and confuse downstream chunking.
    if (/^\d{1,4}$/.test(stripped)) continue;
    if (/^[Pp]age\s+\d+\s+(?:of|\/)\s+\d+$/.test(stripped)) continue;
    if (/^[-_=]{3,}$/.test(stripped)) continue;
    cleaned.push(line);
  }
  t = cleaned.join("\n");
  // Collapse 3+ blank lines into a paragraph break.
  return t.replace(/\n{3,}/g, "\n\n");
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
  const data =
    buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

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

    const pages: ExtractedPage[] = [];
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
        // Single-page parse failure shouldn't kill the whole extract;
        // count it as a thin page and continue.
        thinPages++;
        pagesAttempted++;
        continue;
      }
      pagesAttempted++;
      const cleaned = cleanPageText(raw);
      if (cleaned.trim().length < MIN_TEXT_CHARS) {
        thinPages++;
        continue;
      }
      pages.push({
        pageNumber: i,
        pageLabel: labels[i - 1] || null,
        content: cleaned,
      });
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
