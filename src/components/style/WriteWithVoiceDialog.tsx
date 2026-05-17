"use client";

/**
 * "Bu sesle yaz" picker. Lists the user's projects; clicking one
 * PATCHes the project with `styleProfileId: this profile's id` so the
 * write flow inherits the chosen voice. Then redirects the user to
 * that project so they can start drafting immediately.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, ChevronRight, Feather, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ProjectRow {
  id: string;
  title: string;
  status: string;
  styleProfileId?: string | null;
  _count?: { chapters?: number };
}

interface WriteWithVoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profileId: string;
  profileName: string;
}

export default function WriteWithVoiceDialog({
  open,
  onOpenChange,
  profileId,
  profileName,
}: WriteWithVoiceDialogProps) {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || projects.length > 0) return;
    setLoadingProjects(true);
    fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : { projects: [] }))
      .then((data) => {
        const list: ProjectRow[] = data.projects ?? data ?? [];
        setProjects(list);
      })
      .catch(() => toast.error("Projeler yüklenemedi"))
      .finally(() => setLoadingProjects(false));
  }, [open, projects.length]);

  async function pick(projectId: string) {
    setBusyId(projectId);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ styleProfileId: profileId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Bağlanamadı");
        return;
      }
      toast.success(`${profileName} ses ikizi projeye bağlandı.`);
      onOpenChange(false);
      router.push(`/projects/${projectId}`);
    } catch {
      toast.error("Bağlantı hatası");
    } finally {
      setBusyId(null);
    }
  }

  const activeProjects = projects.filter((p) => p.status !== "completed");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-display text-ink flex items-center gap-2">
            <Feather className="h-4 w-4 text-gold" />
            Bu sesle yaz
          </DialogTitle>
        </DialogHeader>

        <p className="font-body text-xs text-ink-light mb-2">
          <span className="font-semibold text-ink">{profileName}</span>{" "}
          ses ikizini hangi projeye bağlayalım? Yazma akışı bundan sonra bu
          üslubu varsayılan olarak kullanır.
        </p>

        <div className="flex-1 overflow-y-auto -mx-6 px-6 py-2">
          {loadingProjects ? (
            <div className="flex items-center justify-center gap-2 py-8 text-ink-light">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="font-body text-sm">Projeler yükleniyor…</span>
            </div>
          ) : activeProjects.length === 0 ? (
            <p className="text-center font-body italic text-sm text-ink-muted py-8">
              Henüz aktif projen yok. Önce bir proje oluştur.
            </p>
          ) : (
            <ul className="space-y-1">
              {activeProjects.map((p) => {
                const linked = p.styleProfileId === profileId;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => pick(p.id)}
                      disabled={busyId !== null}
                      className="w-full text-left flex items-center gap-2.5 px-2.5 py-2 rounded-md border border-sandy/60 bg-page hover:bg-panel transition-colors disabled:opacity-50"
                    >
                      <BookOpen className="h-3.5 w-3.5 text-forest shrink-0" />
                      <span className="font-display font-semibold text-[13px] text-ink truncate flex-1">
                        {p.title}
                      </span>
                      {linked && (
                        <span className="font-ui text-[9px] uppercase tracking-[0.06em] text-gold-dark px-1.5 py-0.5 bg-gold/15 rounded-sm">
                          aktif ses
                        </span>
                      )}
                      <span className="font-ui text-[10.5px] text-ink-muted">
                        {p._count?.chapters ?? 0} bölüm
                      </span>
                      {busyId === p.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-ink-muted shrink-0" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="pt-3 border-t border-sandy/60 font-body text-[11px] text-ink-muted">
          Seçili projede yazım akışını başlat; varolan metinler etkilenmez.
        </div>
      </DialogContent>
    </Dialog>
  );
}
