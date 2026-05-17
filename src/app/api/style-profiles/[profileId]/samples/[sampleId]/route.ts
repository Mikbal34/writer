import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET    /api/style-profiles/[profileId]/samples/[sampleId]
 * DELETE /api/style-profiles/[profileId]/samples/[sampleId]
 *
 * GET returns the full sample including content (read-only inspect).
 * DELETE drops a sample row; ownership is checked both ways.
 */

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ profileId: string; sampleId: string }> },
) {
  try {
    const session = await requireAuth();
    const { profileId, sampleId } = await ctx.params;
    const userId = session.user.id as string;

    const sample = await prisma.styleSample.findFirst({
      where: { id: sampleId, profileId, userId },
      select: {
        id: true,
        filename: true,
        content: true,
        wordCount: true,
        origin: true,
        createdAt: true,
      },
    });
    if (!sample) {
      return NextResponse.json({ error: "Sample not found" }, { status: 404 });
    }
    return NextResponse.json({ sample });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ profileId: string; sampleId: string }> },
) {
  try {
    const session = await requireAuth();
    const { profileId, sampleId } = await ctx.params;
    const userId = session.user.id as string;

    const sample = await prisma.styleSample.findFirst({
      where: { id: sampleId, profileId, userId },
      select: { id: true },
    });
    if (!sample) {
      return NextResponse.json({ error: "Sample not found" }, { status: 404 });
    }
    await prisma.styleSample.delete({ where: { id: sampleId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
