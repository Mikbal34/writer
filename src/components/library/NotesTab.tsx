"use client";

/**
 * NotesTab — list of LibraryNote cards for a single entry.
 *
 * - Each note card: title (optional), date, rendered Tiptap preview (3
 *   lines), optional 📌 chat-pinned + Cilt + Sayfa badges.
 * - Click a card → card expands into an inline NoteEditor (accordion).
 * - "Yeni Not" button at the top → opens an empty editor row.
 * - Tiptap content is rendered read-only with a no-extension editor so
 *   we don't need to hand-implement Tiptap-JSON → React rendering.
 *
 * The component owns no fetch logic beyond its own notes list; it's
 * told which entry to load via props and dispatches save/delete back to
 * the parent via onMutate so the parent can refetch the entry list
 * (note count badge stays accurate).
 */

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Loader2, Pin, BookOpen, FileText } from "lucide-react";
import { toast } from "sonner";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Highlight } from "@tiptap/extension-highlight";
import NoteEditor from "./NoteEditor";

interface VolumeOption {
  id: string;
  volumeNumber: number;
  label: string | null;
}

interface NotesTabProps {
  entryId: string;
  /** When the entry is multi-volume, lets the user anchor a new note
   *  to a specific cilt. Pass [] for single-volume entries. */
  volumes: VolumeOption[];
  onMutate?: () => void;
}

interface LibraryNoteRow {
  id: string;
  title: string | null;
  content: object;
  volumeId: string | null;
  pageNumber: number | null;
  pinnedFromChatSessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Read-only Tiptap renderer for preview / display modes. */
function NotePreview({ json }: { json: object }) {
  const editor = useEditor({
    extensions: [StarterKit, Highlight],
    content: json,
    editable: false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none text-ink [&_p]:my-1.5 [&_h2]:font-display [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:font-display [&_h3]:text-xs [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-gold [&_blockquote]:pl-3 [&_blockquote]:italic [&_mark]:bg-gold/60 [&_mark]:px-0.5",
      },
    },
  });
  useEffect(() => () => editor?.destroy(), [editor]);
  if (!editor) return null;
  return <EditorContent editor={editor} />;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function NotesTab({ entryId, volumes, onMutate }: NotesTabProps) {
  const [notes, setNotes] = useState<LibraryNoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draftVolumeId, setDraftVolumeId] = useState<string | null>(null);
  const [draftPage, setDraftPage] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const fetchNotes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/library/entries/${entryId}/notes`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { notes: LibraryNoteRow[] };
      setNotes(data.notes);
    } catch {
      toast.error("Notlar yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, [entryId]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  async function saveNew(input: { title: string | null; content: object }) {
    setBusy(true);
    try {
      const res = await fetch(`/api/library/entries/${entryId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          volumeId: draftVolumeId,
          pageNumber: draftPage ? parseInt(draftPage, 10) : null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Kaydedilemedi");
      }
      toast.success("Not kaydedildi");
      setEditingId(null);
      setDraftVolumeId(null);
      setDraftPage("");
      await fetchNotes();
      onMutate?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kaydedilemedi");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(
    noteId: string,
    input: { title: string | null; content: object },
  ) {
    setBusy(true);
    try {
      const res = await fetch(`/api/library/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Kaydedilemedi");
      }
      toast.success("Not güncellendi");
      setEditingId(null);
      await fetchNotes();
      onMutate?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kaydedilemedi");
    } finally {
      setBusy(false);
    }
  }

  async function deleteNote(noteId: string) {
    if (!window.confirm("Bu not silinsin mi?")) return;
    try {
      const res = await fetch(`/api/library/notes/${noteId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      toast.success("Not silindi");
      await fetchNotes();
      onMutate?.();
    } catch {
      toast.error("Silinemedi");
    }
  }

  function startNew() {
    setEditingId("new");
    setDraftVolumeId(null);
    setDraftPage("");
  }

  function FooterExtras() {
    return (
      <div className="flex items-center gap-3 font-ui text-xs text-ink-light">
        {volumes.length > 0 && (
          <label className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-ink-light">Cilt</span>
            <select
              value={draftVolumeId ?? ""}
              onChange={(e) => setDraftVolumeId(e.target.value || null)}
              className="px-1.5 py-0.5 rounded-sm border border-sandy bg-white"
            >
              <option value="">(Genel)</option>
              {volumes.map((v) => (
                <option key={v.id} value={v.id}>
                  Cilt {v.volumeNumber}
                  {v.label ? ` — ${v.label}` : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-ink-light">Sayfa</span>
          <input
            type="number"
            min={1}
            value={draftPage}
            onChange={(e) => setDraftPage(e.target.value)}
            placeholder="opsiyonel"
            className="w-20 px-1.5 py-0.5 rounded-sm border border-sandy bg-white"
          />
        </label>
      </div>
    );
  }

  return (
    <div className="px-4 py-4 space-y-3">
      {editingId !== "new" && (
        <button
          type="button"
          onClick={startNew}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm border border-dashed border-gold/50 bg-gold/8 text-ink-light font-ui text-xs hover:bg-gold/15 transition-colors w-full justify-center"
        >
          <Plus className="h-3.5 w-3.5" />
          Yeni Not
        </button>
      )}

      {editingId === "new" && (
        <NoteEditor
          initialContent={null}
          initialTitle={null}
          onSave={saveNew}
          onCancel={() => setEditingId(null)}
          saving={busy}
          footerExtras={<FooterExtras />}
        />
      )}

      {loading && (
        <div className="flex items-center gap-2 px-3 py-4 font-body text-xs text-ink-light">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Notlar yükleniyor...
        </div>
      )}

      {!loading && notes.length === 0 && editingId !== "new" && (
        <div className="rounded-sm border border-dashed border-sandy bg-page/30 px-4 py-8 text-center">
          <FileText className="h-5 w-5 text-sandy mx-auto mb-2" />
          <p className="font-body text-sm text-ink-light mb-1">
            Bu kitap için henüz not yok.
          </p>
          <p className="font-ui text-[11px] text-ink-muted">
            + Yeni Not ile başlayabilirsin.
          </p>
        </div>
      )}

      {notes.map((note) => {
        const vol = note.volumeId
          ? volumes.find((v) => v.id === note.volumeId)
          : null;
        if (editingId === note.id) {
          return (
            <NoteEditor
              key={note.id}
              initialContent={note.content}
              initialTitle={note.title}
              onSave={(input) => saveEdit(note.id, input)}
              onCancel={() => setEditingId(null)}
              saving={busy}
            />
          );
        }
        return (
          <article
            key={note.id}
            className="group rounded-sm border border-sandy/60 bg-white/70 hover:bg-white transition-colors"
          >
            <header className="px-3 pt-2.5 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3
                  dir="auto"
                  className="font-display text-sm font-semibold text-ink truncate"
                >
                  {note.title || "(başlıksız)"}
                </h3>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="font-ui text-[10px] text-ink-light">
                    {formatDate(note.updatedAt)}
                  </span>
                  {note.pinnedFromChatSessionId && (
                    <span className="inline-flex items-center gap-0.5 font-ui text-[10px] text-gold-dark">
                      <Pin className="h-2.5 w-2.5" />
                      Chat'ten
                    </span>
                  )}
                  {vol && (
                    <span className="inline-flex items-center gap-0.5 font-ui text-[10px] text-ink-light">
                      <BookOpen className="h-2.5 w-2.5" />
                      Cilt {vol.volumeNumber}
                    </span>
                  )}
                  {note.pageNumber && (
                    <span className="font-ui text-[10px] text-ink-light">
                      s. {note.pageNumber}
                    </span>
                  )}
                </div>
              </div>
              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setEditingId(note.id)}
                  className="font-ui text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border border-sandy text-ink-light hover:bg-page"
                >
                  Düzenle
                </button>
                <button
                  type="button"
                  onClick={() => deleteNote(note.id)}
                  className="text-ink-muted hover:text-red-600"
                  aria-label="Notu sil"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </header>
            <div className="px-3 pb-3 pt-1.5 cursor-pointer" onClick={() => setEditingId(note.id)}>
              <NotePreview json={note.content} />
            </div>
          </article>
        );
      })}
    </div>
  );
}
