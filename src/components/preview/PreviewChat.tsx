"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2, User, Plus, History, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { StaggerItem } from "@/components/shared/Animations";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatSession {
  id: string;
  preview: string;
  createdAt: string;
}

interface PreviewChatProps {
  projectId: string;
  onUpdate: () => void;
  className?: string;
}

export default function PreviewChat({
  projectId,
  onUpdate,
  className,
}: PreviewChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [streamingStep, setStreamingStep] = useState<string | null>(null);
  const [showSessions, setShowSessions] = useState(false);
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadSession = useCallback(
    async (targetSessionId?: string) => {
      try {
        const url = targetSessionId
          ? `/api/projects/${projectId}/preview/chat/history?sessionId=${targetSessionId}`
          : `/api/projects/${projectId}/preview/chat/history`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.messages)) setMessages(data.messages);
        if (data.sessionId) sessionIdRef.current = data.sessionId;
        if (Array.isArray(data.sessions)) setSessions(data.sessions);
      } catch {
        // ignore
      }
    },
    [projectId]
  );

  useEffect(() => {
    let cancelled = false;
    async function init() {
      await loadSession();
      if (!cancelled) setIsLoadingHistory(false);
    }
    init();
    return () => { cancelled = true; };
  }, [loadSession]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, []);

  const handleNewChat = useCallback(() => {
    if (isStreaming) return;
    sessionIdRef.current = crypto.randomUUID();
    setMessages([]);
    setShowSessions(false);
    textareaRef.current?.focus();
  }, [isStreaming]);

  const handleSelectSession = useCallback(
    async (sid: string) => {
      if (isStreaming) return;
      setShowSessions(false);
      setIsLoadingHistory(true);
      await loadSession(sid);
      setIsLoadingHistory(false);
    },
    [isStreaming, loadSession]
  );

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    const userMessage: Message = { role: "user", content: trimmed };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsStreaming(true);

    const assistantIndex = newMessages.length;
    setMessages([...newMessages, { role: "assistant", content: "" }]);

    try {
      const res = await fetch(`/api/projects/${projectId}/preview/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (res.status === 402) {
        const errData = await res.json().catch(() => ({}));
        toast.error(`Insufficient credits (${errData.balance ?? 0} remaining).`);
        setMessages(newMessages);
        setIsStreaming(false);
        return;
      }
      if (!res.ok) throw new Error("Chat request failed");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let fullContent = "";
      let lineBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        lineBuffer += text;
        const parts = lineBuffer.split("\n");
        lineBuffer = parts.pop() ?? "";

        for (const line of parts) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);

            if (parsed.step === "thinking" && parsed.tool) {
              const toolLabels: Record<string, string> = {
                create_character: "Creating character...",
                update_character: "Updating character...",
                generate_scene_image: "Generating illustration...",
                regenerate_image: "Regenerating image...",
                set_art_style: "Setting art style...",
                generate_character_portrait: "Generating portrait...",
              };
              setStreamingStep(toolLabels[parsed.tool] ?? `Using ${parsed.tool}...`);
            }

            if (parsed.chunk) {
              fullContent += parsed.chunk;
              setMessages((prev) => {
                const updated = [...prev];
                updated[assistantIndex] = { role: "assistant", content: fullContent };
                return updated;
              });
            }

            if (parsed.done) {
              setMessages((prev) => {
                const updated = [...prev];
                updated[assistantIndex] = { ...updated[assistantIndex], content: fullContent };
                return updated;
              });
              if (parsed.creditsUsed != null) {
                toast.info(`${parsed.creditsUsed} credits used. Balance: ${parsed.balance}`);
              }
              onUpdate();
            }

            if (parsed.error) {
              const detail = parsed.detail ? `: ${parsed.detail}` : "";
              setMessages((prev) => {
                const updated = [...prev];
                updated[assistantIndex] = { role: "assistant", content: `An error occurred${detail}. Please try again.` };
                return updated;
              });
            }
          } catch {
            // skip
          }
        }
      }

      // Refresh sessions
      try {
        const histRes = await fetch(`/api/projects/${projectId}/preview/chat/history?sessionId=${sessionIdRef.current}`);
        if (histRes.ok) {
          const histData = await histRes.json();
          if (Array.isArray(histData.sessions)) setSessions(histData.sessions);
        }
      } catch {
        // ignore
      }
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        if (updated[assistantIndex]) {
          updated[assistantIndex] = { role: "assistant", content: "Connection error. Please try again." };
        }
        return updated;
      });
    } finally {
      setIsStreaming(false);
      setStreamingStep(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className={`flex flex-col h-full ${className ?? ""}`}>
      {/* Header */}
      <div className="px-4 py-3 border-b shrink-0 flex items-center justify-between">
        <h2 className="font-display text-base font-bold">Illustration Chat</h2>
        <div className="flex items-center gap-1">
          {!isStreaming && (
            <Button variant="ghost" size="sm" onClick={() => setShowSessions(!showSessions)}
              className={`h-7 font-ui text-xs gap-1 ${showSessions ? "text-foreground bg-muted" : "text-muted-foreground"}`}>
              <History className="h-3.5 w-3.5" /> History
            </Button>
          )}
          {!isStreaming && (
            <Button variant="ghost" size="sm" onClick={handleNewChat}
              className="h-7 font-ui text-xs gap-1 text-muted-foreground">
              <Plus className="h-3.5 w-3.5" /> New
            </Button>
          )}
        </div>
      </div>

      {/* Sessions */}
      {showSessions && (
        <div className="border-b shrink-0">
          <ScrollArea className="max-h-[200px]">
            <div className="py-1">
              {sessions.length === 0 && (
                <p className="font-body text-xs text-muted-foreground text-center py-4">No chat history yet</p>
              )}
              {sessions.map((s) => (
                <button key={s.id} onClick={() => handleSelectSession(s.id)}
                  className={`w-full text-left px-4 py-2 hover:bg-muted/50 transition-colors flex items-start gap-2.5 ${s.id === sessionIdRef.current ? "bg-muted/70" : ""}`}>
                  <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="font-body text-xs truncate">{s.preview || "Empty chat"}</p>
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
        <div className="px-4 py-3 space-y-4">
          {isLoadingHistory && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              <span className="font-body text-sm">Loading...</span>
            </div>
          )}
          {!isLoadingHistory && messages.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <img src="/images/quilpen-icon.png" alt="Quilpen" className="h-12 w-12 mx-auto mb-3 opacity-60 rounded-lg" />
              <p className="font-body text-sm">Describe the illustrations you want for your book.</p>
              <p className="font-body text-xs mt-1 opacity-70">I'll create characters and generate images.</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <StaggerItem key={i} index={i} baseDelay={0.05} stagger={0.03}>
              <div className="flex gap-2.5 items-start">
                {msg.role === "user" ? (
                  <User className="h-7 w-7 shrink-0 text-[#8a7a65]" />
                ) : (
                  <img src="/images/quilpen-icon.png" alt="Q" className="h-7 w-7 shrink-0 rounded-lg" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-body text-sm prose-chat break-words">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    {isStreaming && i === messages.length - 1 && msg.role === "assistant" && (
                      <span className="inline-block w-1.5 h-4 bg-foreground/60 animate-pulse ml-0.5 align-middle" />
                    )}
                  </div>
                  {isStreaming && i === messages.length - 1 && msg.role === "assistant" && streamingStep && (
                    <div className="flex items-center gap-1.5 font-ui text-xs text-muted-foreground mt-2">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>{streamingStep}</span>
                    </div>
                  )}
                </div>
              </div>
            </StaggerItem>
          ))}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="border-t px-4 py-3 shrink-0">
        <div className="flex gap-2 items-end">
          <Textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown} placeholder="Describe characters or request illustrations..."
            className="min-h-[40px] max-h-[120px] resize-none font-body text-sm" rows={1} disabled={isStreaming} />
          <Button size="icon" onClick={handleSend} disabled={!input.trim() || isStreaming} className="shrink-0 h-10 w-10">
            {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
