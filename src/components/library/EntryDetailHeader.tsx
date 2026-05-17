"use client";

/**
 * Backwards-compatible shim. The actual implementation lives in
 * `BookHero` so the same component can render in both the right detail
 * panel (full variant) and the per-book split view's chat hero card
 * (compact variant).
 */

import BookHero from "./BookHero";
import type { LibraryEntryRow } from "./LibraryEntryTable";

interface EntryDetailHeaderProps {
  entry: LibraryEntryRow;
  onEdit: () => void;
  onJumpToPage: (page: number) => void;
  onDeleted?: () => void;
}

export default function EntryDetailHeader(props: EntryDetailHeaderProps) {
  return <BookHero {...props} variant="full" />;
}
