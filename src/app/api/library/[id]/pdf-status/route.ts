import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { pdfExists } from "@/lib/library-storage";

/**
 * GET /api/library/[id]/pdf-status?volume=<id>
 *
 * Sidecar to /pdf — answers "why didn't the file stream?" so the viewer
 * can render a helpful empty state instead of a generic "load failed".
 *
 * Returns:
 *   - status: from LibraryEntry.pdfStatus (or volume's)
 *   - hasFile: whether the disk file actually exists right now
 *   - error: stored pdfError (if pdfStatus === "failed")
 */

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth();
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const volumeId = url.searchParams.get("volume");

    if (volumeId) {
      const volume = await prisma.libraryEntryVolume.findFirst({
        where: {
          id: volumeId,
          libraryEntryId: id,
          libraryEntry: { userId: session.user.id },
        },
        select: { filePath: true, pdfStatus: true, pdfError: true },
      });
      if (!volume) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json({
        status: volume.pdfStatus,
        hasFile: pdfExists(volume.filePath),
        error: volume.pdfError ?? null,
      });
    }

    const entry = await prisma.libraryEntry.findFirst({
      where: { id, userId: session.user.id },
      select: { filePath: true, pdfStatus: true, pdfError: true },
    });
    if (!entry) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // Mirrors /pdf: when entry.filePath is null (new volume-based
    // uploads), report the earliest volume's status so the viewer's
    // empty-state matches what /pdf will actually serve.
    if (!pdfExists(entry.filePath)) {
      const firstVolume = await prisma.libraryEntryVolume.findFirst({
        where: { libraryEntryId: id },
        orderBy: { createdAt: "asc" },
        select: { filePath: true, pdfStatus: true, pdfError: true },
      });
      if (firstVolume) {
        return NextResponse.json({
          status: firstVolume.pdfStatus,
          hasFile: pdfExists(firstVolume.filePath),
          error: firstVolume.pdfError ?? null,
        });
      }
    }
    return NextResponse.json({
      status: entry.pdfStatus,
      hasFile: pdfExists(entry.filePath),
      error: entry.pdfError ?? null,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[GET /api/library/[id]/pdf-status]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
