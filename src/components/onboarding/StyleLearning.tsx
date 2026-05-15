"use client";

/**
 * Onboarding step: build a Writing Twin from one or more writing
 * samples. The user can paste up to 5 distinct samples (e.g. a thesis
 * excerpt, a blog post, an old paper) and the analyser cross-checks
 * for traits that appear consistently across all of them — that's
 * what makes a *stable* Twin instead of a single-document snapshot.
 *
 * Calls /api/style/analyze with { samples: string[] }. The route runs
 * objective text statistics in JS, hands them to Claude Sonnet with
 * extended thinking, and returns a 5-field WritingTwinProfile plus the
 * raw measurements (rendered in the "Ölçtüklerimiz" panel for trust).
 */

import { useMemo, useState } from "react";
import { Loader2, Upload, CheckCircle, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { WritingTwinProfile } from "@/types/project";

interface StyleLearningProps {
  onStyleExtracted: (profile: Partial<WritingTwinProfile>) => void;
  extractedProfile: Partial<WritingTwinProfile> | null;
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

export default function StyleLearning({
  onStyleExtracted,
  extractedProfile,
}: StyleLearningProps) {
  const [samples, setSamples] = useState<string[]>([""]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [stats, setStats] = useState<AnalyzeStats | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    if (trimmed.length === 0) return;

    setIsAnalyzing(true);
    setError(null);
    try {
      const res = await fetch("/api/style/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ samples: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? "Analiz başarısız oldu.");
      }
      const { stats: rawStats, ...profile } = data as WritingTwinProfile & {
        stats?: AnalyzeStats;
      };
      setStats(rawStats ?? null);
      onStyleExtracted(profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analiz başarısız oldu.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  const hasProfile = extractedProfile && Object.keys(extractedProfile).length > 0;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label className="text-sm font-medium">Yazı örnekleri</Label>
        <p className="text-xs text-muted-foreground">
          Daha önce yazdığın 1-{MAX_SAMPLES} farklı metin yapıştır. Birden fazla
          örnek verirsen Twin daha sağlam çıkar — sistem yalnızca birden çok
          örnekte tutarlı çıkan özelliklere &quot;kararlı&quot; muamelesi yapar.
          Bu adım opsiyonel.
        </p>
      </div>

      <div className="space-y-3">
        {samples.map((sample, i) => {
          const charCount = sample.trim().length;
          const tooShort = charCount > 0 && charCount < MIN_CHARS;
          return (
            <div key={i} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-ui uppercase tracking-wider text-muted-foreground">
                  Örnek {i + 1}
                  {sample.trim().length >= MIN_CHARS && (
                    <span className="ml-2 text-green-700">✓ {charCount} karakter</span>
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
                    className="text-muted-foreground hover:text-red-600 transition-colors"
                    aria-label={`Örnek ${i + 1} sil`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <Textarea
                placeholder={
                  i === 0
                    ? "Daha önce yazdığın bir paragraf veya iki yapıştır..."
                    : "Farklı bir metin daha (örn. başka konuda, başka projeden)..."
                }
                value={sample}
                onChange={(e) => updateSample(i, e.target.value)}
                rows={6}
                className="font-mono text-sm"
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

      <Button
        onClick={handleAnalyze}
        disabled={validSampleCount === 0 || isAnalyzing}
        className="gap-2"
        variant="outline"
      >
        {isAnalyzing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Upload className="h-4 w-4" />
        )}
        {isAnalyzing
          ? "Analiz ediliyor..."
          : `Analiz et (${validSampleCount} örnek)`}
      </Button>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {hasProfile && extractedProfile && (
        <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30 p-4">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <p className="text-sm font-medium text-green-800 dark:text-green-200">
              Writing Twin oluşturuldu
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {extractedProfile.sentenceLength && (
              <div>
                <span className="text-muted-foreground">Cümle uzunluğu:</span>{" "}
                <span className="font-medium capitalize">
                  {extractedProfile.sentenceLength}
                </span>
              </div>
            )}
            {extractedProfile.paragraphStructure && (
              <div>
                <span className="text-muted-foreground">Paragraf yapısı:</span>{" "}
                <span className="font-medium">
                  {extractedProfile.paragraphStructure}
                </span>
              </div>
            )}
            {extractedProfile.rhetoricalApproach && (
              <div>
                <span className="text-muted-foreground">Retorik:</span>{" "}
                <span className="font-medium capitalize">
                  {extractedProfile.rhetoricalApproach}
                </span>
              </div>
            )}
            {extractedProfile.transitionPatterns &&
              extractedProfile.transitionPatterns.length > 0 && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Geçişler:</span>{" "}
                  <span className="font-medium">
                    {extractedProfile.transitionPatterns
                      .slice(0, 6)
                      .map((t) => `"${t}"`)
                      .join(", ")}
                    {extractedProfile.transitionPatterns.length > 6 &&
                      ` +${extractedProfile.transitionPatterns.length - 6}`}
                  </span>
                </div>
              )}
            {extractedProfile.additionalNotes && (
              <div className="col-span-2">
                <span className="text-muted-foreground">Not:</span>{" "}
                <span className="font-body">
                  {extractedProfile.additionalNotes}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {stats && (
        <details className="rounded-lg border border-[#d4c9b5]/60 bg-[#FAF7F0]/40 p-3 text-xs">
          <summary className="cursor-pointer font-ui uppercase tracking-wider text-[#8a7a65]">
            Ölçtüklerimiz (Twin&apos;in dayandığı objektif sayılar)
          </summary>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 font-body text-[#5C4A32]">
            <Stat k="Kelime sayısı" v={stats.wordCount} />
            <Stat k="Cümle sayısı" v={stats.sentenceCount} />
            <Stat k="Ort. cümle (kelime)" v={stats.avgSentenceWords} />
            <Stat k="Ort. paragraf (cümle)" v={stats.avgParagraphSentences} />
            <Stat k="Kısa cümle %" v={`${stats.shortSentencePct}%`} />
            <Stat k="Uzun cümle %" v={`${stats.longSentencePct}%`} />
            <Stat
              k="Tümdengelimci ipucu %"
              v={`${stats.deductiveCueHitPct}%`}
            />
            <Stat
              k="Tümevarımcı ipucu %"
              v={`${stats.inductiveCueHitPct}%`}
            />
            <Stat
              k="Konu cümlesi başta %"
              v={`${stats.topicSentenceFirstPct}%`}
            />
          </div>
        </details>
      )}
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
