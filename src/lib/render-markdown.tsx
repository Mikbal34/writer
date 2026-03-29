"use client";

import React from "react";

/**
 * Renders simple inline markdown (bold + italic) to React elements.
 * Handles: **bold**, *italic*, ***bold italic***
 * Does NOT handle: headings, links, lists, etc.
 */
export function renderInlineMarkdown(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let key = 0;

  // Process ***bold italic*** first, then **bold**, then *italic*
  const regex = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Add plain text before this match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[2]) {
      // ***bold italic***
      parts.push(
        <strong key={key++}>
          <em>{match[2]}</em>
        </strong>
      );
    } else if (match[3]) {
      // **bold**
      parts.push(<strong key={key++}>{match[3]}</strong>);
    } else if (match[4]) {
      // *italic*
      parts.push(<em key={key++}>{match[4]}</em>);
    }

    lastIndex = match.index + match[0].length;
  }

  // Add any remaining plain text after the last match
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length === 0 ? text : <>{parts}</>;
}
