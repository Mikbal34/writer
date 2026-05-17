"use client";

import { Loader2, User } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import PinNoteButton from "@/components/library/PinNoteButton";

export type Scope = "all" | "picked" | "single";

export interface ChatSource {
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
  /** First ~280 chars of the cited chunk/note. Powers the inline
   *  "AI bu metni gösterdi" preview banner above the PDF viewer. */
  text?: string | null;
}

export interface ChatMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[];
  scope?: Scope;
  entryIds?: string[];
}

export interface MessageBubbleEntry {
  id: string;
  title: string;
  authorSurname: string;
  authorName: string | null;
  year: string | null;
}

interface MessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
  isLast?: boolean;
  sessionId: string;
  allEntries: MessageBubbleEntry[];
  /** "full" mirrors the /library/chat layout. "split" tightens spacing
   *  (gold Q avatar, slightly smaller body, compact source chips) for
   *  the 540px right column of the per-book split view. */
  variant?: "full" | "split";
  /** When set, source chips become clickable — clicking opens the
   *  parent's source/PDF panel and focuses the corresponding tab. */
  onSourceClick?: (source: ChatSource) => void;
}

export default function MessageBubble({
  message,
  isStreaming,
  isLast,
  sessionId,
  allEntries,
  variant = "full",
  onSourceClick,
}: MessageBubbleProps) {
  const isUser = message.role === "user";
  const showCursor =
    isStreaming && isLast && !isUser && message.content.length > 0;
  const suggestedEntryIds = (message.sources ?? [])
    .map((s) => s.entryId)
    .filter((v, i, arr) => arr.indexOf(v) === i);
  const showPin = !isUser && message.content.length > 0 && !isStreaming;
  const isSplit = variant === "split";

  return (
    <div className="flex gap-3 items-start">
      {isUser ? (
        <div
          className={cn(
            "shrink-0 rounded-full flex items-center justify-center border border-sandy/60 bg-page",
            isSplit ? "h-6 w-6" : "h-8 w-8",
          )}
          aria-hidden
        >
          <User
            className={cn(isSplit ? "h-3 w-3" : "h-4 w-4", "text-ink-light")}
          />
        </div>
      ) : isSplit ? (
        <div
          className="h-6 w-6 shrink-0 rounded-sm bg-gold flex items-center justify-center font-display italic text-white text-[13px] font-semibold leading-none"
          aria-hidden
        >
          Q
        </div>
      ) : (
        <img
          src="/images/quilpen-icon.png"
          alt="Q"
          className="h-8 w-8 shrink-0 rounded-md border border-sandy/60 bg-white/70"
        />
      )}
      <div className="flex-1 min-w-0">
        {!isUser && message.scope && (
          <div
            className="font-ui text-[10px] uppercase tracking-widest text-gold-dark mb-1"
            style={{ letterSpacing: "0.16em" }}
          >
            {message.scope === "all"
              ? "Tüm Kütüphane"
              : `${message.entryIds?.length ?? 0} PDF`}
          </div>
        )}
        <div
          className={cn(
            "prose-chat font-body break-words text-ink",
            isSplit ? "text-[12.5px]" : "text-sm",
            isUser && "italic text-ink-light",
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
            <span className="inline-block w-1.5 h-4 bg-ink/60 animate-pulse ml-0.5 align-middle" />
          )}
        </div>
        {showPin && (
          <div className="mt-2 flex items-center gap-2">
            <PinNoteButton
              sessionId={sessionId}
              messageContent={message.content}
              entries={allEntries.map((e) => ({
                id: e.id,
                title: e.title,
                authorSurname: e.authorSurname,
                authorName: e.authorName,
                year: e.year,
              }))}
              suggestedEntryIds={suggestedEntryIds}
            />
          </div>
        )}
        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="mt-3 pt-2 border-t border-sandy/40 flex flex-wrap gap-1.5">
            {message.sources.map((src) => {
              const isNote = src.kind === "note";
              const chipClasses = cn(
                "inline-flex items-center gap-1 rounded-sm font-ui text-[10px] transition-colors",
                isSplit ? "px-1.5 py-0.5" : "px-2 py-0.5",
                isNote
                  ? "bg-sandy-soft border border-sandy text-ink-light"
                  : "bg-page border border-gold/30 text-gold-dark",
                onSourceClick &&
                  (isNote
                    ? "hover:bg-sandy hover:text-ink cursor-pointer"
                    : "hover:bg-gold/15 hover:border-gold cursor-pointer"),
              );
              const chipKey = `${src.entryId}-${src.marker}-${isNote ? "n" : "c"}`;
              const chipTitle = `${src.title}${
                src.noteTitle ? ` — ${src.noteTitle}` : ""
              }${src.page !== null ? ` (s. ${src.page})` : ""}`;
              const chipContent = (
                <>
                  <span className="font-mono">[{src.marker}]</span>
                  {isNote && <span className="font-ui">📝</span>}
                  <span className="line-clamp-1 max-w-[200px]">
                    {src.authorSurname ?? src.title}
                    {src.noteTitle ? ` — ${src.noteTitle}` : ""}
                    {src.page !== null ? `, s. ${src.page}` : ""}
                  </span>
                </>
              );
              return onSourceClick ? (
                <button
                  key={chipKey}
                  type="button"
                  onClick={() => onSourceClick(src)}
                  className={chipClasses}
                  title={chipTitle}
                >
                  {chipContent}
                </button>
              ) : (
                <span key={chipKey} className={chipClasses} title={chipTitle}>
                  {chipContent}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
