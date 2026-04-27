/**
 * Caption + cross-reference + List of Tables / Figures helper.
 *
 * Single source of truth for academic numbering across the export
 * pipeline. The export route runs two passes over the project body:
 *
 *   Pass 1 (registerLabels)  — walk every subsection's parsed markdown
 *       blocks, give each captioned table/figure/chart/mermaid/
 *       equation a sequential number (per kind) and remember the
 *       caption text. `[ref:id]` markers in body prose are also
 *       collected here so the second pass can resolve them.
 *
 *   Pass 2 (resolveRefs)     — replace `[ref:id]` markers with the
 *       proper "Tablo 3" / "Figure 7" / "Eşitlik 2" string per the
 *       project language.
 *
 * Localisation:
 *   - Turkish: Tablo / Şekil / Eşitlik
 *   - English: Table / Figure / Equation
 *
 * The label maps are tiny (`tr`, `en`) — extend when localising
 * beyond those.
 */

export type CaptionKind = 'table' | 'figure' | 'chart' | 'mermaid' | 'equation'

export interface CaptionRecord {
  kind: CaptionKind
  /** 1-based number within the kind. */
  number: number
  caption: string
}

export type CaptionRegistry = Map<string, CaptionRecord>

interface KindCounters {
  table: number
  figure: number
  equation: number
}

export interface RegistryState {
  registry: CaptionRegistry
  counters: KindCounters
}

export function createRegistryState(): RegistryState {
  return {
    registry: new Map(),
    counters: { table: 0, figure: 0, equation: 0 },
  }
}

/**
 * Charts and Mermaid diagrams are rendered as figures, so they
 * increment the figure counter alongside actual `<img>` figures.
 */
function counterKey(kind: CaptionKind): keyof KindCounters {
  if (kind === 'table') return 'table'
  if (kind === 'equation') return 'equation'
  return 'figure'
}

/**
 * Records a caption + its assigned number. Returns the number so the
 * caller can also render the caption inline ("Table 3: ...").
 */
export function registerCaption(
  state: RegistryState,
  kind: CaptionKind,
  refId: string | undefined,
  caption: string | undefined,
): number {
  const key = counterKey(kind)
  state.counters[key]++
  const number = state.counters[key]
  if (refId) {
    state.registry.set(refId, { kind, number, caption: caption ?? '' })
  }
  return number
}

const LABELS = {
  tr: { table: 'Tablo', figure: 'Şekil', equation: 'Eşitlik' },
  en: { table: 'Table', figure: 'Figure', equation: 'Equation' },
} as const

function pickLang(language: string | null | undefined): 'tr' | 'en' {
  return language?.toLowerCase().startsWith('tr') ? 'tr' : 'en'
}

export function captionLabel(
  kind: CaptionKind,
  number: number,
  language: string | null,
): string {
  const lang = pickLang(language)
  const labels = LABELS[lang]
  const word = kind === 'table' ? labels.table
    : kind === 'equation' ? labels.equation
    : labels.figure
  return `${word} ${number}`
}

/**
 * Replace `[ref:abc-123]` markers in body prose with the registered
 * "Table 3" / "Şekil 5" string. Unknown refIds are left as-is so the
 * raw marker shows up in the export and the user notices the typo.
 */
export function resolveCrossRefs(
  text: string,
  state: RegistryState,
  language: string | null,
): string {
  return text.replace(/\[ref:([a-zA-Z0-9_-]+)\]/g, (match, id: string) => {
    const rec = state.registry.get(id)
    if (!rec) return match
    return captionLabel(rec.kind, rec.number, language)
  })
}

/**
 * Returns the formatted caption line as it should appear underneath
 * the table / figure / equation: e.g. "Table 3. Caption text" (APA
 * style) or "Tablo 3: Açıklama" (Turkish convention). The kind
 * determines the label prefix.
 */
export function formatCaption(
  kind: CaptionKind,
  number: number,
  caption: string,
  language: string | null,
): string {
  const label = captionLabel(kind, number, language)
  return caption ? `${label}: ${caption}` : label
}

/**
 * Returns ordered lists for the List of Tables / List of Figures
 * pages. Pages are identified by `kind` (figures include charts +
 * mermaid because they render as figures).
 */
export function captionsByKind(
  state: RegistryState,
  kind: CaptionKind,
): CaptionRecord[] {
  const out: CaptionRecord[] = []
  for (const rec of state.registry.values()) {
    if (kind === 'figure') {
      if (rec.kind === 'figure' || rec.kind === 'chart' || rec.kind === 'mermaid') {
        out.push(rec)
      }
    } else if (rec.kind === kind) {
      out.push(rec)
    }
  }
  out.sort((a, b) => a.number - b.number)
  return out
}

/**
 * "List of Tables" / "List of Figures" / "Equations" page header per
 * language. Localised; uppercase ISNAD-style header layered on by the
 * caller via the structural spec.
 */
export function listPageTitle(
  kind: 'table' | 'figure' | 'equation',
  language: string | null,
): string {
  const lang = pickLang(language)
  if (lang === 'tr') {
    if (kind === 'table') return 'TABLOLAR LİSTESİ'
    if (kind === 'figure') return 'ŞEKİLLER LİSTESİ'
    return 'EŞİTLİKLER LİSTESİ'
  }
  if (kind === 'table') return 'List of Tables'
  if (kind === 'figure') return 'List of Figures'
  return 'List of Equations'
}
