"use client";

/**
 * Animated right-side sources panel. Slides in (width 0 → 640) when the
 * user clicks a source citation chip; opened sources stack as Chrome-
 * style tabs across the top. The active tab renders a PdfReaderPanel
 * with the corresponding page jump.
 */

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import PdfReaderPanel from "@/components/library/PdfReaderPanel";
import type { SourceTab } from "./useSourceTabs";

interface SourcesPanelProps {
  tabs: SourceTab[];
  activeKey: string | null;
  isOpen: boolean;
  onClose: (key: string) => void;
  onActivate: (key: string) => void;
  onCloseAll: () => void;
}

const PANEL_WIDTH = 640;

export default function SourcesPanel({
  tabs,
  activeKey,
  isOpen,
  onClose,
  onActivate,
  onCloseAll,
}: SourcesPanelProps) {
  const activeTab = tabs.find((t) => t.key === activeKey) ?? null;

  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.aside
          key="sources-panel"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: PANEL_WIDTH, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
          className="shrink-0 overflow-hidden flex flex-col min-h-0"
        >
          <div
            className="flex flex-col h-full rounded-2xl bg-elevated overflow-hidden"
            style={{ width: PANEL_WIDTH }}
          >
            {/* Tab bar */}
            <div className="flex items-end gap-1 px-2 pt-2 bg-panel border-b border-sandy/60 overflow-x-auto">
              {tabs.map((t) => (
                <TabChip
                  key={t.key}
                  tab={t}
                  active={t.key === activeKey}
                  onActivate={() => onActivate(t.key)}
                  onClose={() => onClose(t.key)}
                />
              ))}
              <button
                type="button"
                onClick={onCloseAll}
                title="Tümünü kapat"
                className="ml-auto mb-1 self-end h-7 w-7 rounded-sm text-ink-muted hover:text-ink hover:bg-elevated flex items-center justify-center transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Active tab body */}
            <div className="flex-1 min-h-0">
              {activeTab && (
                <PdfReaderPanel
                  key={activeTab.key}
                  entryId={activeTab.entryId}
                  title={activeTab.title}
                  targetPage={activeTab.page ?? null}
                />
              )}
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

interface TabChipProps {
  tab: SourceTab;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
}

function TabChip({ tab, active, onActivate, onClose }: TabChipProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        }
      }}
      className={cn(
        "group flex items-center gap-1.5 pl-2.5 pr-1 py-1.5 rounded-t-md max-w-[200px] cursor-pointer transition-colors whitespace-nowrap",
        active
          ? "bg-elevated text-ink shadow-[0_-1px_0_0_var(--color-sandy)]"
          : "bg-panel text-ink-light hover:text-ink",
      )}
    >
      <span className="font-display text-[12px] truncate">
        {tab.authorSurname ?? tab.title}
      </span>
      {tab.page !== null && (
        <span className="font-ui text-[10px] text-ink-muted shrink-0">
          s.{tab.page}
        </span>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="h-5 w-5 rounded-sm hover:bg-sandy/60 flex items-center justify-center shrink-0"
        title="Sekmeyi kapat"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
