/**
 * Tiptap JSON ↔ plaintext helpers.
 *
 * Notes are stored as Tiptap `JSONContent` (rich text + headings + lists +
 * blockquotes + inline marks). For embedding via Python `/embed` and for
 * full-text search we need a flat plaintext projection — that's what
 * `tiptapJsonToPlainText` produces. The walker only looks at `text` nodes
 * and inserts newlines at block boundaries; marks (bold/italic/highlight)
 * are dropped since they're presentational.
 */

interface TiptapNode {
  type?: string
  text?: string
  content?: TiptapNode[]
}

// Block-level node types that should be separated by a blank line in
// the plaintext output. Inline marks and text nodes are NOT in here.
const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'codeBlock',
  'hardBreak',
])

function walk(node: TiptapNode | undefined, parts: string[]): void {
  if (!node) return
  if (node.type === 'text' && typeof node.text === 'string') {
    parts.push(node.text)
    return
  }
  if (node.type === 'hardBreak') {
    parts.push('\n')
    return
  }
  if (Array.isArray(node.content)) {
    const isBlock = node.type ? BLOCK_TYPES.has(node.type) : false
    if (isBlock && parts.length > 0 && !parts[parts.length - 1].endsWith('\n')) {
      parts.push('\n')
    }
    for (const child of node.content) walk(child, parts)
    if (isBlock) parts.push('\n')
  }
}

export function tiptapJsonToPlainText(json: unknown): string {
  if (!json || typeof json !== 'object') return ''
  const parts: string[] = []
  walk(json as TiptapNode, parts)
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * True when the Tiptap doc is empty enough that we shouldn't bother
 * embedding or persisting it. Whitespace-only content counts as empty.
 */
export function tiptapIsEmpty(json: unknown): boolean {
  return tiptapJsonToPlainText(json).trim().length === 0
}
