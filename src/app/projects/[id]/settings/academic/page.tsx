"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Loader2, Save, GraduationCap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { FadeUp } from "@/components/shared/Animations";

interface AcademicMeta {
  author: string;
  institution: string;
  department: string;
  advisor: string;
  abstractTr: string;
  abstractEn: string;
  keywordsTr: string; // comma-separated for editing ease
  keywordsEn: string;
  acknowledgments: string;
  dedication: string;
}

const EMPTY: AcademicMeta = {
  author: "",
  institution: "",
  department: "",
  advisor: "",
  abstractTr: "",
  abstractEn: "",
  keywordsTr: "",
  keywordsEn: "",
  acknowledgments: "",
  dedication: "",
};

export default function AcademicSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [projectTitle, setProjectTitle] = useState<string>("");
  const [projectType, setProjectType] = useState<string>("ACADEMIC");
  const [form, setForm] = useState<AcademicMeta>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}`);
        if (!res.ok) {
          router.push("/");
          return;
        }
        const data = await res.json();
        setProjectTitle(data.title ?? "");
        setProjectType(data.projectType ?? "ACADEMIC");
        setForm({
          author: data.author ?? "",
          institution: data.institution ?? "",
          department: data.department ?? "",
          advisor: data.advisor ?? "",
          abstractTr: data.abstractTr ?? "",
          abstractEn: data.abstractEn ?? "",
          keywordsTr: Array.isArray(data.keywordsTr) ? data.keywordsTr.join(", ") : "",
          keywordsEn: Array.isArray(data.keywordsEn) ? data.keywordsEn.join(", ") : "",
          acknowledgments: data.acknowledgments ?? "",
          dedication: data.dedication ?? "",
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId, router]);

  function update<K extends keyof AcademicMeta>(field: K, value: AcademicMeta[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = {
        author: form.author.trim() || null,
        institution: form.institution.trim() || null,
        department: form.department.trim() || null,
        advisor: form.advisor.trim() || null,
        abstractTr: form.abstractTr.trim() || null,
        abstractEn: form.abstractEn.trim() || null,
        keywordsTr: form.keywordsTr
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean),
        keywordsEn: form.keywordsEn
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean),
        acknowledgments: form.acknowledgments.trim() || null,
        dedication: form.dedication.trim() || null,
      };
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Kaydedilemedi" }));
        throw new Error(err.error ?? "Kaydedilemedi");
      }
      toast.success("Akademik bilgiler kaydedildi");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#F5F0E6" }}>
        <Loader2 className="h-6 w-6 animate-spin text-[#2C5F2E]" />
      </div>
    );
  }

  if (projectType !== "ACADEMIC") {
    return (
      <div className="min-h-screen" style={{ backgroundColor: "#F5F0E6" }}>
        <div className="max-w-3xl mx-auto px-6 py-8">
          <Link
            href={`/projects/${projectId}/export`}
            className="inline-flex items-center gap-1.5 text-sm text-[#8a7a65] hover:text-[#2D1F0E] mb-6"
          >
            <ChevronLeft className="h-4 w-4" /> Export'a dön
          </Link>
          <p className="font-body text-[#6b5a45]">
            Akademik metadata sadece ACADEMIC proje türüne uygulanır. Bu proje tipi:{" "}
            <strong>{projectType}</strong>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#F5F0E6" }}>
      <div className="max-w-3xl mx-auto px-6 py-8">
        <Link
          href={`/projects/${projectId}/export`}
          className="inline-flex items-center gap-1.5 text-sm text-[#8a7a65] hover:text-[#2D1F0E] mb-6"
        >
          <ChevronLeft className="h-4 w-4" /> Export'a dön
        </Link>

        <FadeUp>
          <div className="flex items-center gap-3 mb-2">
            <GraduationCap className="h-6 w-6 text-[#8a5a1a]" />
            <h1 className="font-display text-2xl font-bold text-[#2D1F0E]">
              Akademik Metadata
            </h1>
          </div>
          <p className="font-body text-sm text-[#6b5a45] mb-8">
            Kapak sayfası, özet/abstract, içindekiler ve kaynakça bölümleri bu
            alanlardan üretilir. {projectTitle}.
          </p>
        </FadeUp>

        <div className="space-y-6 bg-[#FAF7F0] border border-[#d4c9b5] rounded-sm p-6">
          <section className="space-y-4">
            <h2 className="font-ui text-xs uppercase tracking-widest text-[#5C4A32]">
              Kapak Sayfası Bilgileri
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="author" className="text-xs">Yazar</Label>
                <Input id="author" value={form.author} onChange={(e) => update("author", e.target.value)} placeholder="Adınız Soyadınız" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="advisor" className="text-xs">Danışman</Label>
                <Input id="advisor" value={form.advisor} onChange={(e) => update("advisor", e.target.value)} placeholder="Prof. Dr. ..." />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="institution" className="text-xs">Kurum / Üniversite</Label>
                <Input id="institution" value={form.institution} onChange={(e) => update("institution", e.target.value)} placeholder="Bandırma Onyedi Eylül Üniversitesi" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="department" className="text-xs">Enstitü / Anabilim Dalı</Label>
                <Input id="department" value={form.department} onChange={(e) => update("department", e.target.value)} placeholder="Sosyal Bilimler Enstitüsü / İlahiyat ABD" />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="font-ui text-xs uppercase tracking-widest text-[#5C4A32]">
              Özet / Abstract
            </h2>
            <div className="space-y-1.5">
              <Label htmlFor="abstractTr" className="text-xs">
                Türkçe Özet <span className="text-[#8a7a65] font-normal">(max 250 kelime)</span>
              </Label>
              <Textarea id="abstractTr" rows={6} value={form.abstractTr} onChange={(e) => update("abstractTr", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="keywordsTr" className="text-xs">Anahtar Kelimeler (virgülle ayır)</Label>
              <Input id="keywordsTr" value={form.keywordsTr} onChange={(e) => update("keywordsTr", e.target.value)} placeholder="örn. kelam, mutezile, Osmanlı düşüncesi" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="abstractEn" className="text-xs">
                English Abstract <span className="text-[#8a7a65] font-normal">(max 250 words)</span>
              </Label>
              <Textarea id="abstractEn" rows={6} value={form.abstractEn} onChange={(e) => update("abstractEn", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="keywordsEn" className="text-xs">Keywords (comma-separated)</Label>
              <Input id="keywordsEn" value={form.keywordsEn} onChange={(e) => update("keywordsEn", e.target.value)} />
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="font-ui text-xs uppercase tracking-widest text-[#5C4A32]">
              Opsiyonel Ön Sayfalar
            </h2>
            <div className="space-y-1.5">
              <Label htmlFor="dedication" className="text-xs">İthaf</Label>
              <Textarea id="dedication" rows={3} value={form.dedication} onChange={(e) => update("dedication", e.target.value)} placeholder="örn. Anneme ve babama..." />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acknowledgments" className="text-xs">Önsöz / Teşekkür</Label>
              <Textarea id="acknowledgments" rows={5} value={form.acknowledgments} onChange={(e) => update("acknowledgments", e.target.value)} />
            </div>
          </section>

          <div className="flex justify-end pt-2">
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
