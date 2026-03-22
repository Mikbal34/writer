"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2, User, Plus, History, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import CommandGroup from "./CommandGroup";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FadeUp, StaggerItem } from "@/components/shared/Animations";

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

 if (diffMins < 1) return "Just now";
 if (diffMins < 60) return `${diffMins}m ago`;
 if (diffHours < 24) return `${diffHours}h ago`;
 if (diffDays < 7) return `${diffDays}d ago`;
 return date.toLocaleDateString("en-US", { day: "numeric", month: "short" });
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

   if (res.status === 402) {
    const errData = await res.json().catch(() => ({}));
    toast.error(`Insufficient credits (${errData.balance ?? 0} remaining). You need ~${errData.cost ?? '?'} credits for this operation.`);
    setMessages(newMessages); // remove empty assistant message
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

      if (parsed.step) {
       if (parsed.step === "applying") {
        setStreamingStep("Applying changes...");
       } else if (parsed.step === "applied") {
        setStreamingStep(null);
       }
      }

      if (parsed.chunk) {
       fullContent += parsed.chunk;
       const displayContent = stripCommandsFromDisplay(fullContent);

       // Detect <roadmap_commands> tag during streaming
       if (fullContent.includes("<roadmap_commands>") && !fullContent.includes("</roadmap_commands>")) {
        setStreamingStep("Preparing roadmap commands...");
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
         content: "An error occurred. Please try again.",
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
      content: "Connection error. Please try again.",
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
    <h2 className="font-display text-base font-bold">Roadmap AI Chat</h2>
    <div className="flex items-center gap-1">
     {!isStreaming && (
      <Button
       variant="ghost"
       size="sm"
       onClick={() => setShowSessions(!showSessions)}
       className={`h-7 font-ui text-xs gap-1 ${showSessions ? "text-foreground bg-muted" : "text-muted-foreground"}`}
      >
       <History className="h-3.5 w-3.5" />
       History
      </Button>
     )}
     {!isStreaming && (
      <Button
       variant="ghost"
       size="sm"
       onClick={handleNewChat}
       className="h-7 font-ui text-xs gap-1 text-muted-foreground"
      >
       <Plus className="h-3.5 w-3.5" />
       New
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
        <p className="font-body text-xs text-muted-foreground text-center py-4">
         No chat history yet
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
          <p className="font-body text-xs truncate">
           {s.preview || "Empty chat"}
          </p>
          <p className="font-ui text-[10px] text-muted-foreground mt-0.5">
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
      <div className="flex items-center justify-center py-12 text-muted-foreground">
       <Loader2 className="h-5 w-5 animate-spin mr-2" />
       <span className="font-body text-sm">Loading chat history...</span>
      </div>
     )}
     {!isLoadingHistory && messages.length === 0 && (
      <div className="text-center py-12 text-muted-foreground">
       <img src="/images/quillon-icon.png" alt="Quillon" className="h-12 w-12 mx-auto mb-3 opacity-60 rounded-lg" />
       <p className="font-body text-sm">Send a message to make changes to the roadmap.</p>
       <p className="font-body text-xs mt-1 opacity-70">
        Example: &quot;Change the writing strategy of 1.1.1&quot;
       </p>
      </div>
     )}
     {messages.map((msg, i) => (
      <StaggerItem key={i} index={i} baseDelay={0.1} stagger={0.05}>
       <div className="flex gap-2.5 items-start">
        {msg.role === "user" ? (
         <User className="h-7 w-7 shrink-0 text-[#8a7a65]" />
        ) : (
         <img src="/images/quillon-icon.png" alt="Q" className="h-7 w-7 shrink-0 rounded-lg" />
        )}
        <div className="flex-1 min-w-0">
         <div className="font-body text-sm prose-chat break-words">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
           {msg.content}
          </ReactMarkdown>
          {isStreaming &&
           i === messages.length - 1 &&
           msg.role === "assistant" && (
            <span className="inline-block w-1.5 h-4 bg-foreground/60 animate-pulse ml-0.5 align-middle" />
           )}
         </div>
         {msg.commands && msg.commands.length > 0 && (
          <CommandGroup
           commands={msg.commands}
           applied={msg.commandsApplied ?? false}
          />
         )}
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
     <Textarea
      ref={textareaRef}
      value={input}
      onChange={(e) => setInput(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder="Type a message to modify the roadmap..."
      className="min-h-[40px] max-h-[120px] resize-none font-body text-sm"
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
