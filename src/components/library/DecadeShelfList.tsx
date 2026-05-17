"use client";

/**
 * Groups library entries by publication decade and renders each group
 * as a labelled `<section>` (e.g. `1990'lar — 5 kaynak`). Inside each
 * section we delegate row rendering to LibraryEntryTable's list mode by
 * passing a filtered slice of entries.
 *
 * Decade extraction is tolerant: `entry.year` is a free-text string
 * (Berat's classical works often hold hijri years like "310 hijri").
 * We grab the first 4-digit substring; if there's none, the entry
 * lands in the "Yıl belirsiz" bucket.
 *
 * Sections sort newest decade first. Empty decades aren't rendered so
 * an active search/filter doesn't leave hollow headers behind.
 */

import { useMemo } from "react";
import LibraryEntryTable, {
  type LibraryEntryRow,
} from "./LibraryEntryTable";

interface DecadeShelfListProps {
  entries: LibraryEntryRow[];
  onSelect?: (entry: LibraryEntryRow) => void;
  onEdit: (entry: LibraryEntryRow) => void;
  onDelete: (id: string) => void;
  onPdfAttached?: (entryId: string) => void;
}

/** Pull a 4-digit year from a free-text `year` field. */
function extractYear(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/(1[5-9]\d{2}|20\d{2}|21\d{2})/);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) ? n : null;
}

function decadeBucket(year: number | null): string {
  if (year === null) return "Yıl belirsiz";
  const start = Math.floor(year / 10) * 10;
  return `${start}'lar`;
}

interface Bucket {
  label: string;
  /** Bigger sortKey = more recent decade. "Yıl belirsiz" sinks to -Infinity. */
  sortKey: number;
  entries: LibraryEntryRow[];
}

export default function DecadeShelfList({
  entries,
  onSelect,
  onEdit,
  onDelete,
  onPdfAttached,
}: DecadeShelfListProps) {
  const buckets = useMemo<Bucket[]>(() => {
    const map = new Map<string, Bucket>();
    for (const e of entries) {
      const year = extractYear(e.year);
      const label = decadeBucket(year);
      const sortKey = year === null ? Number.NEGATIVE_INFINITY : Math.floor(year / 10) * 10;
      const existing = map.get(label);
      if (existing) {
        existing.entries.push(e);
      } else {
        map.set(label, { label, sortKey, entries: [e] });
      }
    }
    return [...map.values()].sort((a, b) => b.sortKey - a.sortKey);
  }, [entries]);

  if (buckets.length === 0) {
    return (
      <div className="px-6 py-12 text-center">
        <p className="font-body text-sm text-ink-light">
          Eşleşen kaynak bulunamadı.
        </p>
      </div>
    );
  }

  return (
    <div>
      {buckets.map((bucket) => (
        <section key={bucket.label} className="mt-7 first:mt-0">
          <header className="flex items-baseline gap-3 mb-3 pb-2 border-b-[1.5px] border-sandy">
            <h3 className="font-display italic font-medium text-[22px] leading-none text-forest-deep">
              {bucket.label}
            </h3>
            <span className="font-ui text-xs text-ink-muted">
              {bucket.entries.length} kaynak
            </span>
          </header>
          <LibraryEntryTable
            entries={bucket.entries}
            onSelect={onSelect}
            onEdit={onEdit}
            onDelete={onDelete}
            onPdfAttached={onPdfAttached}
            viewMode="list"
          />
        </section>
      ))}
    </div>
  );
}
