/**
 * Convert raw `[cite:…]` markers in a markdown body to the
 * `<span data-cite-bib-id="…" data-page="…">label</span>` HTML that
 * Tiptap's CitationMark extension knows how to parse.
 *
 * Without this pass the markers survive markdown → HTML conversion as
 * literal text and the user sees `[cite:cmpvc7mxs0002jdpw48hxv9eg,p=86]`
 * sitting in the middle of their prose. Tiptap CitationMark only
 * recognises the rendered `<span data-cite-bib-id>` form (it doesn't
 * match arbitrary text patterns), so we do the conversion here before
 * handing the HTML to the editor.
 *
 * Optional `bibLabels` map produces a human label inside the pill
 * (e.g. "(Harvey, 2021, s.86)"); without it the pill defaults to
 * "(atıf)". Either way the bibId/page/volume stay on the span as
 * data-* attributes so the export pipeline still resolves them to the
 * format-correct reference.
 */

import { parseMarker, type ParsedMarker } from "./inline-resolver";

export interface MarkersToHtmlOptions {
  /** bibId → short label (e.g. "Harvey, 2021"). The page suffix gets
   *  appended automatically. Provide when the caller already has the
   *  bibliography list in hand (citations / write pages); omit for a
   *  generic "(atıf)" placeholder. */
  bibLabels?: Map<string, string>;
  /** Override the placeholder used when no label is known. */
  defaultLabel?: string;
}

const MARKER_RE = /\[cite:([^\]]+)\]/g;

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function pillLabel(marker: ParsedMarker, opts?: MarkersToHtmlOptions): string {
  const baseLabel = opts?.bibLabels?.get(marker.bibId) ?? opts?.defaultLabel ?? "(atıf)";
  // Append page (and volume if present) so the user can read the
  // citation at a glance without expanding the pill.
  const tail: string[] = [];
  if (marker.volume) tail.push(`c. ${marker.volume}`);
  if (marker.page) tail.push(`s. ${marker.page}`);
  if (tail.length === 0) return baseLabel;
  // If the label already wraps in parens, splice the tail inside.
  if (baseLabel.startsWith("(") && baseLabel.endsWith(")")) {
    return `${baseLabel.slice(0, -1)}, ${tail.join(", ")})`;
  }
  return `${baseLabel} (${tail.join(", ")})`;
}

export function markersToHtml(
  body: string,
  opts?: MarkersToHtmlOptions,
): string {
  return body.replace(MARKER_RE, (full, inner: string) => {
    const marker = parseMarker(inner);
    if (!marker) return full;
    const label = pillLabel(marker, opts);
    const attrs: string[] = [
      `data-cite-bib-id="${escapeAttr(marker.bibId)}"`,
    ];
    if (marker.page) attrs.push(`data-page="${escapeAttr(marker.page)}"`);
    if (marker.volume) attrs.push(`data-volume="${escapeAttr(marker.volume)}"`);
    return `<span class="cite-pill" ${attrs.join(" ")}>${escapeText(label)}</span>`;
  });
}
