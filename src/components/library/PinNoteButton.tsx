"use client";

/**
 * Pin a chat assistant message as a LibraryNote on a chosen entry.
 *
 * Renders a small "📌 Nota Kaydet" trigger; on click opens a popover
 * with a searchable entry picker (filtered by the user's library — we
 * reuse the chat's already-loaded list via the `entries` prop instead
 * of refetching). Picking an entry POSTs to
 * /api/library/chat/pin-note and toasts the result.
 *
 * The first matched entry suggestion is the one referenced in any of
 * the message's source citations — if the assistant said something
 * about al-Tabari, "al-Tabari, Câmi'" is at the top. This keeps the
 * pin one-click in 80% of cases.
 */

import { useMemo, useState } from "react";
import { Pin, Search, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface PinNoteButtonProps {
  sessionId: string;
  messageContent: string;
  /** Entries already loaded in the chat sidebar — passed in to avoid
   *  a second roundtrip to /api/library. */
  entries: Array<{
    id: string;
    title: string;
    authorSurname: string;
    authorName: string | null;
    year: string | null;
  }>;
  /** Entry IDs the assistant message cited. The picker promotes these
   *  to the top so the most likely target is one click away. */
  suggestedEntryIds: string[];
}

export default function PinNoteButton({
  sessionId,
  messageContent,
  entries,
  suggestedEntryIds,
}: PinNoteButtonProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [pinned, setPinned] = useState(false);

  const ordered = useMemo(() => {
    const sug = new Set(suggestedEntryIds);
    const list = [...entries];
    list.sort((a, b) => {
      const aSug = sug.has(a.id) ? 0 : 1;
      const bSug = sug.has(b.id) ? 0 : 1;
      if (aSug !== bSug) return aSug - bSug;
      return a.authorSurname.localeCompare(b.authorSurname);
    });
    return list;
  }, [entries, suggestedEntryIds]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter((e) => {
      const hay = [e.title, e.authorSurname, e.authorName ?? "", e.year ?? ""]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [ordered, search]);

  async function pin(entryId: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/library/chat/pin-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          messageContent,
          entryId,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Kaydedilemedi");
      }
      const entry = entries.find((e) => e.id === entryId);
      toast.success(
        entry
          ? `Not "${entry.authorSurname}, ${entry.title}" kitabına kaydedildi.`
          : "Not kaydedildi.",
      );
      setOpen(false);
      setPinned(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kaydedilemedi");
    } finally {
      setBusy(false);
    }
  }

  if (pinned) {
    return (
      <span className="inline-flex items-center gap-1 font-ui text-[10px] text-[#5C4A32]">
        <Pin className="h-3 w-3" />
        Nota kaydedildi
      </span>
    );
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm font-ui text-[10px] text-[#5C4A32] hover:bg-[#C9A84C]/15 transition-colors"
      >
        <Pin className="h-3 w-3" />
        Nota Kaydet
      </button>
      {open && (
        <div className="absolute z-30 left-0 mt-1 w-72 rounded-sm border border-[#d4c9b5] bg-white shadow-lg">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[#d4c9b5]/60">
            <span className="font-ui text-[10px] uppercase tracking-widest text-[#8a7a65]">
              Hangi kitaba?
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[#8a7a65] hover:text-[#2D1F0E]"
              aria-label="Kapat"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="px-2 py-2 border-b border-[#d4c9b5]/60">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-sm border border-[#d4c9b5] bg-[#FAF7F0]/60">
              <Search className="h-3 w-3 text-[#a89a82]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Kitap ara..."
                className="flex-1 bg-transparent outline-none font-ui text-xs text-[#2D1F0E] placeholder:text-[#a89a82]"
              />
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 font-body text-xs text-[#8a7a65] italic text-center">
                Eşleşen kaynak yok.
              </div>
            ) : (
              filtered.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => pin(e.id)}
                  disabled={busy}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#FAF7F0] disabled:opacity-50 transition-colors border-b border-[#d4c9b5]/30 last:border-0"
                >
                  <div
                    dir="auto"
                    className="font-body text-xs font-semibold text-[#2D1F0E] truncate"
                  >
                    {suggestedEntryIds.includes(e.id) && "⭐ "}
                    {e.title}
                  </div>
                  <div
                    dir="auto"
                    className="font-ui text-[10px] text-[#5C4A32] truncate"
                  >
                    {e.authorSurname}
                    {e.authorName ? `, ${e.authorName}` : ""}
                    {e.year ? ` · ${e.year}` : ""}
                  </div>
                </button>
              ))
            )}
          </div>
          {busy && (
            <div className="flex items-center gap-2 px-3 py-2 border-t border-[#d4c9b5]/60 font-ui text-[10px] text-[#8a7a65]">
              <Loader2 className="h-3 w-3 animate-spin" />
              Kaydediliyor...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
