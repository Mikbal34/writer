import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  text?: string;
  /** Optional citation tag the UI passes through — e.g.
   *  "Kütüphane sohbeti · {sessionId}" — appended as a small blockquote
   *  header so the writer knows where the chunk came from. */
  source?: string | null;
}

/**
 * Append a block of text to a subsection's existing content. Used by
 * the "Tezime alıntıla" action in the library chat: the assistant's
 * answer (or a user-edited slice of it) lands as a new paragraph at
 * the bottom of a chosen subsection draft.
 *
 *   POST /api/projects/[id]/subsections/[subId]/append
 *   Body: { text, source? }
 *
 * Refuses cross-user writes via the subsection ownership check.
 * Returns the new wordCount + content preview so the client can
 * surface a "X kelime eklendi" toast.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string; subId: string }> },
) {
  try {
    const session = await requireAuth();
    const { id: projectId, subId } = await context.params;
    const body = (await req.json()) as Body;

    const text = body.text?.trim();
    if (!text) {
      return NextResponse.json(
        { error: "Eklenmek üzere boş metin gönderildi." },
        { status: 400 },
      );
    }
    if (text.length > 50_000) {
      return NextResponse.json(
        { error: "Metin çok uzun (50.000 karakter sınırı)." },
        { status: 400 },
      );
    }

    // Ownership guard — load the subsection through the project chain
    // so a forged subId from another user's project is rejected.
    const subsection = await prisma.subsection.findFirst({
      where: {
        id: subId,
        section: {
          chapter: {
            project: { id: projectId, userId: session.user.id as string },
          },
        },
      },
      select: { id: true, content: true, wordCount: true, title: true },
    });
    if (!subsection) {
      return NextResponse.json(
        { error: "Alt-bölüm bulunamadı." },
        { status: 404 },
      );
    }

    // Build the appended block. Source line lives as a blockquote so
    // it visually separates from the original draft when the writer
    // opens the editor.
    const header = body.source ? `> ${body.source}\n\n` : "";
    const block = `${header}${text}`.trim();
    const next = subsection.content
      ? `${subsection.content}\n\n${block}`
      : block;

    const wordCount = next
      .split(/\s+/)
      .filter((w) => w.length > 0).length;

    await prisma.subsection.update({
      where: { id: subId },
      data: { content: next, wordCount },
    });

    return NextResponse.json({
      ok: true,
      wordsAdded: text.split(/\s+/).filter((w) => w.length > 0).length,
      newWordCount: wordCount,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[POST .../subsections/[subId]/append]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
