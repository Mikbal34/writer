"use client";

import { useCallback, useState } from "react";
import type { ChatSource } from "./MessageBubble";

export interface SourceTab {
  /** Stable identifier: entryId + page. Same source clicked twice
   *  focuses the existing tab instead of opening a duplicate. */
  key: string;
  entryId: string;
  page: number | null;
  title: string;
  authorSurname: string | null;
}

function tabKey(src: ChatSource): string {
  return `${src.entryId}#${src.page ?? 0}`;
}

export function useSourceTabs() {
  const [tabs, setTabs] = useState<SourceTab[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const openSource = useCallback((src: ChatSource) => {
    const key = tabKey(src);
    setTabs((prev) =>
      prev.some((t) => t.key === key)
        ? prev
        : [
            ...prev,
            {
              key,
              entryId: src.entryId,
              page: src.page,
              title: src.title,
              authorSurname: src.authorSurname,
            },
          ],
    );
    setActiveKey(key);
  }, []);

  const closeTab = useCallback(
    (key: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.key === key);
        const next = prev.filter((t) => t.key !== key);
        if (activeKey === key) {
          const fallback = next[idx] ?? next[idx - 1] ?? null;
          setActiveKey(fallback?.key ?? null);
        }
        return next;
      });
    },
    [activeKey],
  );

  const activateTab = useCallback((key: string) => {
    setActiveKey(key);
  }, []);

  const closeAll = useCallback(() => {
    setTabs([]);
    setActiveKey(null);
  }, []);

  return {
    tabs,
    activeKey,
    isOpen: tabs.length > 0,
    openSource,
    closeTab,
    activateTab,
    closeAll,
  };
}

export type UseSourceTabsReturn = ReturnType<typeof useSourceTabs>;
