"use client";

/**
 * Banner that surfaces Haiku's multi-volume hint on entries the user
 * just uploaded. One stacked card per unresolved hint with two
 * actions: open the promote dialog, or dismiss the hint so the banner
 * disappears for that entry.
 */
import { useState } from "react";
import { BookCopy, X } from "lucide-react";
import { toast } from "sonner";
import PromoteVolumeDialog from "@/components/library/PromoteVolumeDialog";
import type { LibraryEntryRow } from "@/components/library/LibraryEntryTable";

interface VolumeHintBannerProps {
  entries: LibraryEntryRow[];
  onChanged: () => void;
}

export default function VolumeHintBanner({
  entries,
  onChanged,
}: VolumeHintBannerProps) {
  // The dialog state needs to know which entry the user clicked on.
  // Closing it just unmounts; we don't keep an open/closed boolean
  // separately.
  const [promoteEntry, setPromoteEntry] = useState<LibraryEntryRow | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  const hints = entries.filter((e) => {
    const hint = e.metadata?.volumeHint;
    if (!hint?.parentWork || !hint?.volumeNumber) return false;
    if (e.metadata?.volumeHintDismissed) return false;
    // Self-loop guard: Sonnet sometimes tags an entry whose title IS
    // the series name (e.g. VanEss "Theologie und Gesellschaft" with
    // its Abschlußband cilt) with a hint pointing back at itself.
    // Suppress these — "make X a volume of X" is never useful.
    const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ");
    if (norm(hint.parentWork) === norm(e.title)) return false;
    // Entries that already have their own volumes are clearly the
    // PARENT of a group, not a stray child — never suggest demoting.
    if ((e._count?.volumes ?? 0) > 0) return false;
    return true;
  });

  async function dismiss(entryId: string) {
    setDismissingId(entryId);
    try {
      const res = await fetch(`/api/library/${entryId}/dismiss-volume-hint`, {
        method: "POST",
      });
      if (!res.ok) throw new Error();
      onChanged();
    } catch {
      toast.error("Atılamadı, sonra tekrar dene");
    } finally {
      setDismissingId(null);
    }
  }

  if (hints.length === 0) return null;

  return (
    <>
      <div className="space-y-2 mb-5">
        {hints.map((entry) => {
          const hint = entry.metadata!.volumeHint!;
          return (
            <div
              key={entry.id}
              className="flex items-start gap-3 p-3 rounded-sm border border-gold/40 bg-gold/8"
            >
              <div className="shrink-0 mt-0.5">
                <BookCopy className="h-4 w-4 text-gold-dark" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-body text-sm text-ink">
                  <span className="font-semibold">{entry.title}</span> —{" "}
                  &ldquo;{hint.parentWork}&rdquo; eserinin{" "}
                  <span className="font-semibold">Cilt {hint.volumeNumber}</span>{" "}
                  olarak görünüyor.
                </div>
                <div className="font-ui text-[11px] text-ink-light mt-0.5">
                  Multi-volume yapıya dönüştürmek istersen ya da bağımsız bırak.
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setPromoteEntry(entry)}
                  className="font-ui text-xs font-semibold px-3 py-1.5 rounded-sm bg-gold text-ink hover:bg-gold-hover"
                >
                  Cilt olarak ekle
                </button>
                <button
                  type="button"
                  onClick={() => dismiss(entry.id)}
                  disabled={dismissingId === entry.id}
                  title="Önerme, bağımsız bırak"
                  className="flex items-center justify-center h-7 w-7 rounded-sm hover:bg-gold/15 text-ink-light disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {promoteEntry && (
        <PromoteVolumeDialog
          open={!!promoteEntry}
          onOpenChange={(o) => !o && setPromoteEntry(null)}
          entryId={promoteEntry.id}
          parentWork={promoteEntry.metadata!.volumeHint!.parentWork}
          volumeNumber={promoteEntry.metadata!.volumeHint!.volumeNumber}
          volumeLabel={promoteEntry.metadata!.volumeHint!.volumeLabel ?? null}
          onResolved={() => {
            setPromoteEntry(null);
            onChanged();
          }}
        />
      )}
    </>
  );
}
