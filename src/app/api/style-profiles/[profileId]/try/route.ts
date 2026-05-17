import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { streamChatWithUsage, HAIKU } from "@/lib/claude";
import { checkCredits, deductCredits } from "@/lib/credits";
import type { StyleProfile } from "@/types/project";

/**
 * POST /api/style-profiles/[profileId]/try
 *
 * One-shot "İkizi dene" — given a short prompt, produces ~1 paragraph
 * in the profile's voice via Haiku. We collect the stream into a
 * single string because the UI shows a single block (no incremental
 * render benefit).
 *
 *   Body: { prompt? }
 *   Returns: { paragraph, creditsUsed }
 */

interface Body {
  prompt?: string;
}

function describeVoice(p: Partial<StyleProfile> | null): string {
  if (!p) return "Doğal, net, ölçülü bir Türkçe yaz.";
  const bits: string[] = [];
  switch (p.sentenceLength) {
    case "short":
      bits.push("kısa, kesin cümleler kur");
      break;
    case "long":
      bits.push("uzun, dolambaçsız ama detaylı cümleler kur");
      break;
    case "varied":
      bits.push("kısa ve uzun cümleleri dengeli kullan");
      break;
    default:
      bits.push("orta uzunlukta cümleler kur");
  }
  if (p.paragraphStructure === "topic-sentence-first") {
    bits.push("paragrafa konu cümlesiyle başla");
  } else if (p.paragraphStructure === "inductive") {
    bits.push("önce kanıtla, sonra sonuca git (tümevarımcı)");
  } else if (p.paragraphStructure === "deductive") {
    bits.push("önce tezi koy, sonra örnekle (tümdengelimli)");
  }
  switch (p.rhetoricalApproach) {
    case "analytical":
      bits.push("analitik bir tonla, kavram ayrımlarına dikkat et");
      break;
    case "argumentative":
      bits.push("argümana dayalı yaz, karşı tezi de kabul edip yan");
      break;
    case "descriptive":
      bits.push("betimsel ol, soyutlamadan önce somut görüntü ver");
      break;
    case "comparative":
      bits.push("karşılaştırmalı yaklaş, iki tarafı yan yana koy");
      break;
  }
  if (Array.isArray(p.transitionPatterns) && p.transitionPatterns.length > 0) {
    const sample = (p.transitionPatterns as string[]).slice(0, 4).join(", ");
    bits.push(`tipik bağlaçların: ${sample}`);
  }
  if (p.additionalNotes && typeof p.additionalNotes === "string") {
    bits.push(`ek not: ${p.additionalNotes.trim()}`);
  }
  return bits.join("; ");
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ profileId: string }> },
) {
  try {
    const session = await requireAuth();
    const userId = session.user.id as string;
    const { profileId } = await ctx.params;

    const profile = await prisma.userStyleProfile.findFirst({
      where: { id: profileId, userId },
      select: { id: true, name: true, profile: true },
    });
    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const prompt =
      body.prompt?.trim() ||
      `${profile.name} üslubunda kısa bir paragraf yaz.`;

    const credits = await checkCredits(userId, "style_interview");
    if (!credits.allowed) {
      return NextResponse.json(
        {
          error: "Insufficient credits",
          balance: credits.balance,
          cost: credits.estimatedCost,
        },
        { status: 402 },
      );
    }

    const voiceLine = describeVoice(
      profile.profile as Partial<StyleProfile> | null,
    );

    const systemPrompt = `Sen kullanıcının yazı ikizisin. Aşağıdaki ses tarifine birebir uy:

${voiceLine}

Tek bir paragraf üret. 4-7 cümle, yaklaşık 120 kelime. Markdown veya açıklama YOK — sadece düz metin.`;

    const result = await streamChatWithUsage(
      [{ role: "user", content: prompt }],
      systemPrompt,
      undefined,
      { model: HAIKU },
    );

    const deduction = await deductCredits(
      userId,
      "style_interview",
      result.inputTokens,
      result.outputTokens,
      "haiku",
      undefined,
      {
        read: result.cacheReadTokens,
        creation: result.cacheCreationTokens,
      },
    );

    return NextResponse.json({
      paragraph: result.fullText.trim(),
      creditsUsed: deduction.creditsUsed,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[POST .../style-profiles/[id]/try]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
