"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2, Bot, User, Plus, History, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import CommandGroup from "./CommandGroup";

interface Message {
 role: "user" | "assistant";
 content: string;
 commands?: Array<Record<string, unknown>>;
 commandsApplied?: boolean;
}

interface ChatSession {
 id: string;
 preview: string;
 createdAt: string;
}

interface RoadmapChatProps {
 projectId: string;
 onRoadmapUpdate: () => void;
 className?: string;
}

function parseCommands(text: string): Array<Record<string, unknown>> {
 const match = text.match(/<roadmap_commands>([\s\S]*?)<\/roadmap_commands>/);
 if (!match) return [];
 try {
  const parsed = JSON.parse(match[1]);
  return Array.isArray(parsed) ? parsed : [];
 } catch {
  return [];
 }
}

function stripCommandsFromDisplay(text: string): string {
 let result = text.replace(/<roadmap_commands>[\s\S]*?<\/roadmap_commands>/g, "");
 result = result.replace(/<roadmap_commands>[\s\S]*$/g, "");
 return result.trim();
}

function formatSessionDate(dateStr: string): string {
 const date = new Date(dateStr);
 const now = new Date();
 const diffMs = now.getTime() - date.getTime();
 const diffMins = Math.floor(diffMs / 60000);
 const diffHours = Math.floor(diffMs / 3600000);
 const diffDays = Math.floor(diffMs / 86400000);

 if (diffMins < 1) return "Az once";
 if (diffMins < 60) return `${diffMins}dk once`;
 if (diffHours < 24) return `${diffHours}sa once`;
 if (diffDays < 7) return `${diffDays}g once`;
 return date.toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
}

export default function RoadmapChat({
 projectId,
 onRoadmapUpdate,
 className,
}: RoadmapChatProps) {
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

 // Load chat history
 const loadSession = useCallback(
  async (targetSessionId?: string) => {
   try {
    const url = targetSessionId
     ? `/api/projects/${projectId}/roadmap/chat/history?sessionId=${targetSessionId}`
     : `/api/projects/${projectId}/roadmap/chat/history`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data.messages)) {
     setMessages(data.messages);
    }
    if (data.sessionId) {
     sessionIdRef.current = data.sessionId;
    }
    if (Array.isArray(data.sessions)) {
     setSessions(data.sessions);
    }
   } catch {
    // silently ignore
   }
  },
  [projectId]
 );

 // Load on mount
 useEffect(() => {
  let cancelled = false;
  async function init() {
   await loadSession();
   if (!cancelled) setIsLoadingHistory(false);
  }
  init();
  return () => {
   cancelled = true;
  };
 }, [loadSession]);

 // Auto-scroll on new messages
 useEffect(() => {
  if (scrollRef.current) {
   scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }
 }, [messages]);

 // Focus textarea on mount
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
   const res = await fetch(`/api/projects/${projectId}/roadmap/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
     sessionId: sessionIdRef.current,
     messages: newMessages.map((m) => ({
      role: m.role,
      content: m.content,
     })),
    }),
   });

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

      if (parsed.step) {
       if (parsed.step === "applying") {
        setStreamingStep("Değişiklikler uygulanıyor...");
       } else if (parsed.step === "applied") {
        setStreamingStep(null);
       }
      }

      if (parsed.chunk) {
       fullContent += parsed.chunk;
       const displayContent = stripCommandsFromDisplay(fullContent);

       // Detect <roadmap_commands> tag during streaming
       if (fullContent.includes("<roadmap_commands>") && !fullContent.includes("</roadmap_commands>")) {
        setStreamingStep("Roadmap komutları hazırlanıyor...");
       }

       setMessages((prev) => {
        const updated = [...prev];
        updated[assistantIndex] = {
         role: "assistant",
         content: displayContent,
        };
        return updated;
       });
      }

      if (parsed.done) {
       const cmds = parseCommands(fullContent);
       setMessages((prev) => {
        const updated = [...prev];
        updated[assistantIndex] = {
         ...updated[assistantIndex],
         commands: cmds.length > 0 ? cmds : undefined,
         commandsApplied: parsed.commandsApplied ?? false,
        };
        return updated;
       });
       if (parsed.commandsApplied) {
        onRoadmapUpdate();
       }
      }

      if (parsed.error) {
       setMessages((prev) => {
        const updated = [...prev];
        updated[assistantIndex] = {
         role: "assistant",
         content: "Bir hata olustu. Lutfen tekrar deneyin.",
        };
        return updated;
       });
      }
     } catch {
      // Skip unparseable lines
     }
    }
   }

   // Refresh session list after successful send
   try {
    const histRes = await fetch(
     `/api/projects/${projectId}/roadmap/chat/history?sessionId=${sessionIdRef.current}`
    );
    if (histRes.ok) {
     const histData = await histRes.json();
     if (Array.isArray(histData.sessions)) {
      setSessions(histData.sessions);
     }
    }
   } catch {
    // ignore
   }
  } catch {
   setMessages((prev) => {
    const updated = [...prev];
    if (updated[assistantIndex]) {
     updated[assistantIndex] = {
      role: "assistant",
      content: "Baglanti hatasi. Lutfen tekrar deneyin.",
     };
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
    <h2 className="text-base font-semibold">Roadmap AI Chat</h2>
    <div className="flex items-center gap-1">
     {!isStreaming && (
      <Button
       variant="ghost"
       size="sm"
       onClick={() => setShowSessions(!showSessions)}
       className={`h-7 text-xs gap-1 ${showSessions ? "text-foreground bg-muted" : "text-muted-foreground"}`}
      >
       <History className="h-3.5 w-3.5" />
       Gecmis
      </Button>
     )}
     {!isStreaming && (
      <Button
       variant="ghost"
       size="sm"
       onClick={handleNewChat}
       className="h-7 text-xs gap-1 text-muted-foreground"
      >
       <Plus className="h-3.5 w-3.5" />
       Yeni
      </Button>
     )}
    </div>
   </div>

   {/* Session list */}
   {showSessions && (
    <div className="border-b shrink-0">
     <ScrollArea className="max-h-[200px]">
      <div className="py-1">
       {sessions.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-4">
         Henuz gecmis sohbet yok
        </p>
       )}
       {sessions.map((s) => (
        <button
         key={s.id}
         onClick={() => handleSelectSession(s.id)}
         className={`w-full text-left px-4 py-2 hover:bg-muted/50 transition-colors flex items-start gap-2.5 ${
          s.id === sessionIdRef.current
           ? "bg-muted/70"
           : ""
         }`}
        >
         <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
         <div className="flex-1 min-w-0">
          <p className="text-xs truncate">
           {s.preview || "Bos sohbet"}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
           {formatSessionDate(s.createdAt)}
          </p>
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
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
       <Loader2 className="h-5 w-5 animate-spin mr-2" />
       <span>Sohbet gecmisi yukleniyor...</span>
      </div>
     )}
     {!isLoadingHistory && messages.length === 0 && (
      <div className="text-center py-12 text-muted-foreground text-sm">
       <Bot className="h-8 w-8 mx-auto mb-3 opacity-40" />
       <p>Roadmap uzerinde degisiklik yapmak icin mesaj yazin.</p>
       <p className="text-xs mt-1 opacity-70">
        Ornek: &quot;1.1.1&apos;in yazim stratejisini degistir&quot;
       </p>
      </div>
     )}
     {messages.map((msg, i) => (
      <div key={i}>
       <div className="flex gap-2.5 items-start">
        <div
         className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          msg.role === "user"
           ? "bg-accent"
           : "bg-emerald-100 dark:bg-emerald-900/30"
         }`}
        >
         {msg.role === "user" ? (
          <User className="h-3.5 w-3.5 text-primary" />
         ) : (
          <Bot className="h-3.5 w-3.5 text-emerald-600" />
         )}
        </div>
        <div className="flex-1 min-w-0">
         <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
          {msg.content}
          {isStreaming &&
           i === messages.length - 1 &&
           msg.role === "assistant" && (
            <span className="inline-block w-1.5 h-4 bg-foreground/60 animate-pulse ml-0.5 align-middle" />
           )}
         </p>
         {msg.commands && msg.commands.length > 0 && (
          <CommandGroup
           commands={msg.commands}
           applied={msg.commandsApplied ?? false}
          />
         )}
         {isStreaming && i === messages.length - 1 && msg.role === "assistant" && streamingStep && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2">
           <Loader2 className="h-3 w-3 animate-spin" />
           <span>{streamingStep}</span>
          </div>
         )}
        </div>
       </div>
      </div>
     ))}
    </div>
   </ScrollArea>

   {/* Input */}
   <div className="border-t px-4 py-3 shrink-0">
    <div className="flex gap-2 items-end">
     <Textarea
      ref={textareaRef}
      value={input}
      onChange={(e) => setInput(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder="Roadmap degisikligi icin mesaj yazin..."
      className="min-h-[40px] max-h-[120px] resize-none text-sm"
      rows={1}
      disabled={isStreaming}
     />
     <Button
      size="icon"
      onClick={handleSend}
      disabled={!input.trim() || isStreaming}
      className="shrink-0 h-10 w-10"
     >
      {isStreaming ? (
       <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
       <Send className="h-4 w-4" />
      )}
     </Button>
    </div>
   </div>
  </div>
 );
}
