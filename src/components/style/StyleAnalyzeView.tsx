"use client";

/**
 * Multi-sample analyser for the /style page. Drops the older single-
 * textarea into a list of up to 5 textareas so the user can paste
 * several different writing samples and have the analyser cross-check
 * for consistent traits — the version that ended up in DB before this
 * page only ever saw one sample and produced "varied"/"mixed" too
 * eagerly as a result.
 */

import { useMemo, useState } from "react";
import { Loader2, Sparkles, CheckCircle2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { WritingTwinProfile } from "@/types/project";

interface StyleAnalyzeViewProps {
  profileId: string;
  currentProfile: Partial<WritingTwinProfile> | null;
  onProfileUpdate: (profile: Partial<WritingTwinProfile>) => void;
}

interface AnalyzeStats {
  wordCount: number;
  sentenceCount: number;
  avgSentenceWords: number;
  shortSentencePct: number;
  longSentencePct: number;
  avgParagraphSentences: number;
  topicSentenceFirstPct: number;
  deductiveCueHitPct: number;
  inductiveCueHitPct: number;
  topTransitions: string[];
}

const MAX_SAMPLES = 5;
const MIN_CHARS = 50;

export default function StyleAnalyzeView({
  profileId,
  currentProfile,
  onProfileUpdate,
}: StyleAnalyzeViewProps) {
  const [samples, setSamples] = useState<string[]>([""]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<Partial<WritingTwinProfile> | null>(
    currentProfile,
  );
  const [stats, setStats] = useState<AnalyzeStats | null>(null);

  const validSampleCount = useMemo(
    () => samples.filter((s) => s.trim().length >= MIN_CHARS).length,
    [samples],
  );

  function updateSample(i: number, value: string) {
    setSamples((prev) => prev.map((s, idx) => (idx === i ? value : s)));
  }
  function addSample() {
    if (samples.length >= MAX_SAMPLES) return;
    setSamples((prev) => [...prev, ""]);
  }
  function removeSample(i: number) {
    setSamples((prev) =>
      prev.length === 1 ? [""] : prev.filter((_, idx) => idx !== i),
    );
  }

  async function handleAnalyze() {
    const trimmed = samples
      .map((s) => s.trim())
      .filter((s) => s.length >= MIN_CHARS);
    if (trimmed.length === 0) {
      toast.error(`En az ${MIN_CHARS} karakter uzunluğunda bir örnek gönder.`);
      return;
    }

    setIsAnalyzing(true);
    try {
      const res = await fetch(`/api/style-profiles/${profileId}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ samples: trimmed }),
      });

      if (res.status === 402) {
        const errData = await res.json().catch(() => ({}));
        toast.error(`Yetersiz kredi (${errData.balance ?? 0} kaldı).`);
        return;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error ?? "Analiz başarısız oldu.");
      }

      const data = await res.json();
      setResult(data.styleProfile);
      setStats(data.stats ?? null);
      onProfileUpdate(data.styleProfile);
      toast.success(`Twin oluşturuldu (${trimmed.length} örnekten).`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Analiz başarısız oldu.",
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  if (result) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center text-center px-8 py-12">
          <div className="w-16 h-16 rounded-full bg-[#C9A84C]/15 flex items-center justify-center mb-5">
            <CheckCircle2 className="h-9 w-9 text-[#C9A84C]" strokeWidth={1.5} />
          </div>
          <h2 className="font-display text-xl font-bold italic text-[#2D1F0E] mb-2">
            Analiz tamamlandı
          </h2>
          <p className="font-body text-sm text-[#8a7a65] max-w-sm mb-6 leading-relaxed">
            Writing Twin profilin oluşturuldu. Yan paneldeki özetten kontrol
            edebilirsin.
          </p>
          {stats && (
            <details className="w-full max-w-sm text-left rounded-sm border border-[#d4c9b5]/60 bg-[#FAF7F0]/40 p-3 text-xs mb-4">
              <summary className="cursor-pointer font-ui uppercase tracking-wider text-[#8a7a65]">
                Ölçtüklerimiz
              </summary>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 font-body text-[#5C4A32]">
                <Stat k="Kelime" v={stats.wordCount} />
                <Stat k="Cümle" v={stats.sentenceCount} />
                <Stat k="Ort. cümle (kelime)" v={stats.avgSentenceWords} />
                <Stat k="Ort. paragraf (cümle)" v={stats.avgParagraphSentences} />
                <Stat k="Tümdengelimci %" v={`${stats.deductiveCueHitPct}%`} />
                <Stat k="Tümevarımcı %" v={`${stats.inductiveCueHitPct}%`} />
                <Stat k="Konu cümlesi başta %" v={`${stats.topicSentenceFirstPct}%`} />
              </div>
            </details>
          )}
          <Button
            variant="outline"
            onClick={() => {
              setResult(null);
              setStats(null);
              setSamples([""]);
            }}
            className="font-ui text-sm gap-2"
          >
            <Sparkles className="h-4 w-4" />
            Yeniden analiz et
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
        <h2 className="font-display text-xl font-bold italic text-[#2D1F0E] mb-2">
          Yazı örneklerini analiz et
        </h2>
        <p className="font-body text-sm text-[#8a7a65] mb-6">
          1-{MAX_SAMPLES} farklı yazı örneği yapıştır. Birden fazla örnek
          verirsen Twin sadece <em>tüm örneklerde</em> tutarlı çıkan
          özelliklere kararlı muamelesi yapar.
        </p>

        <div className="space-y-4">
          {samples.map((sample, i) => {
            const charCount = sample.trim().length;
            const tooShort = charCount > 0 && charCount < MIN_CHARS;
            return (
              <div key={i} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-ui uppercase tracking-wider text-[#8a7a65]">
                    Örnek {i + 1}
                    {charCount >= MIN_CHARS && (
                      <span className="ml-2 text-green-700">✓ {charCount}</span>
                    )}
                    {tooShort && (
                      <span className="ml-2 text-amber-700">
                        en az {MIN_CHARS} karakter
                      </span>
                    )}
                  </span>
                  {samples.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSample(i)}
                      className="text-[#8a7a65] hover:text-red-600 transition-colors"
                      aria-label={`Örnek ${i + 1} sil`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <textarea
                  value={sample}
                  onChange={(e) => updateSample(i, e.target.value)}
                  placeholder={
                    i === 0
                      ? "Daha önce yazdığın bir parça..."
                      : "Farklı bir metin daha (örn. başka projeden)..."
                  }
                  className="w-full rounded-sm border border-[#e0d8cc] bg-[#fdfcfa] px-4 py-3 font-body text-sm text-[#2D1F0E] placeholder:text-[#b8ad9e] focus:outline-none focus:border-[#C9A84C]/60 focus:ring-1 focus:ring-[#C9A84C]/20 transition-all resize-y"
                  style={{ minHeight: "140px", maxHeight: "320px" }}
                  disabled={isAnalyzing}
                />
              </div>
            );
          })}

          {samples.length < MAX_SAMPLES && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addSample}
              className="gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              Başka örnek ekle ({samples.length}/{MAX_SAMPLES})
            </Button>
          )}
        </div>

        <div className="flex items-center justify-between mt-6">
          <span className="font-ui text-xs text-[#a89880]">
            {validSampleCount} geçerli örnek
          </span>
          <Button
            onClick={handleAnalyze}
            disabled={validSampleCount === 0 || isAnalyzing}
            className="gap-2 bg-[#2D1F0E] hover:bg-[#3a2910] text-[#F5EDE0]"
          >
            {isAnalyzing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {isAnalyzing
              ? "Analiz ediliyor..."
              : `Analiz et (${validSampleCount})`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string | number }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[#8a7a65]">{k}:</span>
      <span className="font-medium text-[#2D1F0E]">{v}</span>
    </div>
  );
}
