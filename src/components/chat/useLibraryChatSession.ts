"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import type { ChatMessage, ChatSource, Scope } from "./MessageBubble";

export interface LibraryEntryLite {
  id: string;
  title: string;
  authorSurname: string;
  authorName: string | null;
  year: string | null;
  pdfStatus?: string | null;
}

export interface SessionRow {
  sessionId: string;
  preview: string;
  createdAt: string;
  messageCount: number;
}

export interface ScopeLabels {
  collections: Record<string, string>;
  tags: Record<string, string>;
}

export interface UseLibraryChatSessionOptions {
  /** When provided, the chat is pre-scoped to this single entry on
   *  mount — selectedIds starts as new Set([entryId]) and the URL
   *  deep-link parsing (?entryId / ?collectionId / ?tagId) is skipped
   *  because the per-book split view is its own canonical scope. */
  initialEntryId?: string;
}

function newSessionId(): string {
  return `lib-chat-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function useLibraryChatSession(
  options: UseLibraryChatSessionOptions = {},
) {
  const { initialEntryId } = options;
  const searchParams = useSearchParams();

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>(() =>
    newSessionId(),
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const [allEntries, setAllEntries] = useState<LibraryEntryLite[]>([]);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() =>
    initialEntryId ? new Set([initialEntryId]) : new Set(),
  );

  const [activeCollectionIds, setActiveCollectionIds] = useState<string[]>([]);
  const [activeTagIds, setActiveTagIds] = useState<string[]>([]);
  const [scopeLabels, setScopeLabels] = useState<ScopeLabels>({
    collections: {},
    tags: {},
  });

  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const streamAbortRef = useRef<AbortController | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

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
      const data = (await res.json()) as { entries: LibraryEntryLite[] };
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

  // Deep-link initialisation. Runs once after the library list loads.
  // The per-book split view passes initialEntryId explicitly and does
  // not consume URL params, so skip this entire branch in that case.
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (initialEntryId) return;
    if (deepLinkApplied.current) return;
    const entryId = searchParams.get("entryId");
    const collectionId = searchParams.get("collectionId");
    const tagId = searchParams.get("tagId");
    if (!entryId && !collectionId && !tagId) return;
    if (allEntries.length === 0) return;
    deepLinkApplied.current = true;

    if (entryId && allEntries.some((e) => e.id === entryId)) {
      setSelectedIds(new Set([entryId]));
    }
    if (collectionId) {
      fetch("/api/library/collections")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return;
          const found = (
            data.collections as Array<{ id: string; name: string }>
          ).find((c) => c.id === collectionId);
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
  }, [initialEntryId, searchParams, allEntries]);

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
          sources?: ChatSource[];
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

  const startNewSession = useCallback(() => {
    setCurrentSessionId(newSessionId());
    setMessages([]);
    setInput("");
  }, []);

  const pickSession = useCallback(
    (sessionId: string) => {
      setCurrentSessionId(sessionId);
      loadSession(sessionId);
    },
    [loadSession],
  );

  // ── Auto-scroll thread on new message ──────────────────────────
  useEffect(() => {
    if (!threadRef.current) return;
    threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages]);

  // ── Send a message (SSE) ───────────────────────────────────────
  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    const hasScopeNarrowing =
      selectedIds.size > 0 ||
      activeCollectionIds.length > 0 ||
      activeTagIds.length > 0;
    const scope: Scope = hasScopeNarrowing ? "picked" : "all";
    const entryIds = scope === "all" ? [] : Array.from(selectedIds);
    const userMsg: ChatMessage = {
      role: "user",
      content: trimmed,
      scope,
      entryIds,
    };
    setMessages((prev) => [
      ...prev,
      userMsg,
      { role: "assistant", content: "" },
    ]);
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
      let assistantSources: ChatSource[] | undefined;

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
              sources?: ChatSource[];
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
  }, [
    input,
    isStreaming,
    selectedIds,
    activeCollectionIds,
    activeTagIds,
    currentSessionId,
    fetchSessions,
  ]);

  const stopStream = useCallback(() => {
    if (streamAbortRef.current) streamAbortRef.current.abort();
  }, []);

  return {
    // state
    messages,
    setMessages,
    currentSessionId,
    sessions,
    input,
    setInput,
    isStreaming,
    isLoadingHistory,
    isLoadingLibrary,
    allEntries,
    selectedIds,
    setSelectedIds,
    activeCollectionIds,
    setActiveCollectionIds,
    activeTagIds,
    setActiveTagIds,
    scopeLabels,
    // refs
    threadRef,
    // actions
    sendMessage,
    stopStream,
    startNewSession,
    pickSession,
    fetchSessions,
  };
}
