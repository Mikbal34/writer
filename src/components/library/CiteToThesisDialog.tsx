"use client";

/**
 * "Tezime alıntıla" — picks a target project + subsection, then
 * appends the assistant message text to that subsection's draft via
 * the append endpoint. Two-step: project list → chapter/section tree
 * for the chosen project, so users with many projects don't suffer
 * a long initial fetch.
 */

import { useEffect, useMemo, useState } from "react";
import { Loader2, BookOpen, ChevronRight, Quote, X } from "lucide-react";
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
  _count?: { chapters?: number };
}

interface ProjectDetail {
  id: string;
  title: string;
  chapters: Array<{
    id: string;
    number: number;
    title: string;
    sections: Array<{
      id: string;
      sectionId: string;
      title: string;
      subsections: Array<{
        id: string;
        subsectionId: string;
        title: string;
        wordCount: number;
        status: string;
      }>;
    }>;
  }>;
}

interface CiteToThesisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Raw text from the assistant message — appended verbatim to the
   *  chosen subsection's content. */
  text: string;
  /** Used for the blockquote source tag the API stamps. */
  sessionLabel?: string | null;
}

export default function CiteToThesisDialog({
  open,
  onOpenChange,
  text,
  sessionLabel,
}: CiteToThesisDialogProps) {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busy, setBusy] = useState(false);

  // Reset on close so reopening starts fresh.
  useEffect(() => {
    if (!open) {
      setPickedProjectId(null);
      setDetail(null);
    }
  }, [open]);

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

  useEffect(() => {
    if (!pickedProjectId) return;
    setLoadingDetail(true);
    fetch(`/api/projects/${pickedProjectId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setDetail(data as ProjectDetail);
      })
      .catch(() => toast.error("Bölüm ağacı yüklenemedi"))
      .finally(() => setLoadingDetail(false));
  }, [pickedProjectId]);

  const filteredProjects = useMemo(() => {
    return projects.filter((p) => p.status !== "completed");
  }, [projects]);

  async function handleAppend(subsectionId: string) {
    if (!pickedProjectId) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/projects/${pickedProjectId}/subsections/${subsectionId}/append`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            source: sessionLabel
              ? `Kütüphane sohbeti · ${sessionLabel}`
              : "Kütüphane sohbeti",
          }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Eklenemedi");
        return;
      }
      const data = await res.json();
      toast.success(`${data.wordsAdded} kelime eklendi`);
      onOpenChange(false);
    } catch {
      toast.error("Bağlantı hatası");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-display text-ink flex items-center gap-2">
            <Quote className="h-4 w-4 text-gold" />
            Tezime alıntıla
          </DialogTitle>
        </DialogHeader>

        {!pickedProjectId ? (
          <div className="flex-1 overflow-y-auto -mx-6 px-6 py-2">
            <p className="font-body text-xs text-ink-light mb-3">
              Hangi projenin hangi alt bölümüne eklensin? Önce projeyi seç.
            </p>
            {loadingProjects ? (
              <div className="flex items-center justify-center gap-2 py-8 text-ink-light">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="font-body text-sm">Projeler yükleniyor…</span>
              </div>
            ) : filteredProjects.length === 0 ? (
              <p className="text-center font-body italic text-sm text-ink-muted py-8">
                Henüz aktif projen yok.
              </p>
            ) : (
              <ul className="space-y-1">
                {filteredProjects.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setPickedProjectId(p.id)}
                      className="w-full text-left flex items-center gap-2.5 px-2.5 py-2 rounded-md border border-sandy/60 bg-page hover:bg-panel transition-colors"
                    >
                      <BookOpen className="h-3.5 w-3.5 text-forest shrink-0" />
                      <span className="font-display font-semibold text-[13px] text-ink truncate flex-1">
                        {p.title}
                      </span>
                      <span className="font-ui text-[10.5px] text-ink-muted">
                        {p._count?.chapters ?? 0} bölüm
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 text-ink-muted shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto -mx-6 px-6 py-2">
            <button
              type="button"
              onClick={() => {
                setPickedProjectId(null);
                setDetail(null);
              }}
              className="font-ui text-[11px] text-ink-light hover:text-ink mb-2 inline-flex items-center gap-1"
            >
              <X className="h-3 w-3" />
              Başka proje seç
            </button>

            {loadingDetail || !detail ? (
              <div className="flex items-center justify-center gap-2 py-8 text-ink-light">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="font-body text-sm">
                  Bölüm ağacı yükleniyor…
                </span>
              </div>
            ) : detail.chapters.length === 0 ? (
              <p className="text-center font-body italic text-sm text-ink-muted py-8">
                Bu projenin henüz bölümü yok.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="font-display italic text-[14px] text-ink">
                  {detail.title}
                </div>
                {detail.chapters.map((c) => (
                  <div key={c.id}>
                    <div className="font-ui text-[10.5px] uppercase tracking-[0.14em] text-forest mb-1">
                      Bölüm {c.number} · {c.title}
                    </div>
                    <ul className="space-y-0.5 ml-1">
                      {c.sections.flatMap((s) =>
                        s.subsections.map((sub) => (
                          <li key={sub.id}>
                            <button
                              type="button"
                              onClick={() => handleAppend(sub.id)}
                              disabled={busy}
                              className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-panel transition-colors disabled:opacity-50"
                            >
                              <span className="font-mono text-[10.5px] text-ink-muted tabular-nums shrink-0">
                                {sub.subsectionId}
                              </span>
                              <span className="font-body text-[12.5px] text-ink truncate flex-1">
                                {sub.title}
                              </span>
                              <span className="font-ui text-[10px] text-ink-muted shrink-0">
                                {sub.wordCount.toLocaleString("tr-TR")} kelime
                              </span>
                              {busy ? (
                                <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                              ) : (
                                <ChevronRight className="h-3 w-3 text-ink-muted shrink-0" />
                              )}
                            </button>
                          </li>
                        )),
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="pt-3 border-t border-sandy/60 font-body text-[11px] text-ink-muted">
          Seçili alt-bölümün taslağına alıntı olarak eklenir; kelime sayısı
          güncellenir, mevcut metin silinmez.
        </div>
      </DialogContent>
    </Dialog>
  );
}
