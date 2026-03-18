import { NextRequest, NextResponse } from "next/server";
import { generateJSON } from "@/lib/claude";
import type { StyleProfile } from "@/types/project";

const STYLE_ANALYSIS_SYSTEM = `You are an expert literary analyst specialising in academic and scholarly writing styles.
Analyse the provided writing sample and return a JSON object with these fields:
{
  "sentenceLength": "short" | "medium" | "long" | "mixed",
  "tone": "formal" | "semi-formal" | "conversational" | "academic",
  "terminologyDensity": "low" | "medium" | "high",
  "voicePreference": "active" | "passive" | "mixed",
  "paragraphStructure": "short" | "medium" | "long",
  "transitionPatterns": ["list of common transition phrases used"],
  "formality": 1-10,
  "usesFirstPerson": true | false,
  "rhetoricalApproach": "analytical" | "argumentative" | "descriptive" | "narrative" | "expository",
  "additionalNotes": "brief notes about the style"
}
Respond with valid JSON only. No markdown fences, no explanation.`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sampleText = body.sampleText ?? body.data?.sampleText ?? body.data?.sample;

    if (!sampleText || typeof sampleText !== "string" || sampleText.trim().length < 50) {
      return NextResponse.json(
        { error: "Please provide at least 50 characters of sample text." },
        { status: 400 }
      );
    }

    const prompt = `Analyse the following writing sample and return a StyleProfile JSON object:\n\n---\n${sampleText}\n---`;
    const styleProfile = await generateJSON<StyleProfile>(prompt, STYLE_ANALYSIS_SYSTEM);

    return NextResponse.json({ styleProfile });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/style/analyze]", errMsg, err);
    return NextResponse.json(
      { error: errMsg },
      { status: 500 }
    );
  }
}
