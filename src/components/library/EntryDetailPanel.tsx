"use client";

/**
 * Right-pane detail view for a single library entry.
 *
 * - Top: bibliographic header (author / title / year), Edit button,
 *   "Bu kitaba sor" deep-link to /library/chat with scope=single
 * - Tabs: Notlar | (Highlights — Phase 3) | PDF
 * - Notlar is fully wired; Highlights and PDF render placeholders until
 *   Phase 3 brings them online.
 */

import { useEffect, useState } from "react";
import {
  Pencil,
  MessageSquare,
  FileText,
  Highlighter,
  X,
  ExternalLink,
  BookOpen,
} from "lucide-react";
import Link from "next/link";
import NotesTab from "./NotesTab";
import type { LibraryEntryRow } from "./LibraryEntryTable";

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
  const hasVolumes = (entry._count?.volumes ?? 0) > 0;

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

  return (
    <aside className="h-full w-[420px] shrink-0 border-l border-[#d4c9b5] bg-[#FAF7F0]/40 flex flex-col">
      {/* Header */}
      <header className="px-4 pt-4 pb-3 border-b border-[#d4c9b5]/60">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-1 font-ui text-[10px] uppercase tracking-widest text-[#8a7a65]">
            <FileText className="h-3 w-3" />
            Kaynak
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#8a7a65] hover:text-[#2D1F0E]"
            aria-label="Paneli kapat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <h2
          dir="auto"
          className="font-display text-base font-semibold text-[#2D1F0E] leading-snug"
        >
          {entry.title}
        </h2>
        <p
          dir="auto"
          className="font-body text-xs text-[#5C4A32] mt-1 truncate"
        >
          {entry.authorSurname}
          {entry.authorName ? `, ${entry.authorName}` : ""}
          {entry.year ? ` · ${entry.year}` : ""}
        </p>

        {/* Quick actions */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={onEdit}
            className="flex items-center gap-1.5 px-2 py-1 rounded-sm border border-[#d4c9b5] bg-white/70 font-ui text-[11px] text-[#5C4A32] hover:bg-white transition-colors"
          >
            <Pencil className="h-3 w-3" />
            Künyeyi düzenle
          </button>
          <Link
            href={`/library/chat?entryId=${entry.id}`}
            className="flex items-center gap-1.5 px-2 py-1 rounded-sm bg-forest text-[#F5EDE0] font-ui text-[11px] hover:bg-forest/90 transition-colors"
          >
            <MessageSquare className="h-3 w-3" />
            Bu kitaba sor
          </Link>
          {entry.filePath && entry.fileType === "pdf" && (
            <a
              href={`/api/library/${entry.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-2 py-1 rounded-sm border border-[#d4c9b5] bg-white/70 font-ui text-[11px] text-[#5C4A32] hover:bg-white transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              PDF
            </a>
          )}
        </div>
      </header>

      {/* Tabs */}
      <div className="px-2 pt-2 flex items-center gap-1 border-b border-[#d4c9b5]/60">
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
          <div className="px-4 py-8 text-center font-body text-sm text-[#8a7a65]">
            Highlight desteği bir sonraki sürümde geliyor.
          </div>
        )}
        {tab === "pdf" && (
          <div className="px-4 py-8 text-center font-body text-sm text-[#8a7a65]">
            {entry.filePath && entry.fileType === "pdf" ? (
              <>
                PDF'i şimdilik yeni sekmede aç:{" "}
                <a
                  href={`/api/library/${entry.id}/pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#2D1F0E] underline"
                >
                  /api/library/{entry.id}/pdf
                </a>
                . Highlight'lı viewer Faz 3'te.
              </>
            ) : (
              <>Bu kaynak için yüklü bir PDF yok.</>
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
          ? "bg-white text-[#2D1F0E] border border-[#d4c9b5] border-b-transparent -mb-px"
          : "text-[#5C4A32] hover:bg-[#FAF7F0]"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
