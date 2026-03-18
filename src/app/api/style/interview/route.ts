import { NextRequest, NextResponse } from "next/server";
import { generateJSON } from "@/lib/claude";
import type { StyleProfile } from "@/types/project";

const INTERVIEW_SYSTEM = `You are a writing coach conducting a style preference interview.
Your goal is to understand the author's preferred writing style through targeted questions.
Ask one clear question at a time about: tone, sentence length, terminology density, voice (active/passive),
paragraph structure, formality level, rhetorical approach, use of first person, transition patterns.

After gathering enough information (at least 3-4 exchanges), return a JSON with:
{ "done": true, "reply": "summary message", "styleProfile": { ... full StyleProfile object ... } }

While still interviewing, return:
{ "done": false, "reply": "your next question or response" }

Respond with valid JSON only.`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messages = body.messages ?? body.data?.messages ?? [];

    const prompt = messages
      .map((m: { role: string; content: string }) => `${m.role}: ${m.content}`)
      .join("\n\n");

    const result = await generateJSON<{
      done: boolean;
      reply: string;
      styleProfile?: StyleProfile;
    }>(prompt, INTERVIEW_SYSTEM);

    return NextResponse.json({
      reply: result.reply ?? "Could you tell me more about your preferred writing style?",
      styleProfile: result.done ? result.styleProfile : null,
      done: result.done ?? false,
    });
  } catch (err) {
    console.error("[POST /api/style/interview]", err);
    return NextResponse.json(
      { error: "Interview failed. Please try again." },
      { status: 500 }
    );
  }
}
