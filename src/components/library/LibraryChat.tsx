"use client";

/**
 * V9 Library Chat. Three columns inside the workspace gutter:
 *
 *   ┌────────┬─────────────────┬─────────────────────────────┐
 *   │history │ (PDF when       │ chat: dark hero + thread    │
 *   │ rail   │  citation       │ + composer                  │
 *   │240/52  │  active)        │                             │
 *   └────────┴─────────────────┴─────────────────────────────┘
 *
 * The history rail collapses to 52px (initial-letter dots) once a PDF
 * is opened. Citation chips in assistant messages are rich cards: mini
 * book spine + page badge + meta + chevron, with a "SOLDA AÇIK" pill
 * when the chip's source is the one currently rendered in the PDF.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import {
  Plus,
  Loader2,
  MessageSquare,
  Sparkles,
  ChevronRight,
  Search,
  Filter as FilterIcon,
  Quote,
  Send,
  Square,
  X as XIcon,
  Highlighter,
  StickyNote,
  Library as LibraryIcon,
  Pencil,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { useLibraryChatSession } from "@/components/chat/useLibraryChatSession";
import type { ChatMessage, ChatSource } from "@/components/chat/MessageBubble";
import PinNoteButton from "@/components/library/PinNoteButton";
import CiteToThesisDialog from "@/components/library/CiteToThesisDialog";

// pdfjs-dist needs window globals — dynamic import with ssr:false.
const PdfReaderPanel = dynamic(
  () => import("@/components/library/PdfReaderPanel"),
  { ssr: false, loading: () => null },
);

// Multi-colour spine palette so the same book always reads with the
// same colour across the chat surface (rail dots, citation chips,
// PDF breadcrumb). Stable hash off the entryId.
const SPINE_COLORS = [
  "#3a5238",
  "#5a4a2a",
  "#8a6a3d",
  "#6a3a2a",
  "#2a3d28",
  "#a08a5a",
  "#4a3a2a",
  "#b89149",
];
function spineColorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return SPINE_COLORS[Math.abs(h) % SPINE_COLORS.length];
}

type SuggestionIcon = "quote" | "note" | "sparkles" | "highlighter";
interface Suggestion {
  icon: SuggestionIcon;
  text: string;
}

// Fallback suggestions when /api/library/chat/suggestions hasn't
// resolved yet or the user has no library entries. The endpoint
// returns the same shape with prompts tailored to the user's
// actual library.
const FALLBACK_SUGGESTIONS: Suggestion[] = [
  {
    icon: "quote",
    text: "Kütüphanene bir kitap eklediğinde, ana iddialarını birkaç cümleyle özetleyebilirim.",
  },
  {
    icon: "note",
    text: "Önce birkaç PDF yükle — sonra hangi kaynakların birbiriyle çeliştiğini gösterebilirim.",
  },
  {
    icon: "sparkles",
    text: "Bir konu seç — sana o konuda kütüphanende eksik kalan perspektifleri söyleyeyim.",
  },
  {
    icon: "highlighter",
    text: "Bir bölümün önemli pasajlarını bulup alıntılayabilirim.",
  },
];

interface ActiveSource {
  entryId: string;
  /** Multi-volume entries: which volume the citation came from, so the
   *  PDF panel opens the correct PDF. Null for single-volume entries
   *  (server then falls back to entry.filePath or the first volume). */
  volumeId: string | null;
  page: number | null;
  title: string;
  authorSurname: string | null;
  color: string;
  /** First chars of the cited passage; rendered as a banner above the
   *  PDF body so the reader sees what the AI specifically quoted. */
  quote: string | null;
}

interface LibraryChatProps {
  /** Server-supplied entryId. Without this prop the component would
   *  fall back to useSearchParams, which returns undefined during
   *  SSR — that produced a one-frame flash of the library-wide
   *  header + fallback suggestions before the client mount swapped
   *  to single-book mode. */
  initialEntryId?: string;
  /** Server-supplied title for that entry. The header would otherwise
   *  briefly fall back to "Kütüphanenle konuş" while waiting for the
   *  client-side allEntries fetch to land — knowing the title server-
   *  side lets the very first paint render the correct book name. */
  initialEntryTitle?: string | null;
}

export default function LibraryChat({
  initialEntryId: serverEntryId,
  initialEntryTitle = null,
}: LibraryChatProps = {}) {
  const router = useRouter();
  const params = useSearchParams();
  // Server prop is authoritative on first paint; fall back to the
  // client-side URL parse only when the page was rendered without
  // one (legacy routes, programmatic mounts).
  const initialEntryId =
    serverEntryId ?? params.get("entryId") ?? undefined;

  const session = useLibraryChatSession({ initialEntryId });
  const {
    sessions,
    currentSessionId,
    messages,
    isLoadingHistory,
    allEntries,
    input,
    setInput,
    isStreaming,
    threadRef,
    sendMessage,
    stopStream,
    startNewSession,
    pickSession,
    selectedIds,
    setSelectedIds,
  } = session;

  // Single active source — only one PDF visible at a time in the left
  // panel. Clicking a different citation swaps it in.
  const [activeSource, setActiveSource] = useState<ActiveSource | null>(null);
  const [railSearch, setRailSearch] = useState("");

  // Every page that has been cited from the currently-open entry in
  // this conversation. Powers the "Sohbette atıf yapılan diğer
  // sayfalar" jump-pill strip in the PDF footer.
  const cohortPages = useMemo(() => {
    if (!activeSource) return [] as number[];
    const seen = new Set<number>();
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      for (const s of m.sources ?? []) {
        if (s.entryId !== activeSource.entryId) continue;
        if (s.page === null || s.page === undefined) continue;
        seen.add(s.page);
      }
    }
    return Array.from(seen).sort((a, b) => a - b);
  }, [messages, activeSource]);

  const pdfOpen = activeSource !== null;
  const hasMessages = messages.length > 0;

  const handleOpenSource = useCallback(
    (src: ChatSource) => {
      setActiveSource({
        entryId: src.entryId,
        volumeId: src.volumeId ?? null,
        page: src.page,
        title: src.title,
        authorSurname: src.authorSurname,
        color: spineColorFor(src.entryId),
        quote: src.text?.trim() || null,
      });
    },
    [],
  );

  const handleStartNewSession = useCallback(() => {
    startNewSession();
    setActiveSource(null);
    // Previously we router.replaced to /library/chat here, which
    // silently dropped the ?entryId query param — every "new
    // session" in a per-book chat surface bounced the user out to
    // the library-wide mode (Kütüphanenle konuş header, fallback
    // suggestions). Keep the entryId in the URL so a new session
    // started inside a single-book chat stays single-book.
  }, [startNewSession]);

  const handleSuggestion = useCallback(
    (text: string) => {
      setInput(text);
      // Defer to next tick so the input state flush completes before
      // sendMessage reads it.
      setTimeout(() => {
        sendMessage();
      }, 0);
    },
    [setInput, sendMessage],
  );

  // "Karşı tezi sor" — auto-compose a follow-up prompt that asks the
  // model to argue against the assistant's most recent claim. We feed
  // a truncated quote into the prompt so the model anchors to the
  // exact answer instead of guessing context.
  const handleCounterThesis = useCallback(
    (msg: ChatMessage) => {
      const quote = msg.content.length > 320
        ? msg.content.slice(0, 320) + "…"
        : msg.content;
      const prompt = `Az önceki cevabıma karşı tezi sun. Hangi noktalar zayıf, hangi kaynaklar bu görüşe itiraz ediyor? Aynı kütüphaneden farklı kaynaklarla destekle.\n\n> ${quote.replace(/\n+/g, "\n> ")}`;
      setInput(prompt);
      setTimeout(() => {
        sendMessage();
      }, 0);
    },
    [setInput, sendMessage],
  );

  // "Tezime alıntıla" — opens the project/subsection picker. The
  // dialog itself owns the POST to the append endpoint.
  const [citeDialogText, setCiteDialogText] = useState<string | null>(null);
  const handleCitateToThesis = useCallback((msg: ChatMessage) => {
    setCiteDialogText(msg.content);
  }, []);

  const filteredSessions = useMemo(() => {
    const q = railSearch.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => (s.preview ?? "").toLowerCase().includes(q));
  }, [sessions, railSearch]);

  // Header — the current session's "preview" (Önceki sohbet özeti)
  // or a default greeting when starting fresh.
  const currentSessionPreview = useMemo(() => {
    const found = sessions.find((s) => s.sessionId === currentSessionId);
    return found?.preview ?? null;
  }, [sessions, currentSessionId]);

  return (
    <div className="flex flex-1 min-h-0 gap-3.5">
      {/* === Conversation history rail === */}
      <ConversationRail
        collapsed={pdfOpen}
        sessions={filteredSessions}
        currentSessionId={currentSessionId}
        railSearch={railSearch}
        setRailSearch={setRailSearch}
        onPickSession={pickSession}
        onNewSession={handleStartNewSession}
        allEntries={allEntries}
      />

      {/* === Left PDF panel — visible only when a citation is active === */}
      {pdfOpen && activeSource && (
        <section className="flex-[1.05] min-w-0 flex flex-col rounded-2xl bg-elevated overflow-hidden relative">
          <PdfReaderPanel
            // Full remount when the citation switches to a different
            // entry/volume so internal PDF state (page index, render
            // canvas, highlight list) is not carried across between
            // two unrelated books — that mid-state carry-over showed
            // up as "two pages loading at once".
            key={`${activeSource.entryId}:${activeSource.volumeId ?? "x"}`}
            entryId={activeSource.entryId}
            volumeId={activeSource.volumeId}
            title={activeSource.title}
            targetPage={activeSource.page}
            cohortPages={cohortPages}
            chatQuote={activeSource.quote}
            onJumpToPage={(p) =>
              setActiveSource((prev) =>
                prev ? { ...prev, page: p, quote: null } : prev,
              )
            }
          />
          {/* Close PDF button overlays the toolbar's right edge */}
          <button
            type="button"
            onClick={() => setActiveSource(null)}
            className="absolute top-2.5 right-3 h-7 w-7 flex items-center justify-center rounded-sm text-ink-muted hover:bg-panel hover:text-ink transition-colors z-20"
            title="PDF'i kapat"
            aria-label="PDF'i kapat"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </section>
      )}

      {/* === Chat panel === */}
      <section className="flex-1 min-w-0 flex flex-col rounded-2xl bg-elevated overflow-hidden">
        {/* Dark forest hero header */}
        <ChatHeader
          pdfOpen={pdfOpen}
          messages={messages}
          currentSessionPreview={currentSessionPreview}
          initialEntryId={initialEntryId}
          initialEntryTitle={initialEntryTitle}
          allEntries={allEntries}
        />

        {/* Body */}
        {isLoadingHistory ? (
          <div className="flex-1 flex items-center justify-center gap-2 text-ink-light">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="font-body italic text-xs">
              Sohbet geçmişi yükleniyor…
            </span>
          </div>
        ) : !hasMessages ? (
          <EmptyWelcome onPick={handleSuggestion} entryId={initialEntryId} />
        ) : (
          <ActiveConversation
            messages={messages}
            isStreaming={isStreaming}
            threadRef={threadRef}
            allEntries={allEntries}
            sessionId={currentSessionId}
            activeSource={activeSource}
            onOpenSource={handleOpenSource}
            onCounterThesis={handleCounterThesis}
            onCitateToThesis={handleCitateToThesis}
          />
        )}

        {/* "Tezime alıntıla" picker — modal flow so it doesn't dislodge
            the chat thread. */}
        <CiteToThesisDialog
          open={citeDialogText !== null}
          onOpenChange={(open) => {
            if (!open) setCiteDialogText(null);
          }}
          text={citeDialogText ?? ""}
          sessionLabel={currentSessionPreview}
        />

        {/* Composer */}
        <Composer
          value={input}
          onChange={setInput}
          onSubmit={sendMessage}
          onStop={stopStream}
          isStreaming={isStreaming}
          scopedCount={selectedIds.size}
          onClearScope={() => setSelectedIds(new Set())}
          allEntries={allEntries.map((e) => ({
            id: e.id,
            title: e.title,
            authorSurname: e.authorSurname,
            authorName: e.authorName,
            year: e.year,
          }))}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          placeholder={
            pdfOpen
              ? "Devam ettir veya yeni soru sor…"
              : selectedIds.size > 0
                ? `${selectedIds.size} kitaba sor…`
                : "Kütüphanene bir şey sor…"
          }
        />
      </section>
    </div>
  );
}

// ── Conversation history rail ───────────────────────────────────

interface SessionRowLite {
  sessionId: string;
  preview: string;
  createdAt: string;
  messageCount: number;
}

function ConversationRail({
  collapsed,
  sessions,
  currentSessionId,
  railSearch,
  setRailSearch,
  onPickSession,
  onNewSession,
  allEntries,
}: {
  collapsed: boolean;
  sessions: SessionRowLite[];
  currentSessionId: string;
  railSearch: string;
  setRailSearch: (v: string) => void;
  onPickSession: (id: string) => void;
  onNewSession: () => void;
  allEntries: Array<{ id: string }>;
}) {
  if (collapsed) {
    return (
      <aside className="w-[52px] shrink-0 rounded-2xl bg-elevated overflow-hidden flex flex-col items-center py-3.5 gap-1">
        <button
          type="button"
          onClick={onNewSession}
          title="Yeni sohbet"
          className="h-9 w-9 rounded-[9px] flex items-center justify-center bg-gold text-white shadow-[0_2px_6px_rgba(184,145,73,0.25)] hover:bg-gold-hover transition-colors"
        >
          <Plus className="h-4 w-4" />
        </button>

        <div className="h-px w-6 bg-sandy-soft my-2" />

        <div className="flex-1 w-full overflow-y-auto flex flex-col items-center gap-1 px-1">
          {sessions.map((s) => {
            const active = s.sessionId === currentSessionId;
            return (
              <button
                key={s.sessionId}
                type="button"
                onClick={() => onPickSession(s.sessionId)}
                title={s.preview || "(Boş sohbet)"}
                className={cn(
                  "relative h-9 w-9 rounded-[9px] flex items-center justify-center transition-colors",
                  active
                    ? "bg-panel ring-1 ring-gold"
                    : "hover:bg-panel",
                )}
              >
                <span
                  className={cn(
                    "font-display italic font-semibold text-sm leading-none",
                    active ? "text-gold" : "text-ink-muted",
                  )}
                >
                  {firstLetter(s.preview ?? "—")}
                </span>
                {active && (
                  <span
                    className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-gold"
                    style={{ boxShadow: "0 0 0 2px var(--color-panel)" }}
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="h-px w-6 bg-sandy-soft my-1.5" />
        <button
          type="button"
          title="Sohbetlerde ara"
          className="h-7 w-7 rounded-[9px] flex items-center justify-center text-ink-muted hover:bg-panel hover:text-ink transition-colors"
        >
          <Search className="h-3.5 w-3.5" />
        </button>
      </aside>
    );
  }

  // Expanded 240px
  return (
    <aside className="w-[240px] shrink-0 rounded-2xl bg-elevated overflow-hidden flex flex-col">
      <div className="px-3.5 pt-4 pb-3 border-b border-sandy/60">
        <div className="font-ui inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-forest mb-1">
          <LibraryIcon className="h-3 w-3" />
          Kütüphane sohbeti
        </div>
        <div className="font-body text-[11.5px] text-ink-muted leading-snug">
          {allEntries.length} kaynak taranabilir
        </div>
      </div>

      <div className="px-3 pt-3 pb-2">
        <button
          type="button"
          onClick={onNewSession}
          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-gold text-white font-ui text-[12px] font-semibold hover:bg-gold-hover transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Yeni sohbet
        </button>
      </div>

      <div className="px-4 pt-2 pb-1.5">
        <div className="font-ui text-[10px] uppercase tracking-[0.16em] text-ink-muted">
          Önceki sohbetler
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {/* Inline search filter */}
        <div className="px-1 mb-1.5">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-ink-muted" />
            <input
              type="text"
              value={railSearch}
              onChange={(e) => setRailSearch(e.target.value)}
              placeholder="Ara…"
              className="w-full pl-7 pr-2 py-1.5 rounded-sm border border-sandy/60 bg-panel text-[11.5px] outline-none focus:border-gold"
            />
          </div>
        </div>

        {sessions.length === 0 ? (
          <p className="text-center font-body italic text-xs text-ink-muted py-6 px-2">
            Henüz sohbet yok.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {sessions.map((s) => {
              const active = s.sessionId === currentSessionId;
              return (
                <li key={s.sessionId}>
                  <button
                    type="button"
                    onClick={() => onPickSession(s.sessionId)}
                    className={cn(
                      "w-full text-left px-2.5 py-2 rounded-sm transition-colors",
                      active
                        ? "bg-panel border-l-2 border-gold"
                        : "hover:bg-panel border-l-2 border-transparent",
                    )}
                  >
                    <div
                      className={cn(
                        "font-display italic text-[12.5px] leading-snug line-clamp-2",
                        active
                          ? "text-ink font-semibold"
                          : "text-ink-light",
                      )}
                    >
                      {s.preview || "(Boş sohbet)"}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 font-ui text-[10.5px] text-ink-muted">
                      <span>{formatSessionWhen(s.createdAt)}</span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-0.5">
                        <MessageSquare className="h-2.5 w-2.5" />
                        {s.messageCount}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

function firstLetter(s: string): string {
  const m = s.match(/[a-zçğıöşüâîû]/i);
  return m ? m[0].toUpperCase() : "•";
}

function formatSessionWhen(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diffMs < day) {
    return `Bugün, ${d.toLocaleTimeString("tr-TR", {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }
  if (diffMs < 2 * day) return "Dün";
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)} gün önce`;
  return d.toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
}

// ── Chat header ────────────────────────────────────────────────

function ChatHeader({
  pdfOpen,
  messages,
  currentSessionPreview,
  initialEntryId,
  initialEntryTitle,
  allEntries,
}: {
  pdfOpen: boolean;
  messages: ChatMessage[];
  currentSessionPreview: string | null;
  initialEntryId?: string;
  initialEntryTitle?: string | null;
  allEntries: Array<{ id: string; title: string }>;
}) {
  const titleEntry =
    currentSessionPreview ??
    (messages.length > 0 ? messages[0]?.content?.slice(0, 80) : null);
  return (
    <header
      className={cn(
        "relative overflow-hidden text-gold-soft",
        pdfOpen ? "px-6 py-4" : "px-8 pt-6 pb-5",
      )}
      style={{
        background:
          "linear-gradient(135deg, var(--color-forest-deep) 0%, #1a2818 100%)",
      }}
    >
      {(() => {
        // When the chat is scoped to a single book, surface that
        // up front so the user knows the suggestions / retrieval
        // are book-scoped rather than library-wide.
        // Title priority: server-prefetched title wins (server-rendered
        // first paint), fall back to the client allEntries lookup
        // once it lands. The fallback covers programmatic mounts
        // where the page didn't pre-resolve.
        const singleBookTitle = initialEntryId
          ? (initialEntryTitle ??
              allEntries.find((e) => e.id === initialEntryId)?.title ??
              null)
          : null;
        return (
          <>
            <div className="font-ui inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-gold-soft/65 mb-1">
              <Sparkles className="h-3 w-3" />
              {singleBookTitle ? "Kitap sohbeti" : "Kütüphane sohbeti"}
            </div>
            <div className="flex items-baseline gap-3 flex-wrap">
              <h2
                className={cn(
                  "font-display italic font-medium text-white leading-tight",
                  pdfOpen ? "text-[20px]" : "text-[28px]",
                )}
              >
                {pdfOpen && titleEntry
                  ? truncate(titleEntry, 60)
                  : singleBookTitle
                    ? truncate(singleBookTitle, 70)
                    : "Kütüphanenle konuş"}
              </h2>
              {pdfOpen && (
                <span className="font-ui text-[11px] text-gold-soft/65">
                  · {messages.length} mesaj
                </span>
              )}
            </div>
            {!pdfOpen && (
              <p className="mt-2 font-body text-[13px] leading-relaxed text-gold-soft/85 max-w-[520px]">
                {singleBookTitle
                  ? "Bu kitabın içeriğine sor. Yanıt, kitabın pasajlarından sayfa numarasıyla alıntılanır."
                  : "Kaynaklarına birden sor. Yanıt, kullandığı kitaplardan başlık ve sayfa numarasıyla alıntılanır. Bir kaynak chip'ine tıkla — PDF solda açılır."}
              </p>
            )}
          </>
        );
      })()}
    </header>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n).trimEnd() + "…";
}

// ── Empty welcome ──────────────────────────────────────────────

function EmptyWelcome({
  onPick,
  entryId,
}: {
  onPick: (text: string) => void;
  /** When the chat surface was opened for a single book
   *  (`/library/chat?entryId=…`), pass it along so suggestions are
   *  generated from that book's own chunks rather than the whole
   *  library. */
  entryId?: string;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const qs = entryId
      ? `?entryId=${encodeURIComponent(entryId)}`
      : "";
    fetch(`/api/library/chat/suggestions${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { suggestions?: Suggestion[] } | null) => {
        if (cancelled) return;
        if (data?.suggestions && data.suggestions.length === 4) {
          setSuggestions(data.suggestions);
        } else {
          setSuggestions(FALLBACK_SUGGESTIONS);
        }
      })
      .catch(() => {
        if (!cancelled) setSuggestions(FALLBACK_SUGGESTIONS);
      });
    return () => {
      cancelled = true;
    };
  }, [entryId]);

  return (
    <div className="flex-1 overflow-y-auto px-8 py-8 flex flex-col">
      {/* Book stack */}
      <div className="flex justify-center mb-5">
        <div className="flex items-end gap-1">
          {[
            { c: "#3a5238", h: 78, w: 18 },
            { c: "#5a4a2a", h: 90, w: 20 },
            { c: "#8a6a3d", h: 70, w: 16 },
            { c: "#2a3d28", h: 100, w: 22 },
            { c: "#a08a5a", h: 82, w: 18 },
            { c: "#6a3a2a", h: 88, w: 19 },
            { c: "#b89149", h: 74, w: 17 },
          ].map((b, i) => (
            <div
              key={i}
              style={{
                width: b.w,
                height: b.h,
                background: `linear-gradient(135deg, ${b.c}, ${shadeHex(b.c, -25)})`,
                borderRadius: "2px 3px 3px 2px",
                boxShadow:
                  "inset -2px 0 0 rgba(0,0,0,0.18), inset 2px 0 0 rgba(255,255,255,0.08), 0 4px 8px rgba(0,0,0,0.12)",
              }}
            />
          ))}
        </div>
      </div>

      <div className="text-center mb-1">
        <div className="font-display italic font-semibold text-[20px] text-ink">
          Ne sormak istersin?
        </div>
        <div className="mt-1 font-body text-[12.5px] text-ink-light">
          {suggestions === null
            ? "Kütüphanenden örnek sorular hazırlanıyor…"
            : "Aşağıdaki örneklerden birini seç veya kendi sorunu yaz."}
        </div>
      </div>

      {/* Suggested prompts grid */}
      <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-2.5 max-w-[720px] mx-auto w-full">
        {suggestions === null
          ? Array.from({ length: 4 }).map((_, i) => (
              <SuggestionSkeleton key={i} />
            ))
          : suggestions.map((s, i) => (
              <SuggestionCard
                key={i}
                icon={s.icon}
                text={s.text}
                onClick={() => onPick(s.text)}
              />
            ))}
      </div>

      {/* Tip */}
      <div className="mt-auto pt-6">
        <div className="rounded-lg border border-sandy/60 bg-panel px-4 py-3 flex items-start gap-2.5 font-body text-[12.5px] leading-relaxed text-ink-light">
          <Sparkles className="h-4 w-4 text-gold shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-ink">İpucu:</span> Yanıttaki
            kaynak chip&apos;lerine tıkladığında, ilgili PDF sayfası solda
            <em> research lab</em> görünümünde açılır. Birden fazla kitabı
            yan yana karşılaştırabilirsin.
          </div>
        </div>
      </div>
    </div>
  );
}

function SuggestionCard({
  icon,
  text,
  onClick,
}: {
  icon: "quote" | "note" | "sparkles" | "highlighter";
  text: string;
  onClick: () => void;
}) {
  const IconCmp =
    icon === "quote"
      ? Quote
      : icon === "note"
        ? Pencil
        : icon === "sparkles"
          ? Sparkles
          : Highlighter;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-start gap-2.5 px-3.5 py-3 rounded-lg border border-sandy/60 bg-elevated hover:border-gold hover:bg-panel transition-colors text-left"
    >
      <span className="inline-flex items-center justify-center h-[26px] w-[26px] rounded-md shrink-0 bg-forest/15">
        <IconCmp className="h-3.5 w-3.5 text-forest" />
      </span>
      <span className="font-display italic text-[13px] leading-snug text-ink">
        “{text}”
      </span>
    </button>
  );
}

function SuggestionSkeleton() {
  return (
    <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-lg border border-sandy/40 bg-elevated/60 animate-pulse">
      <span className="inline-flex items-center justify-center h-[26px] w-[26px] rounded-md shrink-0 bg-forest/10" />
      <span className="flex-1 space-y-1.5 py-0.5">
        <span className="block h-2 rounded-sm bg-sandy/60" style={{ width: "92%" }} />
        <span className="block h-2 rounded-sm bg-sandy/60" style={{ width: "68%" }} />
      </span>
    </div>
  );
}

// ── Active conversation ────────────────────────────────────────

function ActiveConversation({
  messages,
  isStreaming,
  threadRef,
  allEntries,
  sessionId,
  activeSource,
  onOpenSource,
  onCounterThesis,
  onCitateToThesis,
}: {
  messages: ChatMessage[];
  isStreaming: boolean;
  threadRef: React.RefObject<HTMLDivElement | null>;
  allEntries: Array<{ id: string; title: string; authorSurname: string; authorName: string | null; year: string | null }>;
  sessionId: string;
  activeSource: ActiveSource | null;
  onOpenSource: (src: ChatSource) => void;
  onCounterThesis: (msg: ChatMessage) => void;
  onCitateToThesis: (msg: ChatMessage) => void;
}) {
  const last = messages.at(-1);
  const showTyping =
    isStreaming &&
    last !== undefined &&
    last.role === "assistant" &&
    last.content === "";

  return (
    <div ref={threadRef} className="flex-1 overflow-y-auto px-6 py-5 min-h-0">
      {messages.map((m, i) => (
        <LibBubble
          key={i}
          msg={m}
          allEntries={allEntries}
          sessionId={sessionId}
          activeSource={activeSource}
          onOpenSource={onOpenSource}
          isStreaming={isStreaming && i === messages.length - 1}
          onCounterThesis={
            m.role === "assistant" ? () => onCounterThesis(m) : undefined
          }
          onCitateToThesis={
            m.role === "assistant" ? () => onCitateToThesis(m) : undefined
          }
        />
      ))}
      {showTyping && <TypingRow />}
    </div>
  );
}

function TypingRow() {
  return (
    <div className="flex items-center gap-2.5 mt-1 text-ink-muted">
      <div
        className="h-6 w-6 rounded-sm bg-gold flex items-center justify-center font-display italic text-white text-[13px] font-semibold leading-none"
        aria-hidden
      >
        Q
      </div>
      <span className="font-body text-xs">Kütüphane düşünüyor</span>
      <span className="inline-flex gap-1">
        <PulseDot delay={0} />
        <PulseDot delay={150} />
        <PulseDot delay={300} />
      </span>
    </div>
  );
}

function PulseDot({ delay }: { delay: number }) {
  return (
    <span
      className="w-1 h-1 rounded-full bg-ink-muted animate-pulse"
      style={{ animationDelay: `${delay}ms` }}
    />
  );
}

// ── Library bubble (rich, multi-source citations) ──────────────

function LibBubble({
  msg,
  allEntries,
  sessionId,
  activeSource,
  onOpenSource,
  isStreaming,
  onCounterThesis,
  onCitateToThesis,
}: {
  msg: ChatMessage;
  allEntries: Array<{
    id: string;
    title: string;
    authorSurname: string;
    authorName: string | null;
    year: string | null;
  }>;
  sessionId: string;
  activeSource: ActiveSource | null;
  onOpenSource: (src: ChatSource) => void;
  isStreaming: boolean;
  /** Triggered by "Karşı tezi sor" — emits a follow-up prompt that
   *  asks the model to play devil's advocate on this exact answer. */
  onCounterThesis?: () => void;
  /** Triggered by "Tezime alıntıla" — opens the project/subsection
   *  picker so the AI answer can be appended to a draft. */
  onCitateToThesis?: () => void;
}) {
  const isUser = msg.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end mb-4">
        <div
          className="max-w-[85%] text-gold-soft font-body text-[13px] leading-relaxed px-3.5 py-2.5"
          style={{
            background: "var(--color-forest-deep)",
            borderRadius: "12px 12px 4px 12px",
          }}
        >
          {msg.content}
        </div>
      </div>
    );
  }

  // Dedupe sources by entryId — multiple chunks from the same book
  // collapse into a single citation card with the first hit's page.
  const dedupSources = useMemo<ChatSource[]>(() => {
    const seen = new Set<string>();
    const out: ChatSource[] = [];
    for (const s of msg.sources ?? []) {
      if (seen.has(s.entryId)) continue;
      seen.add(s.entryId);
      out.push(s);
    }
    return out;
  }, [msg.sources]);

  return (
    <div className="mb-5">
      {/* Author row */}
      <div className="flex items-center gap-2.5 mb-2">
        <div
          className="h-[22px] w-[22px] rounded-sm bg-gold flex items-center justify-center font-display italic font-semibold text-white text-[12px] leading-none shrink-0"
          aria-hidden
        >
          Q
        </div>
        <span className="font-ui text-[11.5px] font-semibold text-forest-deep">
          Kütüphane
        </span>
        {dedupSources.length > 0 && (
          <span className="font-ui text-[11px] text-ink-muted">
            · {dedupSources.length} kaynaktan
          </span>
        )}
        <span className="flex-1" />
        {msg.scope && (
          <span className="font-ui text-[10.5px] text-ink-muted">
            {msg.scope === "all"
              ? "Tüm Kütüphane"
              : `${msg.entryIds?.length ?? 0} kitap`}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="pl-8 font-body text-[13.5px] leading-relaxed text-ink prose-chat">
        {msg.content ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {msg.content}
          </ReactMarkdown>
        ) : (
          <span className="opacity-60 italic flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" />
            Yazıyor…
          </span>
        )}
        {isStreaming && msg.content.length > 0 && (
          <span className="inline-block w-1.5 h-4 bg-ink/60 animate-pulse ml-0.5 align-middle" />
        )}
      </div>

      {/* Citations */}
      {dedupSources.length > 0 && (
        <div className="pl-8 mt-3.5">
          <div className="font-ui text-[10px] uppercase tracking-[0.16em] text-forest mb-1.5">
            Kaynaklar · {dedupSources.length}
          </div>
          <div className="flex flex-col gap-1.5">
            {dedupSources.map((s) => (
              <CitationCard
                key={`${s.entryId}-${s.marker}`}
                src={s}
                active={
                  activeSource !== null &&
                  activeSource.entryId === s.entryId &&
                  (activeSource.page ?? null) === (s.page ?? null)
                }
                onClick={() => onOpenSource(s)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Action row */}
      {msg.content.length > 0 && !isStreaming && (
        <div className="pl-8 mt-3 flex items-center gap-1 flex-wrap">
          <PinNoteButton
            sessionId={sessionId}
            messageContent={msg.content}
            entries={allEntries.map((e) => ({
              id: e.id,
              title: e.title,
              authorSurname: e.authorSurname,
              authorName: e.authorName,
              year: e.year,
            }))}
            suggestedEntryIds={dedupSources.map((s) => s.entryId)}
          />
          {onCounterThesis && (
            <button
              type="button"
              onClick={onCounterThesis}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-sm text-ink-light hover:bg-panel hover:text-ink font-ui text-[11px] transition-colors"
            >
              <Sparkles className="h-3 w-3 text-gold" />
              Karşı tezi sor
            </button>
          )}
          {onCitateToThesis && (
            <button
              type="button"
              onClick={onCitateToThesis}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-sm text-ink-light hover:bg-panel hover:text-ink font-ui text-[11px] transition-colors"
            >
              <Quote className="h-3 w-3" />
              Tezime alıntıla
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CitationCard({
  src,
  active,
  onClick,
}: {
  src: ChatSource;
  active: boolean;
  onClick: () => void;
}) {
  const color = spineColorFor(src.entryId);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex items-stretch gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors w-full",
        active
          ? "bg-elevated border border-gold"
          : "bg-panel border border-sandy/60 hover:border-sandy",
      )}
    >
      {active && (
        <span
          className="absolute top-1/2 -translate-y-1/2 -left-1.5 px-1.5 py-0.5 font-ui text-[9px] font-semibold uppercase tracking-[0.06em] text-white rounded-sm shrink-0"
          style={{ background: "var(--color-gold)" }}
        >
          Solda Açık
        </span>
      )}

      {/* Mini spine */}
      <span
        className="w-1 rounded-sm shrink-0"
        style={{ background: color }}
      />

      {/* Page badge */}
      <span
        className="w-[30px] shrink-0 flex flex-col items-center justify-center rounded-sm text-white px-0 py-1"
        style={{ background: color }}
      >
        <span className="font-ui text-[8px] opacity-85 tracking-wider">
          s.
        </span>
        <span className="font-display font-semibold text-[13px] leading-none">
          {src.pageLabel ?? src.page ?? "—"}
        </span>
      </span>

      {/* Book info */}
      <span className="flex-1 min-w-0 overflow-hidden">
        <span className="font-display font-semibold text-[12.5px] leading-tight text-ink truncate block">
          {src.title}
        </span>
        <span className="mt-0.5 flex items-center gap-1 font-ui text-[11px] text-ink-light">
          <span className="font-display italic truncate">
            {src.authorSurname ?? "—"}
          </span>
          {src.noteTitle && (
            <>
              <span className="text-ink-muted">·</span>
              <span className="truncate">{src.noteTitle}</span>
            </>
          )}
        </span>
      </span>

      <ChevronRight className="h-3.5 w-3.5 text-ink-muted shrink-0 self-center" />
    </button>
  );
}

// ── Composer ───────────────────────────────────────────────────

function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  isStreaming,
  scopedCount,
  onClearScope,
  placeholder,
  allEntries,
  selectedIds,
  setSelectedIds,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  isStreaming: boolean;
  scopedCount: number;
  onClearScope: () => void;
  placeholder: string;
  allEntries: Array<{
    id: string;
    title: string;
    authorSurname: string;
    authorName: string | null;
    year: string | null;
  }>;
  selectedIds: Set<string>;
  setSelectedIds: (next: Set<string>) => void;
}) {
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scopeSearch, setScopeSearch] = useState("");

  const filteredScopeEntries = useMemo(() => {
    const q = scopeSearch.trim().toLowerCase();
    if (!q) return allEntries;
    return allEntries.filter((e) => {
      const hay = [e.title, e.authorSurname, e.authorName ?? "", e.year ?? ""]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [allEntries, scopeSearch]);

  function toggleEntry(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }
  return (
    <div className="px-6 py-3.5 border-t border-sandy/60 bg-panel">
      <div
        className="rounded-xl px-3 pt-2.5 pb-2"
        style={{
          background: "var(--color-elevated)",
          border: "1.5px solid var(--color-sandy)",
        }}
      >
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder={placeholder}
          disabled={isStreaming}
          rows={1}
          className="w-full resize-none bg-transparent border-0 outline-none font-body text-[13.5px] leading-relaxed text-ink placeholder:italic placeholder:text-ink-muted min-h-[34px] disabled:opacity-60"
          style={{ maxHeight: 200 }}
        />
        <div className="flex items-center gap-1 mt-2 pt-2 border-t border-sandy/60 font-ui text-[11px] text-ink-muted flex-wrap relative">
          <button
            type="button"
            onClick={() => setScopeOpen((v) => !v)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-sm hover:bg-panel hover:text-ink transition-colors"
            title="Kapsamı düzenle"
          >
            <FilterIcon className="h-3 w-3" />
            Kapsam:{" "}
            {scopedCount > 0 ? `${scopedCount} kitap` : "tüm kütüphane"}
          </button>
          {scopedCount > 0 && (
            <button
              type="button"
              onClick={onClearScope}
              className="px-1.5 py-1 rounded-sm text-gold-dark hover:bg-gold/10 transition-colors"
            >
              Temizle
            </button>
          )}

          {/* Scope popover — anchored above the chip strip so it doesn't
              push the input around. Click outside closes via backdrop. */}
          {scopeOpen && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setScopeOpen(false)}
              />
              <div
                className="absolute left-0 bottom-full mb-2 w-[360px] max-h-[420px] flex flex-col rounded-lg border border-sandy bg-elevated shadow-xl z-40 overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-3 py-2 border-b border-sandy/60 flex items-center gap-2">
                  <FilterIcon className="h-3 w-3 text-forest" />
                  <span className="font-ui text-[11px] font-semibold uppercase tracking-[0.12em] text-forest">
                    Kapsamı seç
                  </span>
                  <span className="flex-1" />
                  {scopedCount > 0 && (
                    <button
                      type="button"
                      onClick={onClearScope}
                      className="font-ui text-[10.5px] text-gold-dark hover:underline"
                    >
                      Tüm kütüphane
                    </button>
                  )}
                </div>
                <div className="px-3 py-2 border-b border-sandy/60">
                  <input
                    type="text"
                    value={scopeSearch}
                    onChange={(e) => setScopeSearch(e.target.value)}
                    placeholder="Yazar veya başlıkta ara…"
                    className="w-full px-2.5 py-1.5 rounded-sm border border-sandy bg-page font-body text-[12px] outline-none focus:border-gold"
                  />
                </div>
                <div className="flex-1 overflow-y-auto py-1">
                  {filteredScopeEntries.length === 0 ? (
                    <p className="px-3 py-6 text-center font-body italic text-xs text-ink-muted">
                      Eşleşme yok.
                    </p>
                  ) : (
                    filteredScopeEntries.map((e) => {
                      const checked = selectedIds.has(e.id);
                      return (
                        <label
                          key={e.id}
                          className="flex items-start gap-2 px-3 py-1.5 hover:bg-panel cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleEntry(e.id)}
                            className="mt-0.5 accent-gold h-3 w-3 shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="font-body text-[12px] text-ink line-clamp-2 leading-snug">
                              {e.title}
                            </div>
                            <div className="font-ui text-[10.5px] text-ink-muted truncate">
                              {e.authorSurname}
                              {e.year ? `, ${e.year}` : ""}
                            </div>
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
                <div className="px-3 py-2 border-t border-sandy/60 font-ui text-[10.5px] text-ink-muted">
                  {scopedCount === 0
                    ? "Hiç seçim yoksa tüm kütüphaneye sorulur."
                    : `${scopedCount} kitaba odaklanılıyor.`}
                </div>
              </div>
            </>
          )}
          <span className="flex-1" />
          {isStreaming ? (
            <button
              type="button"
              onClick={onStop}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-red-200 text-red-600 hover:bg-red-50 transition-colors text-[12px] font-semibold"
            >
              <Square className="h-3 w-3" />
              Durdur
            </button>
          ) : (
            <button
              type="button"
              onClick={onSubmit}
              disabled={!value.trim()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-gold text-white font-semibold hover:bg-gold-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-[12px]"
            >
              <Send className="h-3 w-3" />
              Gönder
              <span className="opacity-70 text-[10px] ml-0.5">⏎</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────

function shadeHex(hex: string, amt: number): string {
  const h = hex.replace("#", "");
  const r = Math.max(0, Math.min(255, parseInt(h.slice(0, 2), 16) + amt));
  const g = Math.max(0, Math.min(255, parseInt(h.slice(2, 4), 16) + amt));
  const b = Math.max(0, Math.min(255, parseInt(h.slice(4, 6), 16) + amt));
  return `#${[r, g, b]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("")}`;
}

