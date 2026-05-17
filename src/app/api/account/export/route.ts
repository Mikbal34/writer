import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/account/export
 *
 * Returns a single JSON dump of all user-scoped data: profile, projects
 * (with chapters/sections/subsections), library entries (without binary
 * PDFs — those stay in storage), style profiles + samples, credit
 * ledger, and Zotero metadata. Streams as a download via
 * Content-Disposition.
 */
export async function GET() {
  try {
    const session = await requireAuth();
    const userId = session.user.id;

    const [user, projects, libraryEntries, styleProfiles, styleSamples, credits, zotero] =
      await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            name: true,
            email: true,
            createdAt: true,
            subscriptionTier: true,
            subscriptionStatus: true,
            creditBalance: true,
          },
        }),
        prisma.project.findMany({
          where: { userId },
          include: {
            chapters: {
              include: {
                sections: {
                  include: { subsections: true },
                },
              },
            },
            bibliography: true,
          },
        }),
        prisma.libraryEntry.findMany({
          where: { userId },
          include: {
            notes: true,
            highlights: true,
            tags: { include: { tag: true } },
            collections: { include: { collection: true } },
          },
        }),
        prisma.userStyleProfile.findMany({ where: { userId } }),
        prisma.styleSample.findMany({ where: { userId } }),
        prisma.creditTransaction.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
        }),
        prisma.zoteroConnection
          .findUnique({
            where: { userId },
            select: {
              createdAt: true,
              lastSyncAt: true,
              zoteroUserId: true,
            },
          })
          .catch(() => null),
      ]);

    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      user,
      projects,
      libraryEntries,
      styleProfiles,
      styleSamples,
      creditTransactions: credits,
      zotero,
    };

    const json = JSON.stringify(payload, null, 2);
    const filename = `quilpen-export-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;

    return new NextResponse(json, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[GET /api/account/export]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
