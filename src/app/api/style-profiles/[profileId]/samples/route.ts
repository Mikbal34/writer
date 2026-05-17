import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET / POST /api/style-profiles/[profileId]/samples
 *
 * GET   → list this profile's saved samples (newest first).
 * POST  → save a new pasted/uploaded sample.
 *
 * Samples power the "Örnek metinler" list in the right detail panel
 * and feed the analyze pipeline so the user can keep adding training
 * texts to an existing profile without re-running the chat interview.
 */

interface PostBody {
  filename?: string;
  content?: string;
  origin?: "paste" | "upload" | "chat";
}

async function ensureOwnedProfile(
  userId: string,
  profileId: string,
): Promise<{ id: string } | null> {
  return prisma.userStyleProfile.findFirst({
    where: { id: profileId, userId },
    select: { id: true },
  });
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ profileId: string }> },
) {
  try {
    const session = await requireAuth();
    const { profileId } = await ctx.params;
    const userId = session.user.id as string;

    const owned = await ensureOwnedProfile(userId, profileId);
    if (!owned) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const rows = await prisma.styleSample.findMany({
      where: { profileId, userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        filename: true,
        wordCount: true,
        origin: true,
        createdAt: true,
        content: true,
      },
    });

    // Trim each content to a short preview so the list payload stays
    // light; the full body is fetched via the [sampleId] GET when a
    // detail viewer ships.
    const samples = rows.map((s) => ({
      id: s.id,
      filename: s.filename,
      wordCount: s.wordCount,
      origin: s.origin,
      createdAt: s.createdAt,
      preview: s.content.slice(0, 300),
    }));

    return NextResponse.json({ samples });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[GET .../style-profiles/[id]/samples]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ profileId: string }> },
) {
  try {
    const session = await requireAuth();
    const { profileId } = await ctx.params;
    const userId = session.user.id as string;

    const owned = await ensureOwnedProfile(userId, profileId);
    if (!owned) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const body = (await req.json()) as PostBody;
    const content = body.content?.trim();
    if (!content || content.length < 40) {
      return NextResponse.json(
        { error: "Örnek metin çok kısa (en az 40 karakter)." },
        { status: 400 },
      );
    }
    if (content.length > 200_000) {
      return NextResponse.json(
        { error: "Metin çok uzun (200.000 karakter sınırı)." },
        { status: 400 },
      );
    }

    const wordCount = content
      .split(/\s+/)
      .filter((w) => w.length > 0).length;

    const created = await prisma.styleSample.create({
      data: {
        userId,
        profileId,
        filename: body.filename?.slice(0, 200) || `Örnek · ${wordCount} kelime`,
        content,
        wordCount,
        origin: body.origin === "upload" ? "upload" : body.origin === "chat" ? "chat" : "paste",
      },
      select: {
        id: true,
        filename: true,
        wordCount: true,
        origin: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ sample: created }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[POST .../style-profiles/[id]/samples]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
