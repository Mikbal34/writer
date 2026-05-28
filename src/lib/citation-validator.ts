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
  /** [fn:] markerleri prompt'ta yasak — varsa protocol violation */
  fnViolations: number;
  /** Inline akademik künye stringi detection (Author, Title (Publisher, Year), Page) */
  inlineKunyeViolations: number;
  /** Coverage: kaç allowed bibId en az 1 cite aldı / toplam allowed */
  coverage: { cited: number; total: number; missing: string[] };
  /** <!-- coverage-note: bib_xxx — ... --> HTML yorumlarından parse */
  coverageNotes: Array<{ bibId: string; reason: string }>;
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
 * Inline akademik künye stringi tanı — prompt yasakladı ama model
 * akademik refleksle yine de yazabiliyor. Patternlar (sırasıyla):
 *   - "Adı Soyadı, *Başlık* (Yer: Yayınevi, Yıl), Sayfa." (Chicago/ISNAD)
 *   - "Surname, Title (Place: Publisher, Year), page"
 * En sade ayırt edici: parantezli "( ... : ..., YYYY)" + sonrasında
 * sayfa numarası. False positive'i azaltmak için en az 4 virgül
 * ayrılmış parça arar.
 */
export function detectInlineKunye(text: string): number {
  // (Yer: Yayınevi, 1976), 261 → tipik signature
  const re = /\([^)]{3,80}:[^)]{3,80},\s*\d{4}\)\s*,\s*\d{1,4}/g;
  return (text.match(re) ?? []).length;
}

/**
 * <!-- coverage-note: bib_xxx — açıklama --> formatından parse.
 */
export function parseCoverageNotes(text: string): Array<{ bibId: string; reason: string }> {
  const re = /<!--\s*coverage-note:\s*([a-zA-Z0-9_-]+)\s*[—:-]\s*([^>]+?)-->/g;
  const out: Array<{ bibId: string; reason: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ bibId: m[1], reason: m[2].trim() });
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

  // Coverage: kaç allowed bibId en az 1 cite aldı?
  const citedBibIds = new Set(citeMarkers.filter((c) => allowed.has(c.bibId)).map((c) => c.bibId));
  const missing = input.allowedBibIds.filter((id) => !citedBibIds.has(id));
  const coverage = {
    cited: citedBibIds.size,
    total: input.allowedBibIds.length,
    missing,
  };

  const coverageNotes = parseCoverageNotes(input.text);
  const inlineKunyeViolations = detectInlineKunye(input.text);
  const fnViolations = footnotes.length;

  const fabricatedRate = citeMarkers.length > 0
    ? fabricated.length / citeMarkers.length
    : 0;

  const violations: string[] = [];
  if (fabricated.length > 0) violations.push(`${fabricated.length} FABRICATED bibId`);
  if (fnViolations > 0) violations.push(`${fnViolations} [fn:] PROTOCOL violation`);
  if (inlineKunyeViolations > 0) violations.push(`${inlineKunyeViolations} INLINE KÜNYE`);
  if (unknownPages.length > 0) violations.push(`${unknownPages.length} unknown page`);
  const coveragePart = input.allowedBibIds.length > 0
    ? ` · coverage ${coverage.cited}/${coverage.total}${missing.length > 0 ? ` (missing: ${missing.length})` : ""}`
    : "";
  const summary = citeMarkers.length === 0 && footnotes.length === 0 && inlineKunyeViolations === 0
    ? `no citations found${coveragePart}`
    : `${valid}/${citeMarkers.length} cite markers valid${coveragePart}` +
      (violations.length > 0 ? ` · ${violations.join(" · ")}` : "");

  return {
    totalCiteMarkers: citeMarkers.length,
    totalFootnotes: footnotes.length,
    validCiteMarkers: valid,
    fabricatedBibIds: fabricated,
    fabricatedRate,
    unknownPages,
    fnViolations,
    inlineKunyeViolations,
    coverage,
    coverageNotes,
    summary,
  };
}
