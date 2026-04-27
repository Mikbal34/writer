/**
 * Server-side figure rendering for chart / mermaid / equation blocks.
 *
 *   chart    → Vega-Lite spec → Kroki HTTP → PNG bytes
 *   mermaid  → Mermaid source  → Kroki HTTP → PNG bytes
 *   equation → LaTeX           → Kroki katex → PNG bytes
 *
 * Kroki is an open-source diagram-as-a-service (https://kroki.io). We
 * use its public endpoint by default; for self-host swap KROKI_BASE_URL.
 *
 * Rendering happens at export time, so a slow/failing Kroki call only
 * breaks that one figure (we fall back to the caption alone) — never
 * the whole document.
 */

import { gzipSync } from 'node:zlib'

const KROKI_BASE_URL = process.env.KROKI_BASE_URL || 'https://kroki.io'

/**
 * Encode the source into Kroki's URL-safe base64 form so we can use
 * GET requests (avoids POST-body size limits and gives free CDN
 * caching when self-hosting Kroki behind a CDN).
 */
function krokiEncode(source: string): string {
  const compressed = gzipSync(Buffer.from(source, 'utf-8'))
  // Kroki's variant of base64 — replace `+` and `/` for URL safety.
  return compressed
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

async function fetchKroki(
  diagramType: string,
  source: string,
  format: 'png' | 'svg' = 'png',
): Promise<Buffer | null> {
  try {
    const encoded = krokiEncode(source)
    const url = `${KROKI_BASE_URL}/${diagramType}/${format}/${encoded}`
    const res = await fetch(url, {
      // Modest timeout: Kroki is fast for simple diagrams; if it's slow
      // we'd rather skip the figure than hold up the entire export.
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      console.error(`[render-figures] Kroki ${res.status}: ${diagramType}`)
      return null
    }
    return Buffer.from(await res.arrayBuffer())
  } catch (err) {
    console.error('[render-figures] Kroki fetch failed:', err)
    return null
  }
}

/**
 * Render a Mermaid diagram source to a PNG. Returns null on failure
 * so the caller can skip the figure gracefully.
 */
export async function renderMermaidPng(source: string): Promise<Buffer | null> {
  return fetchKroki('mermaid', source, 'png')
}

/**
 * Render a Vega-Lite chart spec to a PNG. The spec is a JSON string
 * (or already-stringified JSON object).
 */
export async function renderChartPng(spec: string): Promise<Buffer | null> {
  // Kroki accepts vegalite spec as raw JSON.
  const trimmed = spec.trim()
  return fetchKroki('vegalite', trimmed, 'png')
}

/**
 * Render a LaTeX equation to a PNG via Kroki's katex endpoint. For
 * inline equations the caller stitches the PNG into the line; for
 * display equations it lives on its own line, centered.
 */
export async function renderEquationPng(latex: string): Promise<Buffer | null> {
  // Kroki uses `tikz` for general LaTeX and a dedicated `katex` for math.
  // katex output is a tight PNG of just the formula.
  return fetchKroki('katex', latex, 'png')
}
