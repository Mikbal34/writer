"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Save,
  CheckCircle2,
  Loader2,
  Eye,
  EyeOff,
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Placeholder } from "@tiptap/extension-placeholder";

interface ContentEditorProps {
  subsectionId: string;
  projectId: string;
  initialContent: string;
  status: string;
  onContentChange?: (content: string) => void;
  streamingContent?: string;
  isStreaming?: boolean;
}

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-muted text-muted-foreground" },
  in_progress: {
    label: "In Progress",
    className: "bg-accent text-primary",
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
}: ContentEditorProps) {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [showPreview, setShowPreview] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusInfo = STATUS_STYLES[status] ?? STATUS_STYLES.pending;
  const lastStreamRef = useRef<string>("");
  const isStreamingRef = useRef(isStreaming);
  isStreamingRef.current = isStreaming;

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

          {/* Formatting buttons */}
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
        </div>

        <div className="flex items-center gap-2">
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

      {/* Editor */}
      <div className="flex-1 overflow-y-auto relative">
        <EditorContent editor={editor} className="h-full" />
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
