import React from "react";
import IconRail from "@/components/shared/IconRail";
import { cn } from "@/lib/utils";

interface WorkspaceShellProps {
  children: React.ReactNode;
  /**
   * Content for the 240px context pane that sits between the icon
   * rail and the main area. Pages declare this slot when they have
   * a section-scoped second column: Library uses it for folder chips
   * + collections, project pages will eventually mount the chapter
   * outline here. Omit the prop entirely to hide the pane and let
   * main occupy the full remaining width.
   */
  context?: React.ReactNode;
  /**
   * When true, main is `flex flex-col overflow-hidden` so the page
   * can lay out its own scrollable areas (chat threads, PDF viewer
   * split-views). Default is `overflow-y-auto` so plain content
   * scrolls inside the main column without affecting the chrome.
   */
  fullHeight?: boolean;
  /**
   * Optional fixed width override for the context pane. Most callers
   * will use the default 240px, but the library detail pane is wider
   * (~340px) for cover + meta + stats. Pass any Tailwind width class
   * (e.g. "w-[340px]") and it replaces the default.
   */
  contextWidth?: string;
}

/**
 * Top-level workspace shell. Three columns laid out edge-to-edge:
 *
 *   ┌────┬──────────────┬──────────────────────────────────┐
 *   │rail│ contextPane  │  main                            │
 *   │56px│  240px       │  fills remaining                 │
 *   └────┴──────────────┴──────────────────────────────────┘
 *
 * Panel seams are subtle tint shifts (bg-rail vs bg-page) rather
 * than heavy borders — the V3 mockup keeps the design language
 * book-like without sectioning the screen visually.
 *
 * Pages outside the workspace (auth, pricing, wizard) intentionally
 * skip this shell.
 */
export default function WorkspaceShell({
  children,
  context,
  fullHeight,
  contextWidth,
}: WorkspaceShellProps) {
  return (
    <div className="h-screen flex bg-page text-ink overflow-hidden">
      <IconRail />

      {context !== undefined && (
        <aside
          className={cn(
            "shrink-0 bg-panel border-r border-sandy-soft overflow-y-auto hidden lg:block",
            contextWidth ?? "w-60",
          )}
        >
          {context}
        </aside>
      )}

      <main
        className={cn(
          "flex-1 min-w-0 bg-page",
          fullHeight
            ? "flex flex-col overflow-hidden"
            : "overflow-y-auto",
        )}
      >
        {/* Spacer for the mobile menu button so the page header isn't
            obscured on narrow viewports. */}
        <div className="lg:hidden h-14" />
        {children}
      </main>
    </div>
  );
}
