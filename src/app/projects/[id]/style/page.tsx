"use client";

/**
 * /projects/[id]/style — post-roadmap edit page for project-scoped
 * style overrides set during the new-project wizard's Step 4. Reuses
 * ProjectStyleSetup (smart defaults card + AI chat + manual form) and
 * adds a save bar that PATCHes Project.writingGuidelines.styleOverrides.
 *
 * Theme matches the other project pages (/sources, /citations) —
 * PageTitle header, forest CTAs, parchment background.
 */

import { use, useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import ProjectStyleSetup from "@/components/onboarding/ProjectStyleSetup";
import { PageTitle } from "@/components/shared/BookElements";
import { FadeUp } from "@/components/shared/Animations";
import type { ProjectStyleOverrides } from "@/types/project";

interface ProjectStylePageProps {
  params: Promise<{ id: string }>;
}

interface ProjectStyleData {
  id: string;
  projectType: "ACADEMIC" | "CREATIVE";
  language: string;
  audience: string | null;
  topic: string | null;
  citationFormat: string | null;
  styleOverrides: Partial<ProjectStyleOverrides> | null;
}

export default function ProjectStylePage({ params }: ProjectStylePageProps) {
  const { id } = use(params);
  const [project, setProject] = useState<ProjectStyleData | null>(null);
  const [overrides, setOverrides] = useState<Partial<ProjectStyleOverrides> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/projects/${id}`);
        if (!res.ok) throw new Error("Proje yüklenemedi.");
        const data = await res.json();
        if (cancelled) return;
        const guidelines =
          data?.writingGuidelines && typeof data.writingGuidelines === "object"
            ? (data.writingGuidelines as Record<string, unknown>)
            : null;
        const ov =
          guidelines && typeof guidelines.styleOverrides === "object"
            ? (guidelines.styleOverrides as Partial<ProjectStyleOverrides>)
            : null;
        setProject({
          id: data.id,
          projectType: data.projectType,
          language: data.language ?? "tr",
          audience: data.audience ?? null,
          topic: data.topic ?? null,
          citationFormat: data.citationFormat ?? null,
          styleOverrides: ov,
        });
        setOverrides(ov);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Yüklenemedi.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleSave() {
    if (!project) return;
    setSaving(true);
    try {
      // Preserve other namespaces inside writingGuidelines (e.g. the
      // creative pipeline's `artStyle`) by merging instead of overwriting.
      const currentRes = await fetch(`/api/projects/${id}`);
      const current = await currentRes.json();
      const existing =
        current?.writingGuidelines && typeof current.writingGuidelines === "object"
          ? (current.writingGuidelines as Record<string, unknown>)
          : {};
      const merged = { ...existing, styleOverrides: overrides ?? {} };

      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ writingGuidelines: merged }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Kaydedilemedi.");
      }
      toast.success("Proje stili güncellendi.");
      setDirty(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !project) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8 flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-5 w-5 animate-spin text-[#C9A84C]" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 overflow-y-auto flex-1 min-h-0">
      <FadeUp className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <PageTitle
          title="Proje Stili"
          subtitle="Bu projeye özel yazım kuralları. Yazma sırasında Writing Twin'in ilgili alanlarını override eder."
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="flex items-center gap-2 px-3 py-1.5 bg-forest text-[#F5EDE0] rounded-sm font-ui text-xs hover:bg-forest/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {saving ? "Kaydediliyor..." : "Kaydet"}
        </button>
      </FadeUp>

      <ProjectStyleSetup
        basics={{
          projectType: project.projectType,
          language: project.language,
          audience: project.audience,
          topic: project.topic,
          citationFormat: project.citationFormat,
        }}
        value={overrides}
        onChange={(v) => {
          setOverrides(v);
          setDirty(true);
        }}
      />
    </div>
  );
}
