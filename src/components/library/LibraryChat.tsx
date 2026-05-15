"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Send,
  Plus,
  Loader2,
  Square,
  MessageSquare,
  Sparkles,
  Search,
  User,
  BookOpen,
  Library as LibraryIcon,
} from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

type Scope = "all" | "picked" | "single";

interface ChatMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  sources?: Array<{
    marker: number;
    /** "note" rows come from the user's own LibraryNote table; the UI
     *  badges them differently so the reader knows the AI is quoting
     *  their own commentary, not a primary text. */
    kind?: "chunk" | "note";
    entryId: string;
    title: string;
    authorSurname: string | null;
    page: number | null;
    noteTitle?: string | null;
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
  const searchParams = useSearchParams();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => newSessionId());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Library list lives in the right sidebar; selection is inferred —
  // 0 selected = chat across the whole library, 1+ selected = chat
  // scoped to those entries. No more explicit scope toggle.
  const [allEntries, setAllEntries] = useState<LibraryEntry[]>([]);
  const [librarySearch, setLibrarySearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);

  // Folder / tag scope chips. Deep links (?collectionId / ?tagId from
  // the EntryDetailPanel's "Bu kitaba sor" or from the sidebar) pre-fill
  // these on first render so the chat starts scoped correctly.
  const [activeCollectionIds, setActiveCollectionIds] = useState<string[]>([]);
  const [activeTagIds, setActiveTagIds] = useState<string[]>([]);
  const [scopeLabels, setScopeLabels] = useState<{ collections: Record<string, string>; tags: Record<string, string> }>({
    collections: {},
    tags: {},
  });

  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const streamAbortRef = useRef<AbortController | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  // Derived: which entry rows match the search box
  const filteredEntries = useMemo(() => {
    const q = librarySearch.trim().toLowerCase();
    if (!q) return allEntries;
    return allEntries.filter((e) => {
      const hay = [e.title, e.authorSurname, e.authorName, e.year]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [allEntries, librarySearch]);

  const selectedEntries = useMemo(
    () => allEntries.filter((e) => selectedIds.has(e.id)),
    [allEntries, selectedIds],
  );

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

  // ── Library list (right sidebar) ───────────────────────────────
  const fetchAllEntries = useCallback(async () => {
    setIsLoadingLibrary(true);
    try {
      const res = await fetch("/api/library?limit=200");
      if (!res.ok) return;
      const data = (await res.json()) as { entries: LibraryEntry[] };
      setAllEntries(data.entries ?? []);
    } catch {
      /* ignore */
    } finally {
      setIsLoadingLibrary(false);
    }
  }, []);

  useEffect(() => {
    fetchAllEntries();
  }, [fetchAllEntries]);

  // Deep-link initialisation. Runs once after the library list and
  // tag/collection metadata load so we can label the scope chips.
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current) return;
    const entryId = searchParams.get("entryId");
    const collectionId = searchParams.get("collectionId");
    const tagId = searchParams.get("tagId");
    if (!entryId && !collectionId && !tagId) return;
    if (allEntries.length === 0) return; // wait for library
    deepLinkApplied.current = true;

    if (entryId && allEntries.some((e) => e.id === entryId)) {
      setSelectedIds(new Set([entryId]));
    }
    if (collectionId) {
      // Best-effort label fetch — non-blocking; chip shows id otherwise.
      fetch("/api/library/collections")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return;
          const found = (data.collections as Array<{ id: string; name: string }>).find(
            (c) => c.id === collectionId,
          );
          if (found) {
            setScopeLabels((prev) => ({
              ...prev,
              collections: { ...prev.collections, [collectionId]: found.name },
            }));
          }
        })
        .catch(() => undefined);
      setActiveCollectionIds([collectionId]);
    }
    if (tagId) {
      fetch("/api/library/tags")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!Array.isArray(data)) return;
          const found = (data as Array<{ id: string; name: string }>).find(
            (t) => t.id === tagId,
          );
          if (found) {
            setScopeLabels((prev) => ({
              ...prev,
              tags: { ...prev.tags, [tagId]: found.name },
            }));
          }
        })
        .catch(() => undefined);
      setActiveTagIds([tagId]);
    }
  }, [searchParams, allEntries]);

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

    // Implicit scope: any of entry-picks, folder chips, or tag chips
    // narrows the search. Empty = whole library.
    const hasScopeNarrowing =
      selectedIds.size > 0 ||
      activeCollectionIds.length > 0 ||
      activeTagIds.length > 0;
    const scope: Scope = hasScopeNarrowing ? "picked" : "all";
    const entryIds = scope === "all" ? [] : Array.from(selectedIds);
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
          collectionIds: activeCollectionIds,
          tagIds: activeTagIds,
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

  // ── Library selection (right pane) ─────────────────────────────
  function toggleEntry(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Compact ornament header */}
      <div className="px-6 pt-5 pb-3 border-b border-[#d4c9b5]/40">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="h-4 w-4 text-[#C9A84C]" />
          <h1 className="font-display text-lg font-semibold text-[#2D1F0E]">
            Kütüphane Sohbeti
          </h1>
        </div>
        <p className="font-body text-xs text-[#6b5a45]">
          PDF&apos;lerine sor — yanıt başlık ve sayfa numarasıyla alıntılansın.
        </p>
      </div>

      {/* 3-column content */}
      <div className="flex-1 grid grid-cols-[200px_1fr_260px] min-h-0 px-3 py-3 gap-3">
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
                  <MessageBubble
                    key={i}
                    message={m}
                    isStreaming={isStreaming}
                    isLast={i === messages.length - 1}
                  />
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
                  selectedIds.size === 0
                    ? "Library'ne sor… (Enter gönder, Shift+Enter satır)"
                    : `${selectedIds.size} PDF'e sor…`
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
                  disabled={!input.trim()}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-sm bg-[#C9A84C] text-[#1A0F05] font-ui text-xs font-semibold hover:bg-[#d4b85a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="h-3 w-3" />
                  Gönder
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Right: full library — pick zero for "ask everything",
            tick boxes to scope the chat to specific entries. The
            old radio-based scope toggle was redundant. */}
        <aside className="rounded-sm border border-[#d4c9b5]/60 bg-[#FAF7F0]/85 backdrop-blur-sm shadow-sm flex flex-col overflow-hidden">
          <div className="p-3 border-b border-[#d4c9b5]/60 bg-[#FAF7F0]/90">
            <div className="flex items-center gap-1.5 mb-2">
              <LibraryIcon className="h-3.5 w-3.5 text-[#8a7a65]" />
              <span
                className="font-ui text-[10px] uppercase tracking-widest text-[#8a7a65]"
                style={{ letterSpacing: "0.16em" }}
              >
                Kütüphane
              </span>
              {selectedIds.size > 0 && (
                <button
                  type="button"
                  onClick={clearSelection}
                  className="ml-auto font-ui text-[10px] uppercase tracking-wider text-[#8a5a1a] hover:text-[#2D1F0E]"
                >
                  Temizle
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-sm border border-[#d4c9b5] bg-white">
              <Search className="h-3 w-3 text-[#a89a82]" />
              <input
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
                placeholder="Ara…"
                className="flex-1 bg-transparent outline-none font-ui text-xs text-[#2D1F0E] placeholder:text-[#a89a82]"
              />
            </div>
            {/* Folder + tag scope chips (set via deep-link, e.g.
                /library/chat?collectionId=… from a folder header).
                Each chip can be removed; cleared chips fall the chat
                back to whole-library mode. */}
            {(activeCollectionIds.length > 0 || activeTagIds.length > 0) && (
              <div className="flex flex-wrap gap-1 mt-2">
                {activeCollectionIds.map((cid) => (
                  <span
                    key={`col-${cid}`}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-[#C9A84C]/15 border border-[#C9A84C]/40 font-ui text-[10px] text-[#5C4A32]"
                  >
                    📁 {scopeLabels.collections[cid] ?? "klasör"}
                    <button
                      type="button"
                      onClick={() =>
                        setActiveCollectionIds((p) => p.filter((x) => x !== cid))
                      }
                      className="text-[#8a7a65] hover:text-red-700 ml-0.5"
                      aria-label="Klasörü kaldır"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {activeTagIds.map((tid) => (
                  <span
                    key={`tag-${tid}`}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-[#e8dfd0] border border-[#d4c9b5] font-ui text-[10px] text-[#5C4A32]"
                  >
                    #{scopeLabels.tags[tid] ?? "etiket"}
                    <button
                      type="button"
                      onClick={() =>
                        setActiveTagIds((p) => p.filter((x) => x !== tid))
                      }
                      className="text-[#8a7a65] hover:text-red-700 ml-0.5"
                      aria-label="Etiketi kaldır"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            <p className="font-body text-[10px] text-[#a89a82] mt-2 leading-snug">
              {selectedIds.size === 0 && activeCollectionIds.length === 0 && activeTagIds.length === 0
                ? "Hiç seçim yoksa tüm kütüphaneye sorulur."
                : selectedIds.size > 0
                  ? `${selectedIds.size} PDF'e odaklanılıyor.`
                  : `Seçili klasör/etiketteki kaynaklara sorulur.`}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto py-1.5 px-2">
            {isLoadingLibrary ? (
              <div className="flex justify-center py-8 text-[#8a7a65]">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : filteredEntries.length === 0 ? (
              <p className="text-center font-ui text-[11px] text-[#a89a82] py-8">
                {allEntries.length === 0
                  ? "Kütüphanen boş."
                  : "Eşleşme yok."}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {filteredEntries.map((e) => {
                  const isSelected = selectedIds.has(e.id);
                  return (
                    <li key={e.id}>
                      <label
                        className={cn(
                          "flex items-start gap-2 px-2 py-1.5 rounded-sm cursor-pointer transition-colors border-l-2",
                          isSelected
                            ? "bg-[#FAF3E3] border-[#C9A84C]"
                            : "hover:bg-[#d4c9b5]/30 border-transparent",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleEntry(e.id)}
                          className="mt-0.5 h-3 w-3 accent-[#C9A84C] shrink-0"
                        />
                        <BookOpen className="h-3 w-3 mt-0.5 text-[#8a7a65] shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="font-body text-[11px] text-[#2D1F0E] line-clamp-2 leading-snug">
                            {e.title}
                          </div>
                          <div className="font-ui text-[10px] text-[#8a7a65] truncate">
                            {e.authorSurname}
                            {e.year ? `, ${e.year}` : ""}
                          </div>
                        </div>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
      </div>
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

function MessageBubble({
  message,
  isStreaming,
  isLast,
}: {
  message: ChatMessage;
  isStreaming?: boolean;
  isLast?: boolean;
}) {
  const isUser = message.role === "user";
  const showCursor = isStreaming && isLast && !isUser && message.content.length > 0;
  return (
    <div className="flex gap-3 items-start">
      {isUser ? (
        <div
          className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center border border-[#d4c9b5]/60 bg-[#FAF3E3]"
          aria-hidden
        >
          <User className="h-4 w-4 text-[#8a7a65]" />
        </div>
      ) : (
        <img
          src="/images/quilpen-icon.png"
          alt="Q"
          className="h-8 w-8 shrink-0 rounded-md border border-[#d4c9b5]/60 bg-white/70"
        />
      )}
      <div className="flex-1 min-w-0">
        {!isUser && message.scope && (
          <div
            className="font-ui text-[10px] uppercase tracking-widest text-[#8a5a1a] mb-1"
            style={{ letterSpacing: "0.16em" }}
          >
            {message.scope === "all"
              ? "Tüm Kütüphane"
              : `${message.entryIds?.length ?? 0} PDF`}
          </div>
        )}
        <div
          className={cn(
            "prose-chat font-body text-sm break-words text-[#2D1F0E]",
            isUser && "italic text-[#5C4A32]",
          )}
        >
          {message.content ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          ) : (
            <span className="opacity-60 italic flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              Yazıyor…
            </span>
          )}
          {showCursor && (
            <span className="inline-block w-1.5 h-4 bg-[#2D1F0E]/60 animate-pulse ml-0.5 align-middle" />
          )}
        </div>
        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="mt-3 pt-2 border-t border-[#d4c9b5]/40 flex flex-wrap gap-1.5">
            {message.sources.map((src) => {
              const isNote = src.kind === "note";
              return (
                <span
                  key={`${src.entryId}-${src.marker}-${isNote ? "n" : "c"}`}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm font-ui text-[10px] ${
                    isNote
                      ? "bg-[#e8dfd0] border border-[#d4c9b5] text-[#5C4A32]"
                      : "bg-[#FAF3E3] border border-[#C9A84C]/30 text-[#8a5a1a]"
                  }`}
                  title={`${src.title}${src.noteTitle ? ` — ${src.noteTitle}` : ""}${
                    src.page !== null ? ` (s. ${src.page})` : ""
                  }`}
                >
                  <span className="font-mono">[{src.marker}]</span>
                  {isNote && <span className="font-ui">📝</span>}
                  <span className="line-clamp-1 max-w-[200px]">
                    {src.authorSurname ?? src.title}
                    {src.noteTitle ? ` — ${src.noteTitle}` : ""}
                    {src.page !== null ? `, s. ${src.page}` : ""}
                  </span>
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

