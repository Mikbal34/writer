"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Save,
  CheckCircle2,
  Loader2,
  Eye,
  Pencil,
  Wand2,
  Scissors,
  Maximize2,
  GraduationCap,
  MessageSquarePlus,
  RotateCw,
  GitCompare,
  Bold,
  Italic,
  List,
  ListOrdered,
  Quote,
  Table as TableIcon,
  Heading2,
  Heading3,
  Minus,
  Undo2,
  Redo2,
  BarChart3,
  ImageIcon,
  Sigma,
  Workflow,
  BookmarkPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { markersToHtml } from "@/lib/citations/marker-to-html";
import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Highlight } from "@tiptap/extension-highlight";
import { CitationMark } from "@/components/writing/extensions/CitationMark";
import CitationPicker from "@/components/writing/CitationPicker";
import { createPortal } from "react-dom";
import { PagePreview } from "@/components/preview/PagePreview";
import { DEFAULT_BOOK_DESIGN, type BookDesign } from "@/lib/book-styles";

interface ContentEditorProps {
  subsectionId: string;
  projectId: string;
  initialContent: string;
  status: string;
  onContentChange?: (content: string) => void;
  streamingContent?: string;
  isStreaming?: boolean;
  /**
   * Fires whenever the user switches between Edit / Read / Page so the
   * surrounding workspace can react — e.g. auto-collapse side panels
   * to give the A4 preview more horizontal room.
   */
  onPreviewModeChange?: (mode: "edit" | "read" | "page") => void;
}

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-muted text-muted-foreground" },
  in_progress: {
    label: "In Progress",
    className: "bg-accent text-primary",
  },
  paused: {
    label: "Paused",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  },
  draft: {
    label: "Draft",
    className:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  },
  review: {
    label: "For Review",
    className:
      "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  },
  completed: {
    label: "Completed",
    className: "bg-forest/10 text-forest",
  },
};

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

/** Convert markdown string to HTML for Tiptap */
function markdownToHtml(md: string): string {
  if (!md) return "";

  // First pass: convert structured `[cite:bibId,p=X]` (and tolerant
  // variants like `[cite:bibId|s.X]`) into `<span data-cite-bib-id>`
  // pills before any other markdown rule runs. This is what Tiptap's
  // CitationMark extension parses; otherwise the markers survive as
  // literal text in the editor and confuse the user.
  let html = markersToHtml(md);

  // Tables: detect markdown tables and convert
  html = html.replace(
    /(?:^|\n)((?:\|.+\|(?:\n|$))+)/g,
    (_match, tableBlock: string) => {
      const rows = tableBlock.trim().split("\n").filter(Boolean);
      if (rows.length < 2) return tableBlock;

      // Check if second row is separator
      const isSeparator = (row: string) =>
        /^\|[\s:*-]+(\|[\s:*-]+)*\|?$/.test(row.trim());

      let headerRow: string | null = null;
      let dataRows: string[];

      if (isSeparator(rows[1])) {
        headerRow = rows[0];
        dataRows = rows.slice(2);
      } else {
        dataRows = rows;
      }

      const parseCells = (row: string) =>
        row
          .split("|")
          .slice(1, -1)
          .map((c) => c.trim());

      let tableHtml = "<table>";
      if (headerRow) {
        tableHtml += "<tr>";
        for (const cell of parseCells(headerRow)) {
          tableHtml += `<th>${inlineMarkdown(cell)}</th>`;
        }
        tableHtml += "</tr>";
      }
      for (const row of dataRows) {
        tableHtml += "<tr>";
        for (const cell of parseCells(row)) {
          tableHtml += `<td>${inlineMarkdown(cell)}</td>`;
        }
        tableHtml += "</tr>";
      }
      tableHtml += "</table>";
      return "\n" + tableHtml + "\n";
    }
  );

  // Split into blocks by double newline (but not inside tables)
  const blocks = html.split(/\n{2,}/);
  const processed: string[] = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Already HTML (tables)
    if (trimmed.startsWith("<table")) {
      processed.push(trimmed);
      continue;
    }

    // Blockquote
    if (trimmed.startsWith("> ")) {
      const quoteContent = trimmed
        .split("\n")
        .map((l) => l.replace(/^>\s?/, ""))
        .join("<br>");
      processed.push(`<blockquote><p>${inlineMarkdown(quoteContent)}</p></blockquote>`);
      continue;
    }

    // Headings
    if (trimmed.startsWith("### ")) {
      processed.push(`<h3>${inlineMarkdown(trimmed.slice(4))}</h3>`);
      continue;
    }
    if (trimmed.startsWith("## ")) {
      processed.push(`<h2>${inlineMarkdown(trimmed.slice(3))}</h2>`);
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(trimmed)) {
      processed.push("<hr>");
      continue;
    }

    // Unordered list
    if (/^[-*]\s/.test(trimmed)) {
      const items = trimmed.split("\n").filter((l) => /^[-*]\s/.test(l.trim()));
      const listHtml = items
        .map((item) => `<li>${inlineMarkdown(item.replace(/^[-*]\s+/, ""))}</li>`)
        .join("");
      processed.push(`<ul>${listHtml}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(trimmed)) {
      const items = trimmed
        .split("\n")
        .filter((l) => /^\d+\.\s/.test(l.trim()));
      const listHtml = items
        .map((item) =>
          `<li>${inlineMarkdown(item.replace(/^\d+\.\s+/, ""))}</li>`
        )
        .join("");
      processed.push(`<ol>${listHtml}</ol>`);
      continue;
    }

    // Regular paragraph
    processed.push(`<p>${inlineMarkdown(trimmed)}</p>`);
  }

  return processed.join("");
}

/** Convert inline markdown (bold, italic, footnotes) to HTML */
function inlineMarkdown(text: string): string {
  let result = text;
  // Bold + italic
  result = result.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  // Bold
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic
  result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");
  // Footnotes: keep as inline text marker (styled in CSS)
  result = result.replace(
    /\[fn:\s*([^\]]+)\]/g,
    '<sup class="footnote-marker" data-footnote="$1">[fn]</sup>'
  );
  return result;
}

/** Convert Tiptap HTML back to markdown for storage */
function htmlToMarkdown(html: string): string {
  if (!html) return "";

  const div = typeof document !== "undefined" ? document.createElement("div") : null;
  if (!div) return html;
  div.innerHTML = html;

  return nodeToMarkdown(div).trim();
}

function nodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  const childMd = () =>
    Array.from(el.childNodes)
      .map((c) => nodeToMarkdown(c))
      .join("");

  switch (tag) {
    case "p":
      return childMd() + "\n\n";
    case "br":
      return "\n";
    case "strong":
    case "b":
      return `**${childMd()}**`;
    case "em":
    case "i":
      return `*${childMd()}*`;
    case "h2":
      return `## ${childMd()}\n\n`;
    case "h3":
      return `### ${childMd()}\n\n`;
    case "hr":
      return "---\n\n";
    case "blockquote":
      return (
        childMd()
          .trim()
          .split("\n")
          .map((l) => `> ${l}`)
          .join("\n") + "\n\n"
      );
    case "ul":
      return (
        Array.from(el.children)
          .map((li) => `- ${nodeToMarkdown(li).trim()}`)
          .join("\n") + "\n\n"
      );
    case "ol":
      return (
        Array.from(el.children)
          .map((li, i) => `${i + 1}. ${nodeToMarkdown(li).trim()}`)
          .join("\n") + "\n\n"
      );
    case "li":
      return childMd();
    case "table":
      return tableToMarkdown(el) + "\n\n";
    case "sup": {
      const fn = el.getAttribute("data-footnote");
      if (fn) return `[fn: ${fn}]`;
      return childMd();
    }
    case "div":
      return childMd();
    case "span": {
      // Round-trip citation pills as canonical `[cite:…]` markdown.
      // Going back through markdown (rather than spitting out the
      // full <span outerHTML>) keeps the stored content compact,
      // diff-friendly, and identical to what the LLM emits in the
      // first place — markdownToHtml will rebuild the span on the
      // way back into the editor.
      if (el.hasAttribute("data-cite-bib-id")) {
        const bibId = el.getAttribute("data-cite-bib-id") ?? "";
        if (!bibId) return childMd();
        const page = el.getAttribute("data-page");
        const volume = el.getAttribute("data-volume");
        const quote = el.getAttribute("data-quote");
        const parts: string[] = [bibId];
        if (volume) parts.push(`v=${volume}`);
        if (page) parts.push(`p=${page}`);
        if (quote) {
          const escaped = quote.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
          parts.push(`q="${escaped}"`);
        }
        return `[cite:${parts.join(",")}]`;
      }
      return childMd();
    }
    default:
      return childMd();
  }
}

function tableToMarkdown(table: HTMLElement): string {
  const rows = Array.from(table.querySelectorAll("tr"));
  if (rows.length === 0) return "";

  const matrix: string[][] = [];
  for (const row of rows) {
    const cells = Array.from(row.querySelectorAll("th, td"));
    matrix.push(cells.map((c) => nodeToMarkdown(c).trim()));
  }

  const colCount = Math.max(...matrix.map((r) => r.length));
  const colWidths = Array.from({ length: colCount }, (_, i) =>
    Math.max(3, ...matrix.map((r) => (r[i] ?? "").length))
  );

  const formatRow = (cells: string[]) =>
    "| " +
    cells
      .map((c, i) => (c ?? "").padEnd(colWidths[i]))
      .join(" | ") +
    " |";

  const lines: string[] = [];
  lines.push(formatRow(matrix[0]));
  lines.push(
    "| " + colWidths.map((w) => "-".repeat(w)).join(" | ") + " |"
  );
  for (let i = 1; i < matrix.length; i++) {
    lines.push(formatRow(matrix[i]));
  }
  return lines.join("\n");
}

// ---- Word-level diff (for the rewrite Review bar's diff popover) -------
type DiffOp = { type: "equal" | "insert" | "delete"; text: string };

function diffWords(a: string, b: string): DiffOp[] {
  // Tokenise on whitespace boundaries so word and the gap before it stay
  // associated — preserves spacing in the rendered diff.
  const aw = a.split(/(\s+)/).filter((t) => t.length > 0);
  const bw = b.split(/(\s+)/).filter((t) => t.length > 0);
  const m = aw.length;
  const n = bw.length;
  // Classic LCS DP. m,n stay small for selection-sized text — typical
  // rewrite is < 800 tokens so the m·n table is fine.
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = aw[i - 1] === bw[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  // Walk back to recover edits.
  const ops: DiffOp[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (aw[i - 1] === bw[j - 1]) {
      ops.push({ type: "equal", text: aw[i - 1] });
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      ops.push({ type: "delete", text: aw[i - 1] });
      i--;
    } else {
      ops.push({ type: "insert", text: bw[j - 1] });
      j--;
    }
  }
  while (i > 0) { ops.push({ type: "delete", text: aw[i - 1] }); i--; }
  while (j > 0) { ops.push({ type: "insert", text: bw[j - 1] }); j--; }
  ops.reverse();
  // Coalesce runs of the same op-type for cleaner spans.
  const coalesced: DiffOp[] = [];
  for (const op of ops) {
    const last = coalesced[coalesced.length - 1];
    if (last && last.type === op.type) {
      last.text += op.text;
    } else {
      coalesced.push({ ...op });
    }
  }
  return coalesced;
}

type SaveState = "idle" | "saving" | "saved" | "error";

export default function ContentEditor({
  subsectionId,
  projectId,
  initialContent,
  status,
  onContentChange,
  streamingContent,
  isStreaming,
  onPreviewModeChange,
}: ContentEditorProps) {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  // 'edit' = the live Tiptap editor (default).
  // 'read' = simple prose render with [cite:…] resolved — fastest preview.
  // 'page' = real A4/A5 page geometry with project's BookDesign tokens.
  const [previewMode, setPreviewMode] = useState<"edit" | "read" | "page">(
    "edit",
  );
  const [pageLayout, setPageLayout] = useState<"single" | "spread">("single");
  // Remembers which preview flavour the user was last on (Read vs Page)
  // so clicking the top-level Preview button after a stint in Edit
  // returns to the same view without making them re-pick.
  const [lastPreviewKind, setLastPreviewKind] = useState<"read" | "page">("read");
  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);
  // Seeded with sensible defaults so Page mode renders instantly even
  // before the project's saved design has come back from the API.
  const [bookDesign, setBookDesign] = useState<BookDesign>(DEFAULT_BOOK_DESIGN);
  const [bookDesignLoaded, setBookDesignLoaded] = useState(false);
  const [citationPickerOpen, setCitationPickerOpen] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusInfo = STATUS_STYLES[status] ?? STATUS_STYLES.pending;
  const lastStreamRef = useRef<string>("");
  const isStreamingRef = useRef(isStreaming);
  isStreamingRef.current = isStreaming;
  // Tracks the last value persisted to the server. Lets autoSave skip
  // the API call (and the "Saving…" flash) when the user toggles modes
  // or hits Save without having changed anything.
  const lastSavedRef = useRef<string>(initialContent);
  useEffect(() => {
    lastSavedRef.current = initialContent;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subsectionId]);

  const initialHtml = useMemo(
    () => markdownToHtml(initialContent),
    // Only compute once on mount — we don't want to re-render on every initialContent change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subsectionId]
  );

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [2, 3] },
        }),
        Table.configure({ resizable: true }),
        TableRow,
        TableCell,
        TableHeader,
        // Used to flag a freshly-applied AI rewrite; the colour is set
        // when the rewrite lands and cleared on Apply / Revert.
        Highlight.configure({ multicolor: true }),
        // Inline atom node for academic citations — verification UI
        // lives on the dedicated /citations page so the writer flow
        // stays clean.
        CitationMark,
        Placeholder.configure({
          placeholder:
            "Start writing here... or use the 'Write with AI' button to generate content.",
        }),
      ],
      content: initialHtml,
      editable: !isStreaming,
      onUpdate: ({ editor: ed }) => {
        if (isStreamingRef.current) return;
        const md = htmlToMarkdown(ed.getHTML());
        onContentChange?.(md);

        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => autoSave(md), 2000);
      },
      editorProps: {
        attributes: {
          class:
            "prose prose-sm dark:prose-invert max-w-none p-6 min-h-full focus:outline-none font-serif text-sm leading-7",
        },
      },
    },
    [subsectionId]
  );

  // Sync streaming content into editor
  useEffect(() => {
    if (!editor) return;
    if (isStreaming && streamingContent) {
      // Only update if content actually changed
      if (streamingContent !== lastStreamRef.current) {
        lastStreamRef.current = streamingContent;
        const html = markdownToHtml(streamingContent);
        editor.commands.setContent(html, { emitUpdate: false });
      }
    }
  }, [editor, isStreaming, streamingContent]);

  // When streaming finishes, sync final content
  useEffect(() => {
    if (!editor) return;
    if (!isStreaming && lastStreamRef.current) {
      const finalMd = lastStreamRef.current;
      lastStreamRef.current = "";
      const html = markdownToHtml(finalMd);
      editor.commands.setContent(html, { emitUpdate: false });
      onContentChange?.(finalMd);
    }
  }, [isStreaming, editor, onContentChange]);

  // Update editable state
  useEffect(() => {
    if (editor) {
      editor.setEditable(!isStreaming);
    }
  }, [editor, isStreaming]);

  // When subsection changes, load new content
  useEffect(() => {
    if (editor && initialContent !== undefined) {
      const html = markdownToHtml(initialContent);
      editor.commands.setContent(html, { emitUpdate: false });
      lastStreamRef.current = "";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subsectionId, editor]);

  const autoSave = useCallback(
    async (text: string) => {
      // Skip when nothing has actually changed since the last save —
      // mode toggles and explicit Save clicks shouldn't flash "Saving…"
      // and "Saved" for a no-op request.
      if (text === lastSavedRef.current) return;
      setSaveState("saving");
      try {
        const res = await fetch(`/api/subsections/${subsectionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: text,
            status: text.trim() ? "completed" : "pending",
          }),
        });
        if (!res.ok) throw new Error("Save failed");
        lastSavedRef.current = text;
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 2000);
      } catch {
        setSaveState("error");
      }
    },
    [subsectionId]
  );

  async function handleManualSave() {
    if (!editor) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const md = htmlToMarkdown(editor.getHTML());
    await autoSave(md);
  }

  const wordCount = useMemo(() => {
    if (isStreaming && streamingContent) return countWords(streamingContent);
    if (editor) return countWords(editor.getText());
    return 0;
  }, [editor, isStreaming, streamingContent, editor?.state.doc.content.size]);

  // Keyboard shortcut for the citation picker — matches the toolbar
  // button so users who learn the shortcut don't have to leave the
  // keyboard while writing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.shiftKey && e.key.toLowerCase() === "c") {
        // Only activate while editing — don't hijack the shortcut in
        // Read/Page preview modes.
        if (previewMode === "edit" && !isStreaming) {
          e.preventDefault();
          setCitationPickerOpen(true);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewMode, isStreaming]);

  // Preview switching — both 'read' and 'page' modes fetch the
  // resolved-citations version of the body. 'page' additionally needs
  // the project's BookDesign tokens to render at A4/A5/B5 geometry.
  async function enterPreviewMode(mode: "edit" | "read" | "page") {
    if (mode === "edit") {
      setPreviewMode("edit");
      onPreviewModeChange?.("edit");
      return;
    }
    if (!editor) return;
    // Save the buffer first so the server preview reflects what's
    // actually on screen, not the last persisted version.
    const md = htmlToMarkdown(editor.getHTML());
    setPreviewMode(mode);
    setLastPreviewKind(mode);
    onPreviewModeChange?.(mode);
    setPreviewLoading(true);
    try {
      await autoSave(md);
      const tasks: Promise<void>[] = [
        fetch(`/api/projects/${projectId}/subsections/${subsectionId}/preview`, {
          cache: "no-store",
        })
          .then((res) => {
            if (!res.ok) throw new Error("preview failed");
            return res.json() as Promise<{ content: string }>;
          })
          .then((data) => {
            setPreviewHtml(markdownToHtml(data.content));
          }),
      ];
      // Page mode needs the project's BookDesign — fetch once, cache in
      // state. We always end up with a valid design either way: if the
      // project hasn't been customised, we keep DEFAULT_BOOK_DESIGN.
      if (mode === "page" && !bookDesignLoaded) {
        tasks.push(
          fetch(`/api/projects/${projectId}`, { cache: "no-store" })
            .then((res) => (res.ok ? res.json() : null))
            .then((proj: { bookDesign?: BookDesign | null } | null) => {
              if (proj?.bookDesign) {
                setBookDesign({ ...DEFAULT_BOOK_DESIGN, ...proj.bookDesign });
              }
              setBookDesignLoaded(true);
            })
            .catch(() => setBookDesignLoaded(true)),
        );
      }
      await Promise.all(tasks);
    } catch {
      setPreviewHtml(markdownToHtml(md));
    } finally {
      setPreviewLoading(false);
    }
  }

  // ---- Block-snippet inserters --------------------------------------------
  // Each toolbar button below drops a fully-formed markdown template at the
  // cursor. We insert as one Tiptap paragraph with hardBreak nodes between
  // lines so the multi-line block (e.g. a chart's vega-lite spec inside
  // ``` fences) round-trips through htmlToMarkdown without acquiring blank
  // lines that would split it across multiple parseMarkdownBlocks blocks
  // on export.

  function shortId(prefix: string): string {
    const t = Date.now().toString(36).slice(-4);
    const r = Math.floor(Math.random() * 1296).toString(36).padStart(2, "0");
    return `${prefix}-${t}${r}`;
  }

  function insertSnippet(lines: string[]) {
    if (!editor) return;
    const content: { type: string; text?: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line) content.push({ type: "text", text: line });
      if (i < lines.length - 1) content.push({ type: "hardBreak" });
    }
    if (content.length === 0) return;
    editor
      .chain()
      .focus()
      .insertContent({ type: "paragraph", content })
      .run();
  }

  function insertChart() {
    insertSnippet([
      `[chart:${shortId("chart")} type=bar caption="Açıklama"]`,
      "```vega-lite",
      "{",
      `  "data": { "values": [{ "x": "A", "y": 28 }, { "x": "B", "y": 55 }] },`,
      `  "mark": "bar",`,
      `  "encoding": {`,
      `    "x": { "field": "x", "type": "nominal" },`,
      `    "y": { "field": "y", "type": "quantitative" }`,
      "  }",
      "}",
      "```",
    ]);
  }

  function insertFigure() {
    insertSnippet([
      `[figure:${shortId("fig")} caption="Açıklama"]`,
      "![Alt metin](URL)",
    ]);
  }

  function insertEquation() {
    insertSnippet([
      `[equation:${shortId("eq")}]`,
      "$$ E = mc^2 $$",
    ]);
  }

  function insertMermaid() {
    insertSnippet([
      `[mermaid:${shortId("diag")} caption="Açıklama"]`,
      "```mermaid",
      "graph LR",
      "    A[Başlangıç] --> B[Son]",
      "```",
    ]);
  }

  // ---- Selection-based AI rewrite ----------------------------------------
  // BubbleMenu surfaces these when the user has a non-empty selection.
  // Each calls the rewrite endpoint, replaces the selection range with
  // the AI's response, and falls back to a toast on failure.
  // Expand a mid-sentence selection to the nearest sentence boundaries
  // so the LLM doesn't get a half-word fragment. If the selection
  // already contains a sentence boundary anywhere inside it (i.e. the
  // user grabbed at least one whole sentence), we leave it alone —
  // expanding would steal extra sentences the user didn't ask for.
  function snapToSentence(start: number, end: number) {
    if (!editor) return { from: start, to: end, text: "" };
    const docSize = editor.state.doc.content.size;
    const isSentenceEnd = (ch: string) => /[.!?…]/.test(ch);
    const isBoundary = (ch: string) => /\s/.test(ch) || ch === "\n" || ch === "";

    let newFrom = Math.max(0, Math.min(start, docSize));
    let newTo = Math.max(newFrom, Math.min(end, docSize));

    const fragment = editor.state.doc.textBetween(newFrom, newTo, "\n", "\n");

    // If the selected fragment itself contains a sentence-end followed
    // by whitespace or end-of-text, the user already picked at least
    // one full sentence boundary — keep the range as-is.
    if (/[.!?…](?:\s|$)/.test(fragment) || /\n/.test(fragment)) {
      return { from: newFrom, to: newTo, text: fragment };
    }

    // Walk left from from. We're at sentence start when the char before
    // is a sentence-end + boundary, OR the previous position is a block
    // break (newline returned by textBetween across nodes).
    while (newFrom > 0) {
      const prev = editor.state.doc.textBetween(newFrom - 1, newFrom, "\n", "");
      if (prev === "\n") break;
      if (newFrom >= 2) {
        const prevPrev = editor.state.doc.textBetween(newFrom - 2, newFrom - 1, "\n", "");
        if (isSentenceEnd(prevPrev) && isBoundary(prev)) break;
      }
      newFrom--;
    }

    // Walk right from to. We stop AFTER the sentence-end char so the
    // selection includes the period/?/!.
    while (newTo < docSize) {
      const ch = editor.state.doc.textBetween(newTo, newTo + 1, "\n", "");
      if (ch === "\n") break;
      const next =
        newTo + 1 < docSize
          ? editor.state.doc.textBetween(newTo + 1, newTo + 2, "\n", "")
          : "";
      if (isSentenceEnd(ch) && isBoundary(next)) {
        newTo++;
        break;
      }
      newTo++;
    }

    const text = editor.state.doc.textBetween(newFrom, newTo, "\n", "\n");
    return { from: newFrom, to: newTo, text };
  }

  type RewriteAction = "rewrite" | "shorten" | "expand" | "academic" | "custom";
  const [rewriteBusy, setRewriteBusy] = useState(false);
  const [streamingChars, setStreamingChars] = useState(0);
  const [showCustomRewrite, setShowCustomRewrite] = useState(false);
  const [customRewritePrompt, setCustomRewritePrompt] = useState("");
  // Stash the active selection on mousedown before any BubbleMenu
  // button click can shift focus away.
  const lastSelectionRef = useRef<{ from: number; to: number; text: string } | null>(null);
  // After a successful rewrite we keep the original snippet around so
  // the floating Review bar can revert / regenerate / show diff.
  const [pendingReview, setPendingReview] = useState<{
    originalText: string;
    rewriteText: string;
    range: { from: number; to: number };
    action: RewriteAction;
    customPrompt?: string;
  } | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  async function runRewrite(action: RewriteAction, customPrompt?: string) {
    if (!editor || rewriteBusy) return;
    // Prefer the stashed selection (captured on mousedown) over the
    // live state, since clicking the menu button can collapse the
    // current selection on some browsers.
    const liveSel = editor.state.selection;
    const captured = lastSelectionRef.current ?? {
      from: liveSel.from,
      to: liveSel.to,
    };
    if (captured.from === captured.to) return;
    // Snap the range to whole-sentence boundaries so the LLM doesn't
    // get a mid-word fragment. Update the editor's visible selection
    // so the user sees the expanded range before the rewrite lands.
    const sel = snapToSentence(captured.from, captured.to);
    if (sel.from === sel.to) return;
    if (sel.from !== captured.from || sel.to !== captured.to) {
      editor.commands.setTextSelection({ from: sel.from, to: sel.to });
    }
    const text = sel.text;
    if (!text.trim()) return;

    setRewriteBusy(true);
    setStreamingChars(0);
    setShowDiff(false);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/write/${subsectionId}/rewrite`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, action, customPrompt }),
        },
      );
      if (res.status === 402) {
        const err = (await res.json().catch(() => ({}))) as {
          balance?: number;
          cost?: number;
        };
        toast.error(
          `Insufficient credits (${err.balance ?? 0} remaining). Need ~${err.cost ?? "?"} for rewrite.`,
        );
        return;
      }
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Rewrite failed");
      }

      // SSE parse loop. Each `delta` event grows the char counter; the
      // `done` event carries the final rewrite text + drift metadata.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let charsSeen = 0;
      let finalRewrite = "";
      let lostMarkers: string[] = [];
      let fabricatedMarkers: string[] = [];
      let serverError: string | null = null;
      reader: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") break reader;
          try {
            const parsed = JSON.parse(data) as {
              delta?: string;
              done?: boolean;
              rewrite?: string;
              lostMarkers?: string[];
              fabricatedMarkers?: string[];
              error?: string;
            };
            if (parsed.error) {
              serverError = parsed.error;
            } else if (parsed.delta) {
              charsSeen += parsed.delta.length;
              setStreamingChars(charsSeen);
            } else if (parsed.done && parsed.rewrite) {
              finalRewrite = parsed.rewrite.trim();
              lostMarkers = parsed.lostMarkers ?? [];
              fabricatedMarkers = parsed.fabricatedMarkers ?? [];
            }
          } catch {
            // ignore malformed event line
          }
        }
      }
      if (serverError) throw new Error(serverError);
      const rewrite = finalRewrite;
      if (!rewrite) {
        toast.error("Empty rewrite — try again with a different action.");
        return;
      }
      const data = { rewrite, lostMarkers, fabricatedMarkers };
      // Convert markdown back to HTML so multi-paragraph and inline
      // formatting (**bold**, *italic*, lists, blockquote) survive
      // the round-trip. insertContentAt with a string would treat
      // \n\n as text and collapse paragraphs.
      const rewriteHtml = markdownToHtml(rewrite);
      const transaction = editor
        .chain()
        .focus()
        .insertContentAt({ from: sel.from, to: sel.to }, rewriteHtml)
        .run();
      if (!transaction) {
        toast.error("Replace failed — selection drifted; try again.");
        return;
      }
      // Track the new range so the Review card can revert / regenerate
      // / show diff. Tiptap doesn't directly expose the inserted
      // content's length, so derive it from the cursor position
      // right after insert.
      const insertedTo = editor.state.selection.from;
      // Wrap the freshly inserted text with the Highlight mark so the
      // user can see exactly which span was rewritten.
      editor
        .chain()
        .setTextSelection({ from: sel.from, to: insertedTo })
        .setMark("highlight", { color: "#FAF3E3" })
        .setTextSelection(insertedTo)
        .run();
      setPendingReview({
        originalText: text,
        rewriteText: rewrite,
        range: { from: sel.from, to: insertedTo },
        action,
        customPrompt: action === "custom" ? customPrompt : undefined,
      });
      const drift: string[] = [];
      if (data.lostMarkers && data.lostMarkers.length > 0) drift.push(`kayıp: ${data.lostMarkers.join(", ")}`);
      if (data.fabricatedMarkers && data.fabricatedMarkers.length > 0) drift.push(`uydurulan: ${data.fabricatedMarkers.join(", ")}`);
      if (drift.length > 0) {
        toast.warning(
          `Yeniden yazımda marker drift'i var (${drift.join(" · ")}) — Review bar'dan Geri Al ile düzeltebilirsin.`,
          { duration: 10000 },
        );
      } else {
        toast.success(
          action === "custom"
            ? "Custom rewrite uygulandı — Review bar'dan onay/red"
            : "Yeniden yazım uygulandı — Review bar'dan onay/red",
        );
      }
      setShowCustomRewrite(false);
      setCustomRewritePrompt("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rewrite failed");
    } finally {
      setRewriteBusy(false);
      setStreamingChars(0);
    }
  }

  function clearHighlightAt(range: { from: number; to: number }) {
    if (!editor) return;
    const docSize = editor.state.doc.content.size;
    const safeFrom = Math.max(0, Math.min(range.from, docSize));
    const safeTo = Math.max(safeFrom, Math.min(range.to, docSize));
    if (safeFrom === safeTo) return;
    editor
      .chain()
      .setTextSelection({ from: safeFrom, to: safeTo })
      .unsetMark("highlight")
      .setTextSelection(safeTo)
      .run();
  }

  function applyReview() {
    if (pendingReview) clearHighlightAt(pendingReview.range);
    setPendingReview(null);
    setShowDiff(false);
  }
  function revertReview() {
    if (!editor || !pendingReview) return;
    // insertContentAt with plain string also strips the highlight mark
    // from the replaced span — no separate unset needed.
    editor
      .chain()
      .focus()
      .insertContentAt(pendingReview.range, pendingReview.originalText)
      .run();
    setPendingReview(null);
    setShowDiff(false);
    toast.info("Yeniden yazım geri alındı.");
  }
  // "Başka versiyon" — re-run the same action against the original
  // text so the user can iterate without re-selecting + re-clicking.
  async function regenerateReview() {
    if (!editor || !pendingReview || rewriteBusy) return;
    const { range, originalText, action, customPrompt } = pendingReview;
    // Restore the original text in place so the next runRewrite has
    // the right baseline to extend. insertContentAt with plain text
    // also clears the highlight mark on that range.
    editor
      .chain()
      .focus()
      .insertContentAt(range, originalText)
      .run();
    const restoredFrom = range.from;
    const restoredTo = restoredFrom + originalText.length;
    lastSelectionRef.current = { from: restoredFrom, to: restoredTo, text: originalText };
    setPendingReview(null);
    setShowDiff(false);
    await runRewrite(action, customPrompt);
  }

  if (!editor) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-background/50 shrink-0">
        <div className="flex items-center gap-1">
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium mr-2",
              statusInfo.className
            )}
          >
            {statusInfo.label}
          </span>

          {/* Formatting buttons — hidden in Read/Page preview modes
              because the read-only render can't show their effect. */}
          {previewMode === "edit" && (
          <>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            active={editor.isActive("bold")}
            disabled={isStreaming}
            title="Bold"
          >
            <Bold className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            active={editor.isActive("italic")}
            disabled={isStreaming}
            title="Italic"
          >
            <Italic className="h-3.5 w-3.5" />
          </ToolbarButton>

          <div className="w-px h-4 bg-border mx-1" />

          <ToolbarButton
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 2 }).run()
            }
            active={editor.isActive("heading", { level: 2 })}
            disabled={isStreaming}
            title="Heading 2"
          >
            <Heading2 className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 3 }).run()
            }
            active={editor.isActive("heading", { level: 3 })}
            disabled={isStreaming}
            title="Heading 3"
          >
            <Heading3 className="h-3.5 w-3.5" />
          </ToolbarButton>

          <div className="w-px h-4 bg-border mx-1" />

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            active={editor.isActive("bulletList")}
            disabled={isStreaming}
            title="Bullet List"
          >
            <List className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            active={editor.isActive("orderedList")}
            disabled={isStreaming}
            title="Numbered List"
          >
            <ListOrdered className="h-3.5 w-3.5" />
          </ToolbarButton>

          <div className="w-px h-4 bg-border mx-1" />

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            active={editor.isActive("blockquote")}
            disabled={isStreaming}
            title="Blockquote"
          >
            <Quote className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => setCitationPickerOpen(true)}
            disabled={isStreaming}
            title="Atıf ekle (Cmd+Shift+C)"
          >
            <BookmarkPlus className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() =>
              editor
                .chain()
                .focus()
                .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                .run()
            }
            disabled={isStreaming}
            title="Insert Table"
          >
            <TableIcon className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={insertChart}
            disabled={isStreaming}
            title="Insert Chart (Vega-Lite)"
          >
            <BarChart3 className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={insertFigure}
            disabled={isStreaming}
            title="Insert Figure"
          >
            <ImageIcon className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={insertEquation}
            disabled={isStreaming}
            title="Insert Equation"
          >
            <Sigma className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={insertMermaid}
            disabled={isStreaming}
            title="Insert Diagram (Mermaid)"
          >
            <Workflow className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            disabled={isStreaming}
            title="Horizontal Rule"
          >
            <Minus className="h-3.5 w-3.5" />
          </ToolbarButton>

          <div className="w-px h-4 bg-border mx-1" />

          <ToolbarButton
            onClick={() => editor.chain().focus().undo().run()}
            disabled={isStreaming || !editor.can().undo()}
            title="Undo"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().redo().run()}
            disabled={isStreaming || !editor.can().redo()}
            title="Redo"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </ToolbarButton>
          </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Edit / Read / Page tri-toggle */}
          {/* Main two-state toggle: Edit (live editor) vs Preview
              (read-only). Preview restores the user's last sub-mode
              (Read / Page) so they don't have to re-pick every time. */}
          <div className="flex items-center rounded-md border border-border bg-background overflow-hidden">
            <ToolbarButton
              onClick={() => enterPreviewMode("edit")}
              active={previewMode === "edit"}
              disabled={isStreaming}
              title="Edit"
            >
              <Pencil className="h-3.5 w-3.5" />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => enterPreviewMode(lastPreviewKind)}
              active={previewMode !== "edit"}
              disabled={isStreaming || previewLoading}
              title="Preview"
            >
              <Eye className="h-3.5 w-3.5" />
            </ToolbarButton>
          </div>

          {/* Read / Page sub-toggle — only visible while previewing. */}
          {previewMode !== "edit" && (
            <div className="flex items-center rounded-md border border-border bg-background overflow-hidden">
              <button
                type="button"
                onClick={() => enterPreviewMode("read")}
                disabled={isStreaming || previewLoading}
                className={cn(
                  "px-2.5 py-1 text-[11px] font-ui font-medium transition-colors",
                  previewMode === "read"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50",
                )}
                title="Read view (citations resolved)"
              >
                Read
              </button>
              <button
                type="button"
                onClick={() => enterPreviewMode("page")}
                disabled={isStreaming || previewLoading}
                className={cn(
                  "px-2.5 py-1 text-[11px] font-ui font-medium transition-colors",
                  previewMode === "page"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50",
                )}
                title="Page view (book layout)"
              >
                Page
              </button>
            </div>
          )}

          {/* Single / spread sub-toggle, only visible inside page view */}
          {previewMode === "page" && (
            <div className="flex items-center rounded-md border border-border bg-background overflow-hidden">
              <button
                type="button"
                onClick={() => setPageLayout("single")}
                className={cn(
                  "px-2 py-1 text-[11px] font-ui font-medium transition-colors",
                  pageLayout === "single"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50",
                )}
                title="Single page"
              >
                1
              </button>
              <button
                type="button"
                onClick={() => setPageLayout("spread")}
                className={cn(
                  "px-2 py-1 text-[11px] font-ui font-medium transition-colors",
                  pageLayout === "spread"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50",
                )}
                title="Two-page spread"
              >
                2
              </button>
            </div>
          )}

          <span className="text-xs text-muted-foreground tabular-nums">
            {wordCount.toLocaleString()} word{wordCount !== 1 ? "s" : ""}
          </span>

          {/* Save indicator */}
          <div className="flex items-center gap-1.5 text-xs">
            {saveState === "saving" && (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">Saving...</span>
              </>
            )}
            {saveState === "saved" && (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                <span className="text-emerald-600">Saved</span>
              </>
            )}
            {saveState === "error" && (
              <span className="text-destructive">Save failed</span>
            )}
          </div>

          <Button
            size="sm"
            onClick={handleManualSave}
            disabled={saveState === "saving" || isStreaming}
            className="h-7 gap-1.5 text-xs bg-primary text-primary-foreground"
          >
            <Save className="h-3.5 w-3.5" />
            Save
          </Button>
        </div>
      </div>

      {/* Editor / preview */}
      <div className="flex-1 overflow-y-auto relative">
        {previewMode === "edit" && (
          <>
            <EditorContent editor={editor} className="h-full" />
            <BubbleMenu
              editor={editor}
              shouldShow={({ editor: ed, state }) => {
                const { from, to, empty } = state.selection;
                if (empty || isStreaming) return false;
                const text = ed.state.doc.textBetween(from, to, "\n", "\n").trim();
                if (text.length < 3) return false;
                // Snapshot the live selection so a mouse-down on the
                // menu doesn't make us lose it.
                lastSelectionRef.current = { from, to, text };
                return true;
              }}
              className="flex flex-col rounded-md border border-border bg-popover shadow-lg overflow-hidden"
              // Prevent any pointerdown inside the menu from collapsing
              // the editor selection — without this, Firefox/Safari
              // sometimes deselect before our click handler fires.
              onMouseDown={(e) => e.preventDefault()}
            >
              {showCustomRewrite ? (
                <div className="flex items-center gap-1.5 p-2 min-w-[280px]">
                  <input
                    type="text"
                    autoFocus
                    value={customRewritePrompt}
                    onChange={(e) => setCustomRewritePrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && customRewritePrompt.trim()) {
                        runRewrite("custom", customRewritePrompt.trim());
                      } else if (e.key === "Escape") {
                        setShowCustomRewrite(false);
                        setCustomRewritePrompt("");
                      }
                    }}
                    placeholder="Örn. daha kısa yap, dipnot ekle, …"
                    className="flex-1 px-2 py-1 text-xs font-ui rounded-sm border border-border bg-background focus:outline-none focus:border-gold"
                    disabled={rewriteBusy}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      customRewritePrompt.trim() &&
                      runRewrite("custom", customRewritePrompt.trim())
                    }
                    disabled={rewriteBusy || !customRewritePrompt.trim()}
                    className="px-2 py-1 text-xs font-ui font-medium bg-gold text-ink rounded-sm hover:bg-gold-dark disabled:opacity-50 transition-colors"
                  >
                    {rewriteBusy ? "…" : "Uygula"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCustomRewrite(false);
                      setCustomRewritePrompt("");
                    }}
                    disabled={rewriteBusy}
                    className="px-2 py-1 text-xs font-ui text-muted-foreground hover:text-foreground"
                  >
                    İptal
                  </button>
                </div>
              ) : (
                <div className="flex items-center divide-x divide-border">
                  <BubbleMenuButton
                    onClick={() => runRewrite("rewrite")}
                    disabled={rewriteBusy}
                    icon={<Wand2 className="h-3 w-3" />}
                    label="Yeniden yaz"
                  />
                  <BubbleMenuButton
                    onClick={() => runRewrite("shorten")}
                    disabled={rewriteBusy}
                    icon={<Scissors className="h-3 w-3" />}
                    label="Kısalt"
                  />
                  <BubbleMenuButton
                    onClick={() => runRewrite("expand")}
                    disabled={rewriteBusy}
                    icon={<Maximize2 className="h-3 w-3" />}
                    label="Genişlet"
                  />
                  <BubbleMenuButton
                    onClick={() => runRewrite("academic")}
                    disabled={rewriteBusy}
                    icon={<GraduationCap className="h-3 w-3" />}
                    label="Akademikleştir"
                  />
                  <BubbleMenuButton
                    onClick={() => setShowCustomRewrite(true)}
                    disabled={rewriteBusy}
                    icon={<MessageSquarePlus className="h-3 w-3" />}
                    label="Özel"
                  />
                </div>
              )}
              {rewriteBusy && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-border bg-muted/40 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>
                    AI çalışıyor
                    {streamingChars > 0 ? ` · ${streamingChars} karakter` : "…"}
                  </span>
                </div>
              )}
            </BubbleMenu>
          </>
        )}
        {previewMode === "read" && (
          <div
            className="prose prose-sm dark:prose-invert max-w-none p-6 font-serif text-sm leading-7"
            dangerouslySetInnerHTML={{
              __html: previewLoading
                ? '<p class="text-muted-foreground italic">Loading preview…</p>'
                : previewHtml,
            }}
          />
        )}
        {previewMode === "page" && (
          <div className="flex items-start justify-center p-6 bg-muted/30 min-h-full overflow-x-auto">
            {previewLoading ? (
              <p className="text-muted-foreground italic font-ui text-sm">
                Loading preview…
              </p>
            ) : (
              // Wide enough that 12pt body text is comfortably readable.
              // The A4 height that follows from the aspect ratio (≈1100px
              // at 780px wide) intentionally exceeds the editor viewport
              // — the parent .overflow-y-auto handles vertical scrolling
              // so the user reads the page like a real document.
              <PagePreview
                design={bookDesign}
                mode={pageLayout}
                contentHtml={previewHtml}
                pageWidthPx={pageLayout === "spread" ? 440 : 780}
                showCaption
              />
            )}
          </div>
        )}
        {isStreaming && (
          <div className="absolute bottom-4 right-4 flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow-lg">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            AI writing...
          </div>
        )}
        {pendingReview && previewMode === "edit" && editor && (
          <RewriteReviewCard
            editor={editor}
            review={pendingReview}
            showDiff={showDiff}
            onToggleDiff={() => setShowDiff((v) => !v)}
            onRegenerate={regenerateReview}
            onRevert={revertReview}
            onApply={applyReview}
            rewriteBusy={rewriteBusy}
          />
        )}
      </div>

      <CitationPicker
        open={citationPickerOpen}
        onOpenChange={setCitationPickerOpen}
        projectId={projectId}
        onPick={(attrs) => {
          if (!editor) return;
          editor.commands.insertCitation(attrs);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// RewriteReviewCard — Cursor-style floating action card pinned to the
// rewritten range. Renders into document.body via a portal so the card
// can escape the editor's overflow:auto and z-index stacking.
// ---------------------------------------------------------------------------

interface RewriteReviewCardProps {
  editor: NonNullable<ReturnType<typeof useEditor>>;
  review: {
    originalText: string;
    rewriteText: string;
    range: { from: number; to: number };
    action: "rewrite" | "shorten" | "expand" | "academic" | "custom";
    customPrompt?: string;
  };
  showDiff: boolean;
  onToggleDiff: () => void;
  onRegenerate: () => void | Promise<void>;
  onRevert: () => void;
  onApply: () => void;
  rewriteBusy: boolean;
}

const ACTION_LABELS: Record<RewriteReviewCardProps["review"]["action"], string> = {
  rewrite: "Yeniden yazım",
  shorten: "Kısaltma",
  expand: "Genişletme",
  academic: "Akademikleştirme",
  custom: "Özel komut",
};

function RewriteReviewCard({
  editor,
  review,
  showDiff,
  onToggleDiff,
  onRegenerate,
  onRevert,
  onApply,
  rewriteBusy,
}: RewriteReviewCardProps) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const recompute = () => {
      try {
        const docSize = editor.state.doc.content.size;
        const safeFrom = Math.max(0, Math.min(review.range.from, docSize));
        const safeTo = Math.max(safeFrom, Math.min(review.range.to, docSize));
        const start = editor.view.coordsAtPos(safeFrom);
        const end = editor.view.coordsAtPos(safeTo);
        const cardWidth = 460; // matches max-w below
        const left = Math.max(
          12,
          Math.min(window.innerWidth - cardWidth - 12, start.left),
        );
        setPos({ top: end.bottom + 8, left });
      } catch {
        setPos(null);
      }
    };
    recompute();
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [editor, review.range.from, review.range.to]);

  if (!mounted || !pos) return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        zIndex: 50,
        maxWidth: 460,
      }}
      className="rounded-md border border-sandy bg-page shadow-xl overflow-hidden"
    >
      {/* Header strip — small label of which action ran */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-sandy/60 bg-page">
        <Wand2 className="h-3.5 w-3.5 text-gold-dark" />
        <span className="font-ui text-[11px] uppercase tracking-widest text-gold-dark">
          {ACTION_LABELS[review.action]} uygulandı
        </span>
      </div>

      {/* Diff popover (in-card, below header) */}
      {showDiff && (
        <div className="px-3 py-2.5 border-b border-sandy/40 max-h-44 overflow-y-auto bg-white text-[13px] leading-relaxed font-serif text-ink">
          {diffWords(review.originalText, review.rewriteText).map((op, i) => {
            if (op.type === "equal") return <span key={i}>{op.text}</span>;
            if (op.type === "delete") {
              return (
                <span
                  key={i}
                  className="line-through bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200 px-0.5"
                >
                  {op.text}
                </span>
              );
            }
            return (
              <span
                key={i}
                className="bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200 px-0.5"
              >
                {op.text}
              </span>
            );
          })}
        </div>
      )}

      {/* Actions row */}
      <div className="flex items-center gap-1 px-2 py-1.5">
        {/* Tertiary: icon-only Diff + Başka versiyon */}
        <button
          type="button"
          onClick={onToggleDiff}
          className={cn(
            "flex items-center justify-center h-7 w-7 rounded-sm transition-colors",
            showDiff
              ? "bg-gold/20 text-gold-dark"
              : "text-ink-light hover:text-ink hover:bg-sandy/40",
          )}
          title="Karşılaştırma"
          aria-label="Karşılaştırma"
        >
          <GitCompare className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onRegenerate}
          disabled={rewriteBusy}
          className="flex items-center justify-center h-7 w-7 rounded-sm text-ink-light hover:text-ink hover:bg-sandy/40 transition-colors disabled:opacity-40 disabled:pointer-events-none"
          title="Başka versiyon"
          aria-label="Başka versiyon"
        >
          <RotateCw className="h-3.5 w-3.5" />
        </button>

        <div className="flex-1" />

        {/* Secondary: ghost Geri al */}
        <button
          type="button"
          onClick={onRevert}
          className="font-ui text-xs px-2.5 py-1 rounded-sm text-ink-light hover:text-ink hover:bg-sandy/40 transition-colors"
        >
          Geri al
        </button>
        {/* Primary: Tamam */}
        <button
          type="button"
          onClick={onApply}
          className="font-ui text-xs font-semibold px-3 py-1 rounded-sm bg-gold text-ink hover:bg-gold-hover transition-colors"
        >
          Tamam
        </button>
      </div>
    </div>,
    document.body,
  );
}

function ToolbarButton({
  children,
  onClick,
  active,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex items-center justify-center h-7 w-7 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none",
        active && "bg-muted text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function BubbleMenuButton({
  onClick,
  disabled,
  icon,
  label,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-ui font-medium text-foreground hover:bg-muted disabled:opacity-40 disabled:pointer-events-none transition-colors"
    >
      {icon}
      {label}
    </button>
  );
}
