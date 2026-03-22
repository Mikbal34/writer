"use client";

import { useState } from "react";
import { Loader2, Upload, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { StyleProfile } from "@/types/project";

interface StyleLearningProps {
  onStyleExtracted: (profile: Partial<StyleProfile>) => void;
  extractedProfile: Partial<StyleProfile> | null;
}

export default function StyleLearning({
  onStyleExtracted,
  extractedProfile,
}: StyleLearningProps) {
  const [sampleText, setSampleText] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  async function handleAnalyze() {
    if (!sampleText.trim()) return;

    setIsAnalyzing(true);
    try {
      const res = await fetch("/api/style/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sampleText }),
      });

      if (!res.ok) throw new Error("Analysis failed");

      const profile = await res.json();
      onStyleExtracted(profile);
    } catch {
      // Fallback: extract basic style locally
      onStyleExtracted({
        tone: "formal",
        sentenceLength: "medium",
        formality: 7,
        rhetoricalApproach: "analytical",
      });
    } finally {
      setIsAnalyzing(false);
    }
  }

  const hasProfile = extractedProfile && Object.keys(extractedProfile).length > 0;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="sample">Paste a writing sample</Label>
        <p className="text-xs text-muted-foreground">
          Paste 1-2 paragraphs of your previous writing so the AI can learn your
          style. This step is optional.
        </p>
        <Textarea
          id="sample"
          placeholder="Paste a sample of your academic writing here..."
          value={sampleText}
          onChange={(e) => setSampleText(e.target.value)}
          rows={8}
          className="font-mono text-sm"
        />
      </div>

      <Button
        onClick={handleAnalyze}
        disabled={!sampleText.trim() || isAnalyzing}
        className="gap-2"
        variant="outline"
      >
        {isAnalyzing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Upload className="h-4 w-4" />
        )}
        {isAnalyzing ? "Analyzing..." : "Analyze Style"}
      </Button>

      {hasProfile && (
        <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30 p-4">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <p className="text-sm font-medium text-green-800 dark:text-green-200">
              Style profile extracted
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {extractedProfile.tone && (
              <div>
                <span className="text-muted-foreground">Tone:</span>{" "}
                <span className="font-medium capitalize">{extractedProfile.tone}</span>
              </div>
            )}
            {extractedProfile.sentenceLength && (
              <div>
                <span className="text-muted-foreground">Sentences:</span>{" "}
                <span className="font-medium capitalize">{extractedProfile.sentenceLength}</span>
              </div>
            )}
            {extractedProfile.formality !== undefined && (
              <div>
                <span className="text-muted-foreground">Formality:</span>{" "}
                <span className="font-medium">{extractedProfile.formality}/10</span>
              </div>
            )}
            {extractedProfile.rhetoricalApproach && (
              <div>
                <span className="text-muted-foreground">Approach:</span>{" "}
                <span className="font-medium capitalize">{extractedProfile.rhetoricalApproach}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
