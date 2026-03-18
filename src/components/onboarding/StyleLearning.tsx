"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, Send, Loader2, FileText, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import type { StyleProfile } from "@/types/project";

interface ChatMessage {
 role: "user" | "assistant";
 content: string;
}

interface StyleLearningProps {
 projectId?: string;
 onStyleExtracted: (profile: Partial<StyleProfile>) => void;
 extractedProfile: Partial<StyleProfile> | null;
}

const STYLE_TAGS: Array<{ key: keyof StyleProfile; label: (val: unknown) => string }> = [
 { key: "tone", label: (v) => `Tone: ${v}` },
 { key: "sentenceLength", label: (v) => `Sentences: ${v}` },
 { key: "terminologyDensity", label: (v) => `Terminology: ${v}` },
 { key: "voicePreference", label: (v) => `Voice: ${v}` },
 { key: "paragraphStructure", label: (v) => `Structure: ${v}` },
 { key: "rhetoricalApproach", label: (v) => `Rhetoric: ${v}` },
 {
  key: "usesFirstPerson",
  label: (v) => (v ? "Uses first person" : "Avoids first person"),
 },
 { key: "formality", label: (v) => `Formality: ${v}/10` },
];

export default function StyleLearning({
 projectId,
 onStyleExtracted,
 extractedProfile,
}: StyleLearningProps) {
 const [sampleText, setSampleText] = useState("");
 const [isAnalyzing, setIsAnalyzing] = useState(false);
 const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
  {
   role: "assistant",
   content:
    "Hello! I'm going to ask you a few questions to understand your writing style. Let's start: How would you describe the tone you want for this book — formal and academic, semi-formal, or conversational?",
  },
 ]);
 const [chatInput, setChatInput] = useState("");
 const [isSendingChat, setIsSendingChat] = useState(false);

 async function handleAnalyzeSample() {
  if (!sampleText.trim() || sampleText.trim().length < 100) {
   toast.error("Please paste at least 100 characters of sample text.");
   return;
  }

  setIsAnalyzing(true);
  try {
   const res = await fetch("/api/style/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sampleText }),
   });

   if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Analysis failed" }));
    throw new Error(err.error ?? "Analysis failed");
   }

   const { styleProfile } = await res.json();
   onStyleExtracted(styleProfile);
   toast.success("Style profile extracted successfully!");
  } catch (err) {
   toast.error(err instanceof Error ? err.message : "Analysis failed");
  } finally {
   setIsAnalyzing(false);
  }
 }

 async function handleSendChat() {
  const message = chatInput.trim();
  if (!message) return;

  const updatedMessages: ChatMessage[] = [
   ...chatMessages,
   { role: "user", content: message },
  ];
  setChatMessages(updatedMessages);
  setChatInput("");
  setIsSendingChat(true);

  try {
   const res = await fetch("/api/style/interview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: updatedMessages }),
   });

   if (!res.ok) throw new Error("Chat failed");

   const { reply, styleProfile } = await res.json();
   setChatMessages([
    ...updatedMessages,
    { role: "assistant", content: reply },
   ]);

   if (styleProfile) {
    onStyleExtracted(styleProfile);
    toast.success("Style profile updated!");
   }
  } catch {
   toast.error("Failed to get response. Please try again.");
   setChatMessages(updatedMessages.slice(0, -1));
   setChatInput(message);
  } finally {
   setIsSendingChat(false);
  }
 }

 function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Enter" && !e.shiftKey) {
   e.preventDefault();
   handleSendChat();
  }
 }

 return (
  <div className="space-y-6">
   <Tabs defaultValue="upload">
    <TabsList className="grid grid-cols-2 w-full">
     <TabsTrigger value="upload" className="gap-2">
      <FileText className="h-3.5 w-3.5" />
      Upload Sample
     </TabsTrigger>
     <TabsTrigger value="interview" className="gap-2">
      <MessageSquare className="h-3.5 w-3.5" />
      AI Interview
     </TabsTrigger>
    </TabsList>

    <TabsContent value="upload" className="mt-4 space-y-4">
     <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
       Paste a sample of your writing (at least a few paragraphs). The AI
       will analyze your style, tone, sentence structure, and more.
      </p>
      <Textarea
       placeholder="Paste your sample text here — a few paragraphs from a previous work, article, or any text that represents how you write..."
       value={sampleText}
       onChange={(e) => setSampleText(e.target.value)}
       className="min-h-[220px] resize-none font-mono text-sm"
      />
      <div className="flex items-center justify-between">
       <span className="text-xs text-muted-foreground">
        {sampleText.length} characters
        {sampleText.length < 100 && sampleText.length > 0 && (
         <span className="text-amber-500 ml-1">
          (need at least 100)
         </span>
        )}
       </span>
       <Button
        onClick={handleAnalyzeSample}
        disabled={isAnalyzing || sampleText.trim().length < 100}
        className="gap-2"
       >
        {isAnalyzing ? (
         <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
         <Sparkles className="h-4 w-4" />
        )}
        {isAnalyzing ? "Analyzing..." : "Analyze Style"}
       </Button>
      </div>
     </div>
    </TabsContent>

    <TabsContent value="interview" className="mt-4">
     <div className="border border-border rounded-lg overflow-hidden">
      <ScrollArea className="h-72 p-4">
       <div className="space-y-4">
        {chatMessages.map((msg, idx) => (
         <div
          key={idx}
          className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
         >
          {msg.role === "assistant" && (
           <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent">
            <Sparkles className="h-3.5 w-3.5 text-primary dark:text-primary" />
           </div>
          )}
          <div
           className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
            msg.role === "user"
             ? "bg-primary text-primary-foreground rounded-br-none"
             : "bg-muted text-foreground rounded-bl-none"
           }`}
          >
           {msg.content}
          </div>
         </div>
        ))}
        {isSendingChat && (
         <div className="flex gap-3 justify-start">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent">
           <Sparkles className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="rounded-xl rounded-bl-none bg-muted px-4 py-3">
           <div className="flex gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:0ms]" />
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:300ms]" />
           </div>
          </div>
         </div>
        )}
       </div>
      </ScrollArea>
      <div className="border-t border-border p-3 flex gap-2">
       <Input
        placeholder="Type your answer..."
        value={chatInput}
        onChange={(e) => setChatInput(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isSendingChat}
        className="flex-1"
       />
       <Button
        size="icon"
        onClick={handleSendChat}
        disabled={isSendingChat || !chatInput.trim()}
        className="shrink-0"
       >
        {isSendingChat ? (
         <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
         <Send className="h-4 w-4" />
        )}
       </Button>
      </div>
     </div>
    </TabsContent>
   </Tabs>

   {extractedProfile && Object.keys(extractedProfile).length > 0 && (
    <div className="rounded-xl border border-border bg-accent p-4">
     <div className="flex items-center gap-2 mb-3">
      <Sparkles className="h-4 w-4 text-primary" />
      <h3 className="text-sm font-semibold text-foreground">
       Extracted Style Profile
      </h3>
     </div>
     <div className="flex flex-wrap gap-2">
      {STYLE_TAGS.map(({ key, label }) => {
       const val = extractedProfile[key];
       if (val === undefined || val === null) return null;
       return (
        <Badge
         key={key}
         variant="secondary"
         className="text-xs bg-white border border-border text-primary"
        >
         {label(val)}
        </Badge>
       );
      })}
      {extractedProfile.transitionPatterns &&
       extractedProfile.transitionPatterns.length > 0 && (
        <Badge
         variant="secondary"
         className="text-xs bg-white border border-border text-primary"
        >
         Transitions: {extractedProfile.transitionPatterns.slice(0, 3).join(", ")}
        </Badge>
       )}
     </div>
     {extractedProfile.additionalNotes && (
      <p className="text-xs text-primary/80 dark:text-primary mt-3 italic">
       {extractedProfile.additionalNotes}
      </p>
     )}
    </div>
   )}
  </div>
 );
}
