"use client";

import { useCallback, useState } from "react";
import type { ChatSource } from "./MessageBubble";

export interface SourceTab {
  /** Stable identifier: entryId + volumeId + page. Citations from two
   *  different volumes of the same multi-volume entry open as separate
   *  tabs instead of collapsing onto one. */
  key: string;
  entryId: string;
  volumeId: string | null;
  page: number | null;
  /** Printed book page (preferred for chip display). */
  pageLabel: string | null;
  title: string;
  authorSurname: string | null;
}

function tabKey(src: ChatSource): string {
  return `${src.entryId}#${src.volumeId ?? ""}#${src.page ?? 0}`;
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
              volumeId: src.volumeId ?? null,
              page: src.page,
              pageLabel: src.pageLabel ?? null,
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
