/**
 * Streaming parser for the `<roadmap_commands>[ {…}, {…}, … ]</roadmap_commands>`
 * block that the roadmap-chat LLM emits.
 *
 * Why: the LLM writes that block as one very long output (often 8-10 kB),
 * and the chat handler used to wait until the closing tag arrived before
 * parsing + applying anything. From the user's seat the whole "Drafting
 * the structure…" phase looks like a frozen 2-minute loader.
 *
 * What this does: as each delta arrives, the parser walks the bytes it
 * has accumulated since the last fully-emitted object, tracks JSON
 * brace depth + string state, and yields one fully-parsed object every
 * time the top-level `{…}` closes back at depth 1.
 *
 * No third-party deps and no error recovery: if the LLM emits garbage
 * the consumer just won't see complete commands; the regex fall-through
 * in the chat route still runs as a backstop.
 */

export type CommandPayload = Record<string, unknown>;

export interface StreamingCommandsParser {
  /** Feed a chunk. Returns whichever top-level commands closed during it. */
  feed(chunk: string): CommandPayload[];
  /** True once the closing `</roadmap_commands>` tag has been seen. */
  isClosed(): boolean;
  /** All raw command bytes between the open + close tags (for debug). */
  rawBlock(): string;
}

const OPEN_TAG = "<roadmap_commands>";
const CLOSE_TAG = "</roadmap_commands>";

export function createCommandsStreamParser(): StreamingCommandsParser {
  // Phase machine:
  //   "before" — pre-tag bytes; we ignore them but keep a sliding tail
  //              long enough to catch the tag if it straddles chunks.
  //   "inside" — we've seen <roadmap_commands>; walking JSON.
  //   "after"  — close tag observed; subsequent bytes ignored.
  let phase: "before" | "inside" | "after" = "before";
  let preBuffer = "";

  // Bytes inside the tag that we still might emit. Cleared once a
  // complete top-level object is dispatched.
  let pending = "";

  // Position we've already brace-scanned in `pending`. Persisted across
  // feed() calls so we don't rescan the same chars after each chunk.
  let scanIdx = 0;

  // Brace / string tracking carried across feed() calls. Reset implicitly
  // whenever a complete object closes (depth returns to 0).
  let depth = 0;
  let inString = false;
  let escape = false;
  let currentStart = -1;

  // For debug / fallback.
  let rawBlock = "";

  function emitObject(text: string, out: CommandPayload[]) {
    try {
      out.push(JSON.parse(text) as CommandPayload);
    } catch {
      // Drop malformed objects silently — the post-stream backstop
      // will reparse the whole block.
    }
  }

  function feed(chunk: string): CommandPayload[] {
    if (phase === "after") return [];

    // 1. Append to the correct buffer based on phase.
    if (phase === "before") {
      preBuffer += chunk;
      const openIdx = preBuffer.indexOf(OPEN_TAG);
      if (openIdx === -1) {
        // Keep at most TAG_LEN-1 chars so we still catch a tag split
        // across two chunks.
        if (preBuffer.length > OPEN_TAG.length) {
          preBuffer = preBuffer.slice(preBuffer.length - OPEN_TAG.length);
        }
        return [];
      }
      pending = preBuffer.slice(openIdx + OPEN_TAG.length);
      preBuffer = "";
      phase = "inside";
      scanIdx = 0;
    } else {
      // already inside
      pending += chunk;
    }

    // 2. If the close tag now sits inside `pending`, walk only up to it
    //    and switch to "after" once we've scanned through everything
    //    before it.
    const closeIdx = pending.indexOf(CLOSE_TAG);
    const scanLimit = closeIdx === -1 ? pending.length : closeIdx;

    // 3. Walk the bytes we haven't seen yet, looking for top-level
    //    objects.
    const out: CommandPayload[] = [];
    let i = scanIdx;
    while (i < scanLimit) {
      const ch = pending.charCodeAt(i);
      if (escape) {
        escape = false;
        i++;
        continue;
      }
      if (ch === 92 /* \ */) {
        if (inString) escape = true;
        i++;
        continue;
      }
      if (ch === 34 /* " */) {
        inString = !inString;
        i++;
        continue;
      }
      if (inString) {
        i++;
        continue;
      }
      if (ch === 123 /* { */) {
        if (depth === 0) currentStart = i;
        depth++;
        i++;
        continue;
      }
      if (ch === 125 /* } */) {
        depth--;
        if (depth === 0 && currentStart !== -1) {
          const objStr = pending.slice(currentStart, i + 1);
          emitObject(objStr, out);
          rawBlock += objStr;
          // Drop everything up to and including this object; restart
          // the walk on the freshly-trimmed buffer.
          pending = pending.slice(i + 1);
          currentStart = -1;
          scanIdx = 0;
          // Re-evaluate the close tag against the trimmed buffer.
          const reCloseIdx = pending.indexOf(CLOSE_TAG);
          if (reCloseIdx !== -1) {
            rawBlock += pending.slice(0, reCloseIdx);
            pending = "";
            phase = "after";
            return out;
          }
          // Continue scanning from the start of the trimmed buffer.
          i = 0;
          continue;
        }
        i++;
        continue;
      }
      i++;
    }

    // We didn't find a complete object in this pass; remember where we
    // stopped so the next chunk doesn't re-scan these bytes.
    scanIdx = closeIdx === -1 ? pending.length : closeIdx;

    if (closeIdx !== -1) {
      rawBlock += pending.slice(0, closeIdx);
      pending = "";
      phase = "after";
    }

    return out;
  }

  return {
    feed,
    isClosed: () => phase === "after",
    rawBlock: () => rawBlock,
  };
}
