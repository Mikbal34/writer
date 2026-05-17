import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * PATCH /api/account
 *   Body: { name?: string }
 *   Updates the user's display name. Magic-link auth has no password,
 *   so this is currently the only mutable identity field.
 *
 * DELETE /api/account
 *   Body: { confirm: "Hesabımı sil" }
 *   Cascades through Prisma relations to wipe projects, library entries,
 *   style profiles, chat history, and credit ledger. The user record is
 *   removed last; NextAuth Sessions and Accounts are cascaded by the
 *   adapter schema.
 */

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireAuth();
    const body = (await req.json()) as { name?: unknown };

    if (typeof body.name !== "string") {
      return NextResponse.json({ error: "name gerekli" }, { status: 400 });
    }
    const name = body.name.trim();
    if (name.length < 1 || name.length > 80) {
      return NextResponse.json(
        { error: "İsim 1–80 karakter olmalı." },
        { status: 400 },
      );
    }

    const updated = await prisma.user.update({
      where: { id: session.user.id },
      data: { name },
      select: { id: true, name: true, email: true },
    });

    return NextResponse.json({ user: updated });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[PATCH /api/account]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireAuth();
    const body = (await req.json().catch(() => ({}))) as { confirm?: unknown };

    if (body.confirm !== "Hesabımı sil") {
      return NextResponse.json(
        { error: "Onay yazısı eşleşmedi." },
        { status: 400 },
      );
    }

    await prisma.user.delete({ where: { id: session.user.id } });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[DELETE /api/account]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
