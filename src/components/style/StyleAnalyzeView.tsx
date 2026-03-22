"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import StyleProfilePreview from "./StyleProfilePreview";
import type { StyleProfile } from "@/types/project";

interface StyleAnalyzeViewProps {
  profileId: string;
  currentProfile: Partial<StyleProfile> | null;
  onProfileUpdate: (profile: Partial<StyleProfile>) => void;
}

export default function StyleAnalyzeView({
  profileId,
  currentProfile,
  onProfileUpdate,
}: StyleAnalyzeViewProps) {
  const [sampleText, setSampleText] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<Partial<StyleProfile> | null>(
    currentProfile
  );

  async function handleAnalyze() {
    if (sampleText.trim().length < 50) {
      toast.error("Please provide at least 50 characters of sample text.");
      return;
    }

    setIsAnalyzing(true);
    try {
      const res = await fetch(
        `/api/style-profiles/${profileId}/analyze`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sampleText: sampleText.trim() }),
        }
      );

      if (res.status === 402) {
        const errData = await res.json().catch(() => ({}));
        toast.error(
          `Insufficient credits (${errData.balance ?? 0} remaining).`
        );
        return;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error ?? "Analysis failed");
      }

      const data = await res.json();
      setResult(data.styleProfile);
      onProfileUpdate(data.styleProfile);
      toast.success("Style profile created!");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to analyze writing sample"
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  if (result) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-6 py-4 border-b border-[#e8e0d4] shrink-0 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold italic text-[#2D1F0E]">
            Analysis Result
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setResult(null)}
            className="font-ui text-xs text-[#8a7a65] hover:text-[#2D1F0E]"
          >
            Analyze Again
          </Button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <StyleProfilePreview profile={result} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
        <h2 className="font-display text-xl font-bold italic text-[#2D1F0E] mb-2">
          Analyze Writing Sample
        </h2>
        <p className="font-body text-sm text-[#8a7a65] mb-6">
          Paste a writing sample (at least 50 characters) and we&apos;ll analyze
          your writing style automatically.
        </p>

        <textarea
          value={sampleText}
          onChange={(e) => setSampleText(e.target.value)}
          placeholder="Paste your writing sample here..."
          className="w-full rounded-md border border-[#e0d8cc] bg-[#fdfcfa] px-4 py-3 font-body text-sm text-[#2D1F0E] placeholder:text-[#b8ad9e] focus:outline-none focus:border-[#C9A84C]/60 focus:ring-1 focus:ring-[#C9A84C]/20 transition-all resize-y"
          style={{ minHeight: "240px", maxHeight: "500px" }}
          disabled={isAnalyzing}
        />

        <div className="flex items-center justify-between mt-4">
          <span className="font-ui text-xs text-[#a89880]">
            {sampleText.length} characters
          </span>
          <Button
            onClick={handleAnalyze}
            disabled={sampleText.trim().length < 50 || isAnalyzing}
            className="gap-2 bg-[#2D1F0E] hover:bg-[#3a2910] text-[#F5EDE0]"
          >
            {isAnalyzing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {isAnalyzing ? "Analyzing..." : "Analyze"}
          </Button>
        </div>
      </div>
    </div>
  );
}
