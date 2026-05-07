/**
 * Tiptap inline atom node for academic citations.
 *
 * Renders as a non-editable pill in the editor — visual marker only,
 * no click handler (verification happens on the dedicated /citations
 * page so the writing flow stays uncluttered). Attributes carry the
 * link to the bibliography entry + page so the verification page can
 * enumerate every citation in the project.
 *
 * Wire format (what gets saved into Subsection.content):
 *   <span data-cite-bib-id="..." data-page="45" data-quote="...">
 *     (Hammoudi, 2006, s. 45)
 *   </span>
 *
 * The text inside the span is the user-visible label; the data-*
 * attributes are the source of truth and survive HTML round-trips
 * because parseHTML reads from them.
 */
import { Node, mergeAttributes } from '@tiptap/core'

export interface CitationAttrs {
  bibId: string
  page: number | null
  quote: string | null
  label: string
  // For multi-volume works (Tabari Tafsir, Hadis Külliyatı). Null
  // for single-volume entries — picker omits the volume input then.
  volumeId: string | null
  volumeNumber: number | null
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    citation: {
      insertCitation: (attrs: CitationAttrs) => ReturnType
    }
  }
}

export const CitationMark = Node.create({
  name: 'citation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      bibId: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-cite-bib-id') || '',
        renderHTML: (attrs) => ({ 'data-cite-bib-id': attrs.bibId }),
      },
      page: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute('data-page')
          if (!v) return null
          const n = parseInt(v, 10)
          return Number.isFinite(n) ? n : null
        },
        renderHTML: (attrs) =>
          attrs.page === null || attrs.page === undefined
            ? {}
            : { 'data-page': String(attrs.page) },
      },
      quote: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-quote') || null,
        renderHTML: (attrs) =>
          attrs.quote ? { 'data-quote': attrs.quote } : {},
      },
      volumeId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-volume-id') || null,
        renderHTML: (attrs) =>
          attrs.volumeId ? { 'data-volume-id': attrs.volumeId } : {},
      },
      volumeNumber: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute('data-volume')
          if (!v) return null
          const n = parseInt(v, 10)
          return Number.isFinite(n) ? n : null
        },
        renderHTML: (attrs) =>
          attrs.volumeNumber === null || attrs.volumeNumber === undefined
            ? {}
            : { 'data-volume': String(attrs.volumeNumber) },
      },
      label: {
        default: '(atıf)',
        parseHTML: (el) => el.textContent ?? '(atıf)',
        renderHTML: () => ({}),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-cite-bib-id]',
      },
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    const label = (node.attrs.label as string) || '(atıf)'
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'cite-pill',
        contenteditable: 'false',
      }),
      label,
    ]
  },

  addCommands() {
    return {
      insertCitation:
        (attrs: CitationAttrs) =>
        ({ chain }) => {
          return chain()
            .focus()
            .insertContent({
              type: this.name,
              attrs,
            })
            .run()
        },
    }
  },
})
