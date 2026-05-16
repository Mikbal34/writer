"use client";

/**
 * Small destructive action used in two places:
 *
 *   - Home page book cards (variant="icon")  — floating kebab in the
 *     upper corner of the cover; revealed on hover. Doesn't navigate.
 *   - Project dashboard header (variant="button") — explicit "Sil"
 *     button next to the project title.
 *
 * On confirm: DELETE /api/projects/[id] (cascades Chapters/Sections/
 * Subsections via Prisma onDelete: Cascade — see prisma/schema.prisma).
 * After success, navigates back to `/` and refreshes so the deleted
 * project drops out of the listing immediately.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreVertical, Trash2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

interface DeleteProjectButtonProps {
  projectId: string;
  projectTitle: string;
  /** "icon" floats a small kebab in the corner of a card; "button"
   *  renders a textual "Sil" button suited for a page header. */
  variant?: "icon" | "button";
  /** When the trigger sits inside a Link (e.g. on a book card), the
   *  click + keyboard events must not bubble to the wrapping anchor.
   *  Defaults to true. */
  stopPropagation?: boolean;
  /** Where to send the user after a successful delete. Default: "/". */
  redirectTo?: string;
}

export default function DeleteProjectButton({
  projectId,
  projectTitle,
  variant = "icon",
  stopPropagation = true,
  redirectTo = "/",
}: DeleteProjectButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  function swallow(e: React.MouseEvent | React.KeyboardEvent) {
    if (!stopPropagation) return;
    e.stopPropagation();
    e.preventDefault();
  }

  async function handleDelete() {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Proje silinemedi.");
      }
      toast.success(`"${projectTitle}" silindi.`);
      setOpen(false);
      router.push(redirectTo);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Silinemedi.");
    } finally {
      setBusy(false);
    }
  }

  // --- icon (kebab) variant ---
  if (variant === "icon") {
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger
            onClick={swallow}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") swallow(e);
            }}
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity flex items-center justify-center h-7 w-7 rounded-sm bg-black/30 hover:bg-black/50 backdrop-blur-sm text-white"
            aria-label="Proje seçenekleri"
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onClick={swallow}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") swallow(e);
            }}
          >
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setOpen(true);
              }}
              className="text-red-600 focus:text-red-600 focus:bg-red-50 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              Projeyi sil
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DeleteConfirm
          open={open}
          onOpenChange={setOpen}
          projectTitle={projectTitle}
          busy={busy}
          onConfirm={handleDelete}
        />
      </>
    );
  }

  // --- button (header) variant ---
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          swallow(e);
          setOpen(true);
        }}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm border border-red-200 text-red-700 font-ui text-xs hover:bg-red-50 transition-colors"
      >
        <Trash2 className="h-3 w-3" />
        Projeyi sil
      </button>
      <DeleteConfirm
        open={open}
        onOpenChange={setOpen}
        projectTitle={projectTitle}
        busy={busy}
        onConfirm={handleDelete}
      />
    </>
  );
}

function DeleteConfirm({
  open,
  onOpenChange,
  projectTitle,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectTitle: string;
  busy: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Projeyi sil?</DialogTitle>
          <DialogDescription>
            <span className="font-semibold text-foreground">
              {projectTitle}
            </span>{" "}
            ve içindeki tüm bölümler, taslaklar, kaynak eşleştirmeleri ve
            atıflar kalıcı olarak silinecek. Bu işlem geri alınamaz.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="px-3 py-1.5 rounded-sm border border-sandy text-ink-light font-ui text-xs hover:bg-page transition-colors disabled:opacity-40"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="px-3 py-1.5 rounded-sm bg-red-600 text-white font-ui text-xs hover:bg-red-700 transition-colors disabled:opacity-60 flex items-center gap-2"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {busy ? "Siliniyor…" : "Evet, sil"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
