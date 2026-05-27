/**
 * Citation Accuracy Validator — yazı output'unda atıf markerlerini doğrula.
 *
 * Akademik writing'in en kritik moat'ı: AI uyduruk atıf yapamasın.
 * Sonnet [cite:bibId,p=45] ve [fn:...] markerleri üretir. Bu modül:
 *   1. Output text'i parse → tüm citation markers
 *   2. Each marker'ın bibId allowed listede mi (SourceMapping)
 *   3. Page numarası geçerli mi (chunk page metadata)
 *   4. Fabricated marker oranını döndür
 *
 * Şu an ÖLÇÜM odaklı (sistemi değiştirmiyor, sadece görüyor). Stage 2'de
 * prompt'a "ALLOWED_CITATIONS" enforce eder, Stage 3'te reviewer regenerate.
 */

export interface ParsedCitation {
  raw: string;          // tam marker: "[cite:bib_xxx,p=45]"
  bibId: string;        // "bib_xxx"
  page: string | null;  // "45" or null
}

export interface FootnoteCitation {
  raw: string;          // "[fn: tam atıf metni]"
  text: string;         // "Wolfson, Philosophy of Kalam, s.45..."
}

export interface ValidationInput {
  /** Sonnet output'u (full subsection content) */
  text: string;
  /** Subsection'a bağlı bibliography ID'leri (allowed list) */
  allowedBibIds: string[];
  /** Retrieve edilen chunk'ların sayfa metadata'sı — page validation için */
  knownPages?: Array<{ bibId?: string | null; pageNumber: number | null; pdfPageLabel: string | null }>;
}

export interface ValidationResult {
  totalCiteMarkers: number;
  totalFootnotes: number;
  /** [cite:bibId] markerlerden allowed listede olanlar */
  validCiteMarkers: number;
  fabricatedBibIds: ParsedCitation[];
  /** %0-100 fabricated rate */
  fabricatedRate: number;
  /** Page numarası eşleştirilemeyenler */
  unknownPages: ParsedCitation[];
  /** Markdown-friendly özet */
  summary: string;
}

/**
 * Parse [cite:bib_xxx,p=45] veya [cite:bib_xxx] markerleri.
 */
export function parseCitations(text: string): ParsedCitation[] {
  // [cite:bibId] veya [cite:bibId,p=...]
  const re = /\[cite:([a-zA-Z0-9_-]+)(?:,\s*p\s*=\s*([^\],]+))?\]/g;
  const out: ParsedCitation[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({
      raw: m[0],
      bibId: m[1],
      page: m[2]?.trim() ?? null,
    });
  }
  return out;
}

/**
 * Parse [fn: tam metin] footnote-style markerleri.
 */
export function parseFootnotes(text: string): FootnoteCitation[] {
  const re = /\[fn:\s*([^\]]+?)\s*\]/g;
  const out: FootnoteCitation[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ raw: m[0], text: m[1].trim() });
  }
  return out;
}

/**
 * Output'u allowed bib listesi ve chunk page'lerine karşı doğrula.
 */
export function validateCitations(input: ValidationInput): ValidationResult {
  const citeMarkers = parseCitations(input.text);
  const footnotes = parseFootnotes(input.text);
  const allowed = new Set(input.allowedBibIds);
  const fabricated = citeMarkers.filter((c) => !allowed.has(c.bibId));
  const valid = citeMarkers.length - fabricated.length;

  // Page validation — eğer chunk metadata varsa
  const unknownPages: ParsedCitation[] = [];
  if (input.knownPages && input.knownPages.length > 0) {
    const pagesByBib = new Map<string, Set<string>>();
    for (const p of input.knownPages) {
      const key = p.bibId ?? "_any";
      if (!pagesByBib.has(key)) pagesByBib.set(key, new Set());
      if (p.pdfPageLabel) pagesByBib.get(key)!.add(p.pdfPageLabel);
      if (p.pageNumber !== null) pagesByBib.get(key)!.add(String(p.pageNumber));
    }
    for (const c of citeMarkers) {
      if (!c.page) continue;
      const set = pagesByBib.get(c.bibId);
      if (set && !set.has(c.page)) {
        unknownPages.push(c);
      }
    }
  }

  const fabricatedRate = citeMarkers.length > 0
    ? fabricated.length / citeMarkers.length
    : 0;

  const summary = citeMarkers.length === 0 && footnotes.length === 0
    ? "no citations found"
    : `${valid}/${citeMarkers.length} cite markers valid` +
      (fabricated.length > 0 ? ` · ${fabricated.length} FABRICATED bibId` : "") +
      (unknownPages.length > 0 ? ` · ${unknownPages.length} unknown page` : "") +
      (footnotes.length > 0 ? ` · ${footnotes.length} [fn:] (unstructured)` : "");

  return {
    totalCiteMarkers: citeMarkers.length,
    totalFootnotes: footnotes.length,
    validCiteMarkers: valid,
    fabricatedBibIds: fabricated,
    fabricatedRate,
    unknownPages,
    summary,
  };
}
