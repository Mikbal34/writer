"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  Send,
  Plus,
  X,
  Loader2,
  Square,
  MessageSquare,
  FileText,
  Sparkles,
  Search,
  Library,
  Feather,
  LogOut,
} from "lucide-react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import NotificationBell from "@/components/shared/NotificationBell";

const TEXTURE_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310419663027387604/L3DyhJpdXQXWDPUTXv57iD/book-texture-bg-hJmgUJE5GQFpbmBrLLMri5.webp";

type Scope = "all" | "picked" | "single";

interface ChatMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  sources?: Array<{
    marker: number;
    entryId: string;
    title: string;
    authorSurname: string | null;
    page: number | null;
  }>;
  scope?: Scope;
  entryIds?: string[];
}

interface LibraryEntry {
  id: string;
  title: string;
  authorSurname: string;
  authorName: string | null;
  year: string | null;
  pdfStatus?: string | null;
}

interface SessionRow {
  sessionId: string;
  preview: string;
  createdAt: string;
  messageCount: number;
}

function newSessionId(): string {
  return `lib-chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function LibraryChat() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => newSessionId());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const [scope, setScope] = useState<Scope>("all");
  const [selectedEntries, setSelectedEntries] = useState<LibraryEntry[]>([]);

  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const streamAbortRef = useRef<AbortController | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const [showPicker, setShowPicker] = useState(false);

  // ── Sessions list ──────────────────────────────────────────────
  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/library/chat/sessions");
      if (!res.ok) return;
      const data = (await res.json()) as { sessions: SessionRow[] };
      setSessions(data.sessions ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // ── Load a specific session's messages ─────────────────────────
  const loadSession = useCallback(async (sessionId: string) => {
    setIsLoadingHistory(true);
    try {
      const res = await fetch(
        `/api/library/chat/history?sessionId=${encodeURIComponent(sessionId)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        messages: Array<{
          id: string;
          role: "user" | "assistant";
          content: string;
          sources?: ChatMessage["sources"];
          scope?: Scope | null;
          entryIds?: string[];
          createdAt: string;
        }>;
      };
      setMessages(
        data.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          sources: m.sources,
          scope: m.scope ?? undefined,
          entryIds: m.entryIds ?? undefined,
        })),
      );
    } catch {
      /* ignore */
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  function startNewSession() {
    setCurrentSessionId(newSessionId());
    setMessages([]);
    setInput("");
  }

  function pickSession(sessionId: string) {
    setCurrentSessionId(sessionId);
    loadSession(sessionId);
  }

  // ── Auto-scroll thread on new message ──────────────────────────
  useEffect(() => {
    if (!threadRef.current) return;
    threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages]);

  // ── Send a message (SSE) ───────────────────────────────────────
  async function sendMessage() {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    if (scope !== "all" && selectedEntries.length === 0) {
      toast.error("Bu modda en az bir PDF seçmelisin.");
      return;
    }

    const entryIds = scope === "all" ? [] : selectedEntries.map((e) => e.id);
    const userMsg: ChatMessage = { role: "user", content: trimmed, scope, entryIds };
    setMessages((prev) => [...prev, userMsg, { role: "assistant", content: "" }]);
    setInput("");

    const abortController = new AbortController();
    streamAbortRef.current = abortController;
    setIsStreaming(true);

    try {
      const res = await fetch("/api/library/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: currentSessionId,
          message: trimmed,
          scope,
          entryIds,
        }),
        signal: abortController.signal,
      });
      if (res.status === 402) {
        const err = (await res.json().catch(() => ({}))) as {
          balance?: number;
          cost?: number;
        };
        toast.error(
          `Yetersiz kredi (${err.balance ?? 0} kalan, ~${err.cost ?? "?"} gerek).`,
        );
        setMessages((prev) => prev.slice(0, -2));
        return;
      }
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Chat failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";
      let assistantSources: ChatMessage["sources"] | undefined;

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
              sources?: ChatMessage["sources"];
              error?: string;
            };
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.delta) {
              assistantText += parsed.delta;
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = {
                  role: "assistant",
                  content: assistantText,
                };
                return next;
              });
            } else if (parsed.done) {
              assistantSources = parsed.sources;
            }
          } catch {
            /* malformed */
          }
        }
      }

      // Finalise the last assistant message with sources.
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant") {
          next[next.length - 1] = {
            ...last,
            content: assistantText.trim() || last.content,
            sources: assistantSources,
          };
        }
        return next;
      });
      fetchSessions();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        toast.info("Sohbet durduruldu.");
      } else {
        toast.error(err instanceof Error ? err.message : "Chat hatası");
      }
    } finally {
      setIsStreaming(false);
      streamAbortRef.current = null;
    }
  }

  function stopStream() {
    if (streamAbortRef.current) streamAbortRef.current.abort();
  }

  // ── Picker (right pane) ────────────────────────────────────────
  function addEntry(entry: LibraryEntry) {
    setSelectedEntries((prev) => {
      if (scope === "single") return [entry];
      if (prev.some((e) => e.id === entry.id)) return prev;
      return [...prev, entry];
    });
  }
  function removeEntry(id: string) {
    setSelectedEntries((prev) => prev.filter((e) => e.id !== id));
  }
  function changeScope(next: Scope) {
    setScope(next);
    if (next === "all") setSelectedEntries([]);
    if (next === "single" && selectedEntries.length > 1) {
      setSelectedEntries([selectedEntries[0]]);
    }
  }

  return (
    <div
      className="h-screen flex flex-col"
      style={{
        backgroundImage: `url(${TEXTURE_URL})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundAttachment: "fixed",
      }}
    >
      {/* App navbar — same chrome as /library and /style for consistency */}
      <nav className="bg-[#1A0F05]/95 backdrop-blur-md border-b border-[#C9A84C]/20 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <img
              src="/images/quilpen-logo-horizontal.png"
              alt="Quilpen"
              className="h-20 animate-logo-in"
              style={{ filter: "brightness(0) invert(1)" }}
            />
          </Link>

          <div className="flex items-center gap-1">
            <Link
              href="/style"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm font-ui text-sm text-[#c9bfad] hover:text-[#F5EDE0] transition-colors"
            >
              <Feather className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Writing Twin</span>
            </Link>
            <Link
              href="/library"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm font-ui text-sm text-[#c9bfad] hover:text-[#F5EDE0] transition-colors"
            >
              <Library className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">My Library</span>
            </Link>
            <NotificationBell />
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm font-ui text-sm text-[#c9bfad] hover:text-[#F5EDE0] transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </nav>

      {/* Page header — back link + ornament title block */}
      <div className="max-w-7xl w-full mx-auto px-6 pt-6">
        <Link
          href="/library"
          className="inline-flex items-center gap-1.5 font-ui text-xs text-[#8a7a65] hover:text-[#2D1F0E] transition-colors mb-4"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Library
        </Link>
        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-3 mb-3">
            <div className="h-px flex-1 max-w-[80px] bg-gradient-to-r from-transparent to-[#C9A84C]/60" />
            <Sparkles className="h-5 w-5 text-[#C9A84C]" />
            <div className="h-px flex-1 max-w-[80px] bg-gradient-to-l from-transparent to-[#C9A84C]/60" />
          </div>
          <h1 className="font-display text-3xl font-bold text-[#2D1F0E] tracking-tight">
            Kütüphane Sohbeti
          </h1>
          <p className="font-body text-sm text-[#6b5a45] mt-1.5">
            PDF&apos;lerine sor — yanıt başlık ve sayfa numarasıyla alıntılansın.
          </p>
        </div>
      </div>

      {/* 3-column layout */}
      <div className="flex-1 grid grid-cols-[240px_1fr_300px] min-h-0 max-w-7xl w-full mx-auto px-6 pb-6 gap-3">
        {/* Left: sessions */}
        <aside className="rounded-sm border border-[#d4c9b5]/60 bg-[#FAF7F0]/85 backdrop-blur-sm shadow-sm flex flex-col overflow-hidden">
          <div className="p-3 border-b border-[#d4c9b5]/60 bg-[#FAF7F0]/90">
            <button
              type="button"
              onClick={startNewSession}
              className="w-full flex items-center justify-center gap-1.5 font-ui text-xs font-semibold px-3 py-2 rounded-sm bg-[#C9A84C] text-[#1A0F05] hover:bg-[#d4b85a] transition-colors shadow-sm"
            >
              <Plus className="h-3.5 w-3.5" />
              Yeni sohbet
            </button>
          </div>
          <div className="px-3 py-2 border-b border-[#d4c9b5]/40 bg-[#FAF7F0]/60">
            <span
              className="font-ui text-[10px] uppercase tracking-widest text-[#8a7a65]"
              style={{ letterSpacing: "0.16em" }}
            >
              Önceki Sohbetler
            </span>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {sessions.length === 0 ? (
              <p className="text-center font-body italic text-xs text-[#a89a82] mt-4 px-3">
                Henüz sohbet yok.
              </p>
            ) : (
              <ul className="space-y-0.5 px-2">
                {sessions.map((s) => (
                  <li key={s.sessionId}>
                    <button
                      type="button"
                      onClick={() => pickSession(s.sessionId)}
                      className={cn(
                        "w-full text-left px-2.5 py-2 rounded-sm transition-colors border-l-2",
                        currentSessionId === s.sessionId
                          ? "bg-[#FAF3E3] border-[#C9A84C]"
                          : "hover:bg-[#d4c9b5]/30 border-transparent",
                      )}
                    >
                      <div className="flex items-start gap-1.5">
                        <MessageSquare className="h-3 w-3 mt-0.5 text-[#8a7a65] shrink-0" />
                        <span className="font-body text-xs text-[#2D1F0E] line-clamp-2 leading-snug">
                          {s.preview || "(Boş sohbet)"}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Middle: thread */}
        <section className="flex flex-col rounded-sm border border-[#d4c9b5]/60 bg-[#FAF7F0]/90 backdrop-blur-sm shadow-sm min-w-0 overflow-hidden">
          <div ref={threadRef} className="flex-1 overflow-y-auto px-8 py-6">
            {isLoadingHistory ? (
              <div className="flex justify-center py-12 text-[#8a7a65]">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                <span className="font-body italic text-xs">Yükleniyor…</span>
              </div>
            ) : messages.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="max-w-3xl mx-auto space-y-6">
                {messages.map((m, i) => (
                  <MessageBubble key={i} message={m} />
                ))}
              </div>
            )}
          </div>

          {/* Input bar */}
          <div className="border-t border-[#d4c9b5]/60 bg-[#FAF7F0]/95 px-8 py-3">
            <div className="max-w-3xl mx-auto flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder={
                  scope === "all"
                    ? "Library'ne sor… (Enter gönder, Shift+Enter satır)"
                    : selectedEntries.length === 0
                      ? "Sağdan PDF seç, sonra sorunu yaz"
                      : `${selectedEntries.length} PDF'e sor…`
                }
                disabled={isStreaming}
                rows={1}
                className="flex-1 resize-none font-body text-sm px-3 py-2 rounded-sm border border-[#d4c9b5] bg-white text-[#2D1F0E] placeholder:text-[#a89a82] focus:outline-none focus:border-[#C9A84C] disabled:opacity-60"
                style={{ maxHeight: 200 }}
              />
              {isStreaming ? (
                <button
                  type="button"
                  onClick={stopStream}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-sm border border-red-200 text-red-600 font-ui text-xs hover:bg-red-50 transition-colors"
                >
                  <Square className="h-3 w-3" />
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  onClick={sendMessage}
                  disabled={!input.trim() || (scope !== "all" && selectedEntries.length === 0)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-sm bg-[#C9A84C] text-[#1A0F05] font-ui text-xs font-semibold hover:bg-[#d4b85a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="h-3 w-3" />
                  Gönder
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Right: scope */}
        <aside className="rounded-sm border border-[#d4c9b5]/60 bg-[#FAF7F0]/85 backdrop-blur-sm shadow-sm flex flex-col overflow-hidden">
          <div className="p-4 border-b border-[#d4c9b5]/60 bg-[#FAF7F0]/90">
            <div
              className="font-ui text-[10px] uppercase tracking-widest text-[#8a7a65] mb-2"
              style={{ letterSpacing: "0.16em" }}
            >
              Kapsam
            </div>
            <div className="space-y-1">
              {(["all", "picked", "single"] as Scope[]).map((s) => (
                <label
                  key={s}
                  className={cn(
                    "flex items-center gap-2 px-2.5 py-1.5 rounded-sm cursor-pointer transition-colors",
                    scope === s
                      ? "bg-[#C9A84C]/15 border border-[#C9A84C]/40"
                      : "border border-transparent hover:bg-[#d4c9b5]/30",
                  )}
                >
                  <input
                    type="radio"
                    name="scope"
                    value={s}
                    checked={scope === s}
                    onChange={() => changeScope(s)}
                    className="accent-[#C9A84C]"
                  />
                  <span className="font-ui text-xs font-medium text-[#2D1F0E]">
                    {s === "all" ? "Tüm library" : s === "picked" ? "Seçili PDF'ler" : "Tek PDF"}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="p-4 flex-1 overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <div className="font-ui text-[11px] uppercase tracking-widest text-[#8a7a65]">
                {scope === "all" ? "PDF'ler (otomatik)" : `Seçili (${selectedEntries.length})`}
              </div>
              {scope !== "all" && (
                <button
                  type="button"
                  onClick={() => setShowPicker(true)}
                  disabled={scope === "single" && selectedEntries.length >= 1}
                  className="flex items-center gap-1 font-ui text-[10px] uppercase tracking-wider text-[#8a5a1a] hover:text-[#2D1F0E] disabled:opacity-40"
                >
                  <Plus className="h-3 w-3" />
                  Ekle
                </button>
              )}
            </div>
            {scope === "all" ? (
              <p className="font-body text-[11px] text-[#a89a82] leading-snug">
                Sorulan soru tüm library PDF'lerinde aranır. Yanıtın altındaki
                kaynak chip'lerinde hangi PDF'ten geldiği görünür.
              </p>
            ) : selectedEntries.length === 0 ? (
              <p className="font-body text-[11px] text-[#a89a82] leading-snug">
                Henüz PDF seçilmedi. Üstteki <strong>Ekle</strong> butonu ile
                kütüphaneden seç.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {selectedEntries.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-start gap-2 p-2 rounded-sm bg-white border border-[#d4c9b5]/60"
                  >
                    <FileText className="h-3.5 w-3.5 mt-0.5 text-[#8a7a65] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-body text-[11px] text-[#2D1F0E] line-clamp-2 leading-snug">
                        {e.title}
                      </div>
                      <div className="font-ui text-[10px] text-[#8a7a65]">
                        {e.authorSurname}
                        {e.year ? `, ${e.year}` : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeEntry(e.id)}
                      className="text-[#a89a82] hover:text-red-600"
                      aria-label="Kaldır"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      {showPicker && (
        <EntryPickerModal
          mode={scope === "single" ? "single" : "multi"}
          alreadySelected={new Set(selectedEntries.map((e) => e.id))}
          onClose={() => setShowPicker(false)}
          onPick={(entry) => {
            addEntry(entry);
            if (scope === "single") setShowPicker(false);
          }}
        />
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="max-w-md mx-auto text-center py-20">
      {/* Ornament block */}
      <div className="flex items-center justify-center gap-3 mb-5">
        <div className="h-px flex-1 max-w-[80px] bg-gradient-to-r from-transparent to-[#C9A84C]/60" />
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center border border-[#C9A84C]/40"
          style={{ backgroundColor: "rgba(201,168,76,0.12)" }}
        >
          <Sparkles className="h-5 w-5" style={{ color: "#8a5a1a" }} />
        </div>
        <div className="h-px flex-1 max-w-[80px] bg-gradient-to-l from-transparent to-[#C9A84C]/60" />
      </div>
      <h2 className="font-display text-xl font-semibold text-[#2D1F0E] mb-2">
        Kütüphanenle konuş
      </h2>
      <p className="font-body text-sm text-[#6b5a45] leading-relaxed">
        Yüklediğin PDF&apos;lere sor. Yanıt, kullandığı kaynaklardan{" "}
        <span className="font-medium text-[#8a5a1a]">başlık + sayfa</span> ile alıntılanır.
        Sağdan kapsamı seç, alt kutuya yaz, Enter ile gönder.
      </p>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-sm px-4 py-3 shadow-sm",
          isUser
            ? "bg-[#2D1F0E] text-[#F5EDE0] border border-[#C9A84C]/30"
            : "bg-white/90 border border-[#d4c9b5]/70 text-[#2D1F0E]",
        )}
      >
        {!isUser && message.scope && (
          <div
            className="font-ui text-[10px] uppercase tracking-widest text-[#8a5a1a] mb-1.5"
            style={{ letterSpacing: "0.16em" }}
          >
            {message.scope === "all"
              ? "Tüm Kütüphane"
              : `${message.entryIds?.length ?? 0} PDF`}
          </div>
        )}
        <div
          className={cn(
            "text-sm leading-relaxed whitespace-pre-wrap",
            isUser
              ? "font-body text-[#F5EDE0]"
              : "font-serif text-[#2D1F0E]",
          )}
        >
          {message.content || (
            <span className="opacity-60 italic">
              <Loader2 className="inline h-3 w-3 animate-spin mr-1.5" />
              Yazıyor…
            </span>
          )}
        </div>
        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="mt-3 pt-3 border-t border-[#d4c9b5]/40 flex flex-wrap gap-1.5">
            {message.sources.map((src) => (
              <span
                key={`${src.entryId}-${src.marker}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm bg-[#FAF3E3] border border-[#C9A84C]/30 font-ui text-[10px] text-[#8a5a1a]"
                title={`${src.title}${src.page !== null ? ` (s. ${src.page})` : ""}`}
              >
                <span className="font-mono">[{src.marker}]</span>
                <span className="line-clamp-1 max-w-[180px]">
                  {src.authorSurname ?? src.title}
                  {src.page !== null ? ` (s. ${src.page})` : ""}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EntryPickerModal({
  mode,
  alreadySelected,
  onClose,
  onPick,
}: {
  mode: "single" | "multi";
  alreadySelected: Set<string>;
  onClose: () => void;
  onPick: (entry: LibraryEntry) => void;
}) {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const fetchEntries = useCallback(async (query: string) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (query) params.set("search", query);
      const res = await fetch(`/api/library?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setEntries((data.entries ?? []) as LibraryEntry[]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries(search);
  }, [search, fetchEntries]);

  // Only entries with usable PDFs are eligible — chunks need to exist.
  const eligible = useMemo(
    () => entries.filter((e) => e.pdfStatus === "ready" || !!e.pdfStatus),
    [entries],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-[#FAF7F0] rounded-md shadow-xl overflow-hidden flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#d4c9b5]/60">
          <h3 className="font-display font-semibold text-[#2D1F0E]">
            {mode === "single" ? "PDF seç" : "PDF'ler ekle"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-[#a89a82] hover:text-[#2D1F0E]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-4 py-2 border-b border-[#d4c9b5]/60">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-sm border border-[#d4c9b5] bg-white">
            <Search className="h-3.5 w-3.5 text-[#a89a82]" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Başlık veya yazar ara…"
              className="flex-1 bg-transparent outline-none font-ui text-sm text-[#2D1F0E] placeholder:text-[#a89a82]"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {isLoading ? (
            <div className="flex justify-center py-8 text-[#8a7a65]">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : eligible.length === 0 ? (
            <p className="text-center font-ui text-xs text-[#a89a82] py-8">
              Eşleşen PDF bulunamadı.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {eligible.map((e) => {
                const already = alreadySelected.has(e.id);
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => !already && onPick(e)}
                      disabled={already}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-sm transition-colors",
                        already
                          ? "opacity-50 cursor-not-allowed bg-[#d4c9b5]/20"
                          : "hover:bg-[#C9A84C]/10",
                      )}
                    >
                      <div className="font-body text-sm text-[#2D1F0E] leading-snug line-clamp-2">
                        {e.title}
                      </div>
                      <div className="font-ui text-[11px] text-[#8a7a65] mt-0.5">
                        {e.authorSurname}
                        {e.year ? `, ${e.year}` : ""}
                        {already ? " · seçili" : ""}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
