import { useEffect, useRef, useState } from "react";

/**
 * useTypewriter — render an incoming text stream one character at a
 * time, regardless of how chunky the upstream stream is.
 *
 * Backend streams from the Anthropic API arrive in 3–10 character
 * bursts; pushing those straight into a markdown renderer makes the
 * chat feel jumpy. This hook keeps a small queue: each tick (default
 * 22 ms) it reveals one more character, so the displayed string
 * chases the target string at a steady "ChatGPT-style" cadence.
 *
 * When the stream finishes (`isStreaming` flips false) the queue is
 * drained immediately — we don't want the user staring at a half-
 * rendered final reply while there's nothing more arriving.
 */
export function useTypewriter(
  targetText: string,
  isStreaming: boolean,
  charDelayMs: number = 22,
): string {
  const [displayed, setDisplayed] = useState("");
  const intervalRef = useRef<number | null>(null);
  const targetRef = useRef(targetText);
  targetRef.current = targetText;

  useEffect(() => {
    // Reset path: brand new conversation (target shrank or empty) →
    // start fresh.
    if (targetText.length < displayed.length) {
      setDisplayed("");
      return;
    }

    // Stream is over → catch up to the full text immediately.
    if (!isStreaming) {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (displayed !== targetText) setDisplayed(targetText);
      return;
    }

    // Streaming and we're behind → start (or keep) the typewriter
    // interval going at one character per tick.
    if (displayed.length < targetText.length && intervalRef.current === null) {
      intervalRef.current = window.setInterval(() => {
        setDisplayed((cur) => {
          const target = targetRef.current;
          if (cur.length >= target.length) {
            if (intervalRef.current !== null) {
              window.clearInterval(intervalRef.current);
              intervalRef.current = null;
            }
            return cur;
          }
          return target.slice(0, cur.length + 1);
        });
      }, charDelayMs);
    }

    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [targetText, isStreaming, charDelayMs, displayed]);

  return displayed;
}
