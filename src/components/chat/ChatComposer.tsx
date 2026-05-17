"use client";

import { Send, Square } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  isStreaming: boolean;
  placeholder?: string;
  /** "bar" mirrors the legacy /library/chat input bar (max-w-3xl centered,
   *  larger textarea, full-width bg-page footer). "compact" is a tighter
   *  single-row variant sized for the 540px right column on the per-book
   *  split view. Defaults to "bar". */
  variant?: "bar" | "compact";
  /** Optional buttons rendered to the left of the textarea (e.g. attach,
   *  slash-command). The split view uses this for "+ Yeni alıntı" etc. */
  leadingSlot?: React.ReactNode;
}

export default function ChatComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  isStreaming,
  placeholder,
  variant = "bar",
  leadingSlot,
}: ChatComposerProps) {
  const isBar = variant === "bar";

  return (
    <div
      className={cn(
        isBar ? "flex items-end gap-2 max-w-3xl mx-auto" : "flex items-end gap-2",
      )}
    >
      {leadingSlot}
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
        className={cn(
          "flex-1 resize-none font-body rounded-sm border bg-white text-ink placeholder:text-ink-muted focus:outline-none focus:border-gold disabled:opacity-60",
          isBar
            ? "text-sm px-3 py-2 border-sandy"
            : "text-[12.5px] px-2.5 py-1.5 border-sandy/70",
        )}
        style={{ maxHeight: isBar ? 200 : 140 }}
      />
      {isStreaming ? (
        <button
          type="button"
          onClick={onStop}
          className={cn(
            "flex items-center gap-1.5 rounded-sm border border-red-200 text-red-600 font-ui hover:bg-red-50 transition-colors",
            isBar ? "px-3 py-2 text-xs" : "px-2.5 py-1.5 text-[11px]",
          )}
        >
          <Square className="h-3 w-3" />
          Stop
        </button>
      ) : (
        <button
          type="button"
          onClick={onSubmit}
          disabled={!value.trim()}
          className={cn(
            "flex items-center gap-1.5 rounded-sm bg-gold text-ink font-ui font-semibold hover:bg-gold-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
            isBar ? "px-3 py-2 text-xs" : "px-2.5 py-1.5 text-[11px]",
          )}
        >
          <Send className="h-3 w-3" />
          Gönder
        </button>
      )}
    </div>
  );
}
