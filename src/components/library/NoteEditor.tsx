"use client";

/**
 * Lightweight Tiptap editor for library notes.
 *
 * Smaller surface than the writing-page ContentEditor:
 *   - StarterKit (paragraph, headings, bold/italic/strike/code,
 *     blockquote, lists, hard break)
 *   - Highlight extension (already a project dep)
 *   - Placeholder
 *
 * Toolbar uses inline tailwind buttons rather than a primitive bar so
 * the editor drops into the sidebar without extra layout. Tiptap JSON
 * (not HTML) is what we persist — `onSave` receives the doc.
 */

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Highlight } from "@tiptap/extension-highlight";
import { Placeholder } from "@tiptap/extension-placeholder";
import {
  Bold,
  Italic,
  Heading2,
  List,
  ListOrdered,
  Quote,
  Code,
  Highlighter,
  Strikethrough,
} from "lucide-react";
import { useEffect, useState } from "react";

interface NoteEditorProps {
  /** Initial Tiptap JSON. Pass null for an empty editor. */
  initialContent: object | null;
  initialTitle?: string | null;
  /** Submit handler; receives the latest Tiptap JSON + title. */
  onSave: (input: { title: string | null; content: object }) => void | Promise<void>;
  onCancel: () => void;
  saving?: boolean;
  /** Extra slot below the editor — used by parent to insert
   *  cilt / page-number selectors. */
  footerExtras?: React.ReactNode;
}

function ToolbarButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`h-7 w-7 flex items-center justify-center rounded-sm transition-colors ${
        active
          ? "bg-ink text-page"
          : "text-ink-light hover:bg-gold/15"
      }`}
    >
      {children}
    </button>
  );
}

export default function NoteEditor({
  initialContent,
  initialTitle,
  onSave,
  onCancel,
  saving,
  footerExtras,
}: NoteEditorProps) {
  const [title, setTitle] = useState(initialTitle ?? "");

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Highlight.configure({ multicolor: false }),
      Placeholder.configure({
        placeholder: "Notunu yazmaya başla...",
      }),
    ],
    content: initialContent ?? undefined,
    autofocus: "end",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        // Tailwind prose with our ink/parchment palette. min-h gives the
        // editor a comfortable target before the user starts typing.
        class:
          "prose prose-sm max-w-none focus:outline-none min-h-[160px] text-ink [&_p]:my-2 [&_h2]:font-display [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-display [&_h3]:text-sm [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-gold [&_blockquote]:pl-3 [&_blockquote]:italic [&_mark]:bg-gold/60 [&_mark]:px-0.5",
      },
    },
  });

  useEffect(() => {
    return () => {
      editor?.destroy();
    };
  }, [editor]);

  function handleSave() {
    if (!editor) return;
    const content = editor.getJSON();
    onSave({ title: title.trim() || null, content });
  }

  if (!editor) {
    return (
      <div className="rounded-sm border border-sandy bg-page/60 p-4 font-body text-sm text-ink-light">
        Editor yükleniyor...
      </div>
    );
  }

  return (
    <div className="rounded-sm border border-sandy bg-page/40 p-3 space-y-2">
      {/* Title input */}
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Başlık (opsiyonel)"
        className="w-full px-2 py-1.5 rounded-sm border border-sandy/60 bg-white font-display text-sm font-semibold text-ink placeholder:text-ink-muted focus:outline-none focus:border-gold/60"
      />

      {/* Toolbar */}
      <div className="flex items-center gap-0.5 pb-1 border-b border-sandy/60">
        <ToolbarButton
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Kalın"
        >
          <Bold className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="İtalik"
        >
          <Italic className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          title="Üstü çizili"
        >
          <Strikethrough className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("highlight")}
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          title="Vurgu"
        >
          <Highlighter className="h-3.5 w-3.5" />
        </ToolbarButton>
        <span className="w-px h-4 bg-sandy mx-1" />
        <ToolbarButton
          active={editor.isActive("heading", { level: 2 })}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
          title="Başlık"
        >
          <Heading2 className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          title="Alıntı"
        >
          <Quote className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title="Madde işaretli liste"
        >
          <List className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title="Numaralı liste"
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("codeBlock")}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          title="Kod bloğu"
        >
          <Code className="h-3.5 w-3.5" />
        </ToolbarButton>
      </div>

      {/* Editor surface */}
      <EditorContent editor={editor as Editor} />

      {footerExtras && (
        <div className="pt-2 border-t border-sandy/60">{footerExtras}</div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="px-3 py-1.5 rounded-sm border border-sandy font-ui text-xs text-ink-light hover:bg-page disabled:opacity-40"
        >
          İptal
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 rounded-sm bg-forest text-page font-ui text-xs hover:bg-forest/90 disabled:opacity-40"
        >
          {saving ? "Kaydediliyor..." : "Kaydet"}
        </button>
      </div>
    </div>
  );
}
