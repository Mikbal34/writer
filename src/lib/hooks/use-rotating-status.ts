import { useEffect, useState } from "react";

/**
 * useRotatingStatus — cycle through alternate phrasings of a long-
 * running status indicator so the user doesn't see the same line
 * frozen on screen.
 *
 * Pass a stable "key" identifying the current stage (e.g.
 * `thinking:get_library_entries`). Whenever the key changes the
 * rotation restarts at index 0. While the key stays the same, the
 * displayed string advances through `variants` on the configured
 * interval (default 2.5 s) and clamps to the last entry.
 */
export function useRotatingStatus(
  stageKey: string | null,
  variants: string[],
  intervalMs: number = 2500,
): string | null {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    if (stageKey === null || variants.length <= 1) return;
    const id = window.setInterval(() => {
      setIndex((i) => Math.min(i + 1, variants.length - 1));
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [stageKey, variants.length, intervalMs]);

  if (stageKey === null || variants.length === 0) return null;
  return variants[Math.min(index, variants.length - 1)];
}
