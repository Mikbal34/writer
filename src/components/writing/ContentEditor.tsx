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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Placeholder } from "@tiptap/extension-placeholder";
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

  let html = md;

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
  type RewriteAction = "rewrite" | "shorten" | "expand" | "academic" | "custom";
  const [rewriteBusy, setRewriteBusy] = useState(false);
  const [showCustomRewrite, setShowCustomRewrite] = useState(false);
  const [customRewritePrompt, setCustomRewritePrompt] = useState("");

  async function runRewrite(action: RewriteAction, customPrompt?: string) {
    if (!editor || rewriteBusy) return;
    const { from, to, empty } = editor.state.selection;
    if (empty) return;
    const text = editor.state.doc.textBetween(from, to, "\n", "\n");
    if (!text.trim()) return;

    setRewriteBusy(true);
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
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Rewrite failed");
      }
      const data = (await res.json()) as {
        rewrite: string;
        lostMarkers?: string[];
      };
      const rewrite = data.rewrite?.trim();
      if (!rewrite) {
        toast.error("Empty rewrite — try again with a different action.");
        return;
      }
      // Replace the selection in-place. Use insertContentAt with a range
      // so Tiptap drops the old text and inserts the new in one tx.
      editor
        .chain()
        .focus()
        .insertContentAt({ from, to }, rewrite)
        .run();
      if (data.lostMarkers && data.lostMarkers.length > 0) {
        // The model lost at least one citation, footnote, or
        // cross-reference marker. Don't undo silently — let the user
        // decide whether to revert via Ctrl+Z.
        const labels: Record<string, string> = {
          cite: "atıf",
          fn: "dipnot",
          ref: "cross-ref",
        };
        const lost = data.lostMarkers.map((m) => labels[m] ?? m).join(", ");
        toast.warning(
          `Yeniden yazımda ${lost} markerı kayboldu — kontrol edip gerekirse Ctrl+Z ile geri alabilirsin.`,
          { duration: 8000 },
        );
      } else {
        toast.success(
          action === "custom"
            ? "Custom rewrite uygulandı"
            : "Yeniden yazım uygulandı",
        );
      }
      setShowCustomRewrite(false);
      setCustomRewritePrompt("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rewrite failed");
    } finally {
      setRewriteBusy(false);
    }
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
                return text.length >= 3; // ignore single-character selections
              }}
              className="flex flex-col rounded-md border border-border bg-popover shadow-lg overflow-hidden"
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
                    className="flex-1 px-2 py-1 text-xs font-ui rounded-sm border border-border bg-background focus:outline-none focus:border-[#C9A84C]"
                    disabled={rewriteBusy}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      customRewritePrompt.trim() &&
                      runRewrite("custom", customRewritePrompt.trim())
                    }
                    disabled={rewriteBusy || !customRewritePrompt.trim()}
                    className="px-2 py-1 text-xs font-ui font-medium bg-[#C9A84C] text-[#1A0F05] rounded-sm hover:bg-[#b5943d] disabled:opacity-50 transition-colors"
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
                  <span>AI çalışıyor…</span>
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
      </div>
    </div>
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
