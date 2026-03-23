"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2, User, Plus, History, MessageSquare, BookOpen, AlertTriangle } from "lucide-react";
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

type SourceDensity = "low" | "normal" | "high";

const SOURCE_DENSITY_OPTIONS: { value: SourceDensity; label: string; desc: string; estimate: string; credits: string }[] = [
 { value: "low", label: "Minimal", desc: "1 source per subsection", estimate: "~45 sources total for a typical book", credits: "~600" },
 { value: "normal", label: "Standard", desc: "2-3 sources per subsection", estimate: "~90-135 sources total for a typical book", credits: "~1000" },
 { value: "high", label: "Comprehensive", desc: "4-5 sources per subsection", estimate: "~180-225 sources total for a typical book", credits: "~1400" },
];

interface RoadmapChatProps {
 projectId: string;
 onRoadmapUpdate: () => void;
 hasRoadmap?: boolean;
 projectType?: string;
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
 // Remove completed command blocks
 let result = text.replace(/<roadmap_commands>[\s\S]*?<\/roadmap_commands>/g, "");
 // Remove any partially streamed command block (from opening tag to end)
 const openTagIndex = result.indexOf("<roadmap_commands>");
 if (openTagIndex !== -1) {
  result = result.slice(0, openTagIndex);
 }
 // Catch partial opening tags being streamed char by char (e.g. "<roadmap_c")
 const partialMatch = result.match(/<roadmap_c[^>]*$/);
 if (partialMatch && partialMatch.index !== undefined) {
  result = result.slice(0, partialMatch.index);
 }
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
 hasRoadmap = false,
 projectType = "ACADEMIC",
 className,
}: RoadmapChatProps) {
 const needsSources = projectType === "ACADEMIC";
 const [messages, setMessages] = useState<Message[]>([]);
 const [sessions, setSessions] = useState<ChatSession[]>([]);
 const [input, setInput] = useState("");
 const [isStreaming, setIsStreaming] = useState(false);
 const [isLoadingHistory, setIsLoadingHistory] = useState(true);
 const [streamingStep, setStreamingStep] = useState<string | null>(null);
 const [showSessions, setShowSessions] = useState(false);
 const [sourceDensity, setSourceDensity] = useState<SourceDensity>("normal");
 const [creditBalance, setCreditBalance] = useState<number | null>(null);
 const sessionIdRef = useRef<string>(crypto.randomUUID());
 const scrollRef = useRef<HTMLDivElement>(null);
 const textareaRef = useRef<HTMLTextAreaElement>(null);

 // Show source density selector only in creation mode for academic projects
 // Wait for history to load before deciding — prevents flash on existing projects
 const isCreationMode = !isLoadingHistory && !hasRoadmap && messages.length === 0;
 const showDensitySelector = isCreationMode && needsSources;

 // Fetch credit balance for density warning
 useEffect(() => {
  if (!showDensitySelector) return;
  fetch("/api/credits")
   .then((r) => r.ok ? r.json() : null)
   .then((d) => d && setCreditBalance(d.balance))
   .catch(() => {});
 }, [showDensitySelector]);

 const selectedDensityCredits = { low: 600, normal: 1000, high: 1400 }[sourceDensity];
 const remainingAfterRoadmap = creditBalance != null ? creditBalance - selectedDensityCredits : null;
 const estimatedWritingSections = remainingAfterRoadmap != null && remainingAfterRoadmap > 0
  ? Math.floor(remainingAfterRoadmap / 120)
  : 0;

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
     sourceDensity,
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
       if (parsed.creditsUsed != null) {
        toast.info(`${parsed.creditsUsed} credits used. Balance: ${parsed.balance}`);
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
       <img src="/images/quilpen-icon.png" alt="Quilpen" className="h-12 w-12 mx-auto mb-3 opacity-60 rounded-lg" />
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
         <img src="/images/quilpen-icon.png" alt="Q" className="h-7 w-7 shrink-0 rounded-lg" />
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

   {/* Source density selector — shown only in creation mode for academic projects */}
   {showDensitySelector && (
    <div className="border-t px-4 py-2.5 shrink-0 bg-muted/30">
     <div className="flex items-center gap-2 mb-2">
      <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="font-ui text-xs font-medium">Source Density</span>
     </div>
     <div className="flex gap-1.5">
      {SOURCE_DENSITY_OPTIONS.map((opt) => (
       <button
        key={opt.value}
        onClick={() => setSourceDensity(opt.value)}
        className={`flex-1 rounded-md px-2.5 py-2 text-left transition-colors border ${
         sourceDensity === opt.value
          ? "border-foreground/30 bg-background shadow-sm"
          : "border-transparent hover:bg-muted/50"
        }`}
       >
        <span className="font-ui text-xs font-medium block">{opt.label}</span>
        <span className="font-body text-[10px] text-muted-foreground block mt-0.5">{opt.desc}</span>
        <span className="font-body text-[10px] text-muted-foreground/70 block">{opt.estimate}</span>
        <span className="font-ui text-[10px] font-medium block mt-1">{opt.credits} credits</span>
       </button>
      ))}
     </div>
     {creditBalance != null && (
      <div className={`mt-2 rounded-md px-2.5 py-1.5 ${
       remainingAfterRoadmap != null && remainingAfterRoadmap < 120
        ? "bg-red-50 text-red-700"
        : remainingAfterRoadmap != null && estimatedWritingSections < 5
         ? "bg-amber-50 text-amber-700"
         : "bg-muted/50 text-muted-foreground"
      }`}>
       <div className="flex items-center gap-1.5">
        <AlertTriangle className="h-3 w-3 shrink-0" />
        <span className="font-ui text-[10px]">
         Your balance: <strong>{creditBalance}</strong> credits.
         Roadmap will use ~{selectedDensityCredits}, leaving ~{Math.max(0, remainingAfterRoadmap ?? 0)} for writing
         {estimatedWritingSections > 0 ? ` (~${estimatedWritingSections} sections).` : "."}
        </span>
       </div>
       {remainingAfterRoadmap != null && remainingAfterRoadmap < 120 && (
        <p className="font-ui text-[10px] mt-1 font-medium">
         Not enough credits left for writing. Choose a lower source density.
        </p>
       )}
      </div>
     )}
    </div>
   )}

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
