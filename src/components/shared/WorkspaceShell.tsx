import React from "react";
import IconRail from "@/components/shared/IconRail";
import { cn } from "@/lib/utils";

interface WorkspaceShellProps {
  children: React.ReactNode;
  /**
   * Override the default IconRail with a context-specific one.
   * Project pages, for example, pass a green ProjectIconRail that
   * lists the project's nav (Dashboard, Roadmap, Sources, Write…)
   * instead of the global top-level rail. Omit to use the default.
   */
  rail?: React.ReactNode;
  /**
   * Strip the main column's default bg-elevated rounded card. Pages
   * that build their own multi-card layout inside main (the library
   * with its shelf + detail panel) opt in so their inner cards sit
   * directly inside the workspace gutter, height-matching the rail.
   */
  bareMain?: boolean;
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
 * Top-level workspace shell. Three floating cards laid out with a 14px
 * outer gutter and 14px gap so each column reads as its own island:
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ ┌────┐ ┌──────────────┐ ┌─────────────────────────────┐  │
 *   │ │rail│ │ contextPane  │ │ main                        │  │
 *   │ │56px│ │   240px      │ │ fills remaining             │  │
 *   │ └────┘ └──────────────┘ └─────────────────────────────┘  │
 *   └──────────────────────────────────────────────────────────┘
 *
 * The dark forest-deep rail is the primary brand surface; the lighter
 * cards float on the page background. Pages outside the workspace
 * (auth, pricing, wizard) intentionally skip this shell.
 */
export default function WorkspaceShell({
  children,
  context,
  fullHeight,
  contextWidth,
  bareMain,
  rail,
}: WorkspaceShellProps) {
  return (
    <div className="h-screen flex bg-page text-ink overflow-hidden gap-3.5 p-3.5">
      {rail ?? <IconRail />}

      {context !== undefined && (
        <aside
          className={cn(
            "shrink-0 bg-elevated rounded-2xl overflow-y-auto hidden lg:block",
            contextWidth ?? "w-60",
          )}
        >
          {context}
        </aside>
      )}

      <main
        className={cn(
          "flex-1 min-w-0",
          bareMain ? "" : "bg-elevated rounded-2xl",
          fullHeight ? "flex flex-col overflow-hidden" : "overflow-y-auto",
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
