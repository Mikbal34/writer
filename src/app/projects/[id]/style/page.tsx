"use client";

/**
 * /projects/[id]/style — post-roadmap edit page for the project-scoped
 * style overrides (set initially during the new-project wizard's
 * Step 4). Reuses the same ProjectStyleSetup component so the AI chat,
 * smart defaults, and manual form are all available; adds a save bar
 * that PATCHes Project.writingGuidelines.styleOverrides.
 */

import { use, useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import ProjectStyleSetup from "@/components/onboarding/ProjectStyleSetup";
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
        // The PATCH endpoint returns the project, but the GET returns
        // a similar shape — `writingGuidelines` is a JSON column we
        // need to dig into for styleOverrides.
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
      // Patch preserves the rest of writingGuidelines — fetch current
      // value first so we don't clobber any non-style namespaces (e.g.
      // creative artStyle written by the preview chat).
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
      <div className="min-h-[40vh] flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Proje Stili</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Bu projeye özel yazım kuralları. Yazma sırasında Writing Twin&apos;in
          ilgili alanlarını override eder.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Düzenle</CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2 sticky bottom-4 bg-background/80 backdrop-blur rounded-md p-2">
        <Button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saving ? "Kaydediliyor..." : "Kaydet"}
        </Button>
      </div>
    </div>
  );
}
