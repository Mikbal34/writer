"use client";

/**
 * Right-pane detail view for a single library entry.
 *
 * Hybrid of the V3 mockup + existing tab system:
 *   - Top: EntryDetailHeader (book-spine + meta + "Bu kitaba sor" gold
 *     button + stats strip + last-highlight previews)
 *   - Below: Notlar | Highlights | PDF tabs (unchanged from before)
 *
 * Width trimmed from 420 → 380 px so the entry-list pane has more
 * breathing room.
 */

import { useEffect, useState } from "react";
import {
  FileText,
  Highlighter,
  X,
  BookOpen,
} from "lucide-react";
import dynamic from "next/dynamic";
import NotesTab from "./NotesTab";
import HighlightsTab from "./HighlightsTab";
import EntryDetailHeader from "./EntryDetailHeader";
import type { LibraryEntryRow } from "./LibraryEntryTable";

// pdf.js worker + react-pdf are heavy; lazy-load so the rest of the
// library page stays light. Loaded only when the user opens the PDF
// tab on the right panel.
const PdfViewerWithHighlights = dynamic(
  () => import("./PdfViewerWithHighlights"),
  { ssr: false, loading: () => null },
);

interface EntryDetailPanelProps {
  entry: LibraryEntryRow;
  onEdit: () => void;
  onClose: () => void;
  onMutate?: () => void;
}

type Tab = "notes" | "highlights" | "pdf";

interface VolumeOption {
  id: string;
  volumeNumber: number;
  label: string | null;
}

export default function EntryDetailPanel({
  entry,
  onEdit,
  onClose,
  onMutate,
}: EntryDetailPanelProps) {
  const [tab, setTab] = useState<Tab>("notes");
  const [volumes, setVolumes] = useState<VolumeOption[]>([]);
  // Cross-tab signals: clicking a highlight in HighlightsTab flips us
  // to PDF and asks the viewer to jump to that page; saving a highlight
  // in the PDF tab bumps highlightRefreshKey so HighlightsTab refetches.
  const [pdfTargetPage, setPdfTargetPage] = useState<number | null>(null);
  const [highlightRefreshKey, setHighlightRefreshKey] = useState(0);
  const hasVolumes = (entry._count?.volumes ?? 0) > 0;
  // For multi-volume entries the user picks a cilt; default to the
  // first one. PDF viewer + highlight queries scope to that volumeId.
  const [activeVolumeId, setActiveVolumeId] = useState<string | null>(null);
  useEffect(() => {
    if (volumes.length > 0 && !activeVolumeId) {
      setActiveVolumeId(volumes[0].id);
    }
  }, [volumes, activeVolumeId]);

  // Load the entry's volumes only if it's multi-volume; otherwise the
  // notes tab hides its "Cilt" picker.
  useEffect(() => {
    if (!hasVolumes) {
      setVolumes([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/library/${entry.id}/volumes`)
      .then((r) => (r.ok ? r.json() : { volumes: [] }))
      .then((data) => {
        if (cancelled) return;
        setVolumes(
          (data.volumes as Array<{ id: string; volumeNumber: number; label: string | null }>).map(
            (v) => ({ id: v.id, volumeNumber: v.volumeNumber, label: v.label }),
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [entry.id, hasVolumes]);

  function jumpToPdfPage(page: number) {
    setPdfTargetPage(page);
    setTab("pdf");
  }

  return (
    <aside className="relative h-full w-[380px] shrink-0 border-l border-sandy bg-page/40 flex flex-col">
      {/* Close button — pinned upper-right so the V3 header below
          doesn't crowd it. */}
      <div className="absolute right-2 top-2 z-10">
        <button
          type="button"
          onClick={onClose}
          className="h-7 w-7 flex items-center justify-center rounded-sm text-ink-light hover:text-ink hover:bg-page"
          aria-label="Paneli kapat"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <EntryDetailHeader
        entry={entry}
        onEdit={onEdit}
        onJumpToPage={jumpToPdfPage}
      />

      {/* Tabs */}
      <div className="px-2 pt-2 flex items-center gap-1 border-b border-sandy/60">
        <TabButton
          active={tab === "notes"}
          onClick={() => setTab("notes")}
          icon={<FileText className="h-3 w-3" />}
          label="Notlar"
        />
        <TabButton
          active={tab === "highlights"}
          onClick={() => setTab("highlights")}
          icon={<Highlighter className="h-3 w-3" />}
          label="Highlights"
        />
        <TabButton
          active={tab === "pdf"}
          onClick={() => setTab("pdf")}
          icon={<BookOpen className="h-3 w-3" />}
          label="PDF"
        />
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === "notes" && (
          <NotesTab
            entryId={entry.id}
            volumes={volumes}
            onMutate={onMutate}
          />
        )}
        {tab === "highlights" && (
          <HighlightsTab
            entryId={entry.id}
            refreshKey={highlightRefreshKey}
            onJumpToPage={jumpToPdfPage}
          />
        )}
        {tab === "pdf" && (
          <div className="p-3">
            {(entry.filePath && entry.fileType === "pdf") || hasVolumes ? (
              <>
                {hasVolumes && volumes.length > 1 && (
                  <div className="mb-2 flex items-center gap-2">
                    <span className="font-ui text-[10px] uppercase tracking-widest text-ink-light">
                      Cilt
                    </span>
                    <select
                      value={activeVolumeId ?? ""}
                      onChange={(e) =>
                        setActiveVolumeId(e.target.value || null)
                      }
                      className="px-1.5 py-0.5 rounded-sm border border-sandy bg-white font-ui text-xs text-ink"
                    >
                      {volumes.map((v) => (
                        <option key={v.id} value={v.id}>
                          Cilt {v.volumeNumber}
                          {v.label ? ` — ${v.label}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <PdfViewerWithHighlights
                  entryId={entry.id}
                  volumeId={hasVolumes ? activeVolumeId : null}
                  targetPage={pdfTargetPage}
                  onHighlightsChanged={() =>
                    setHighlightRefreshKey((k) => k + 1)
                  }
                />
              </>
            ) : (
              <div className="py-8 text-center font-body text-sm text-ink-light">
                Bu kaynak için yüklü bir PDF yok.
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-t-sm font-ui text-xs transition-colors ${
        active
          ? "bg-white text-ink border border-sandy border-b-transparent -mb-px"
          : "text-ink-light hover:bg-page"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
