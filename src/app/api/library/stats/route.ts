import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * Returns user-level aggregations for the Library hero band so the
 * stat tiles don't lie when the entry list is paginated. All counts
 * are scoped to the authed user.
 */
export async function GET() {
  try {
    const session = await requireAuth();
    const userId = session.user.id as string;

    const [
      totalSources,
      typeGroups,
      notedSources,
      highlightsTotal,
      notesTotal,
    ] = await Promise.all([
      // Total entries (all types).
      prisma.libraryEntry.count({ where: { userId } }),
      // Per-type breakdown so the UI can show "kitap" (or any chosen
      // type) accurately. Returns rows like [{ entryType, _count }].
      prisma.libraryEntry.groupBy({
        by: ["entryType"],
        where: { userId },
        _count: { entryType: true },
      }),
      // Entries that have at least one note attached.
      prisma.libraryEntry.count({
        where: { userId, notes: { some: {} } },
      }),
      // Total highlights across the whole library.
      prisma.libraryHighlight.count({ where: { userId } }),
      // Total notes (across all entries).
      prisma.libraryNote.count({ where: { userId } }),
    ]);

    const byType: Record<string, number> = {};
    for (const row of typeGroups) {
      byType[row.entryType] = row._count.entryType;
    }

    return NextResponse.json({
      total: totalSources,
      byType,
      // Reading-source roll-up: "kitap" alone is misleading because
      // most users mix in articles/theses. We surface both shapes so
      // the page can pick whichever fits the hero copy.
      booksAndArticles:
        (byType.kitap ?? 0) +
        (byType.makale ?? 0) +
        (byType.tez ?? 0) +
        (byType.ansiklopedi ?? 0),
      notedSources,
      highlightsTotal,
      notesTotal,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[GET /api/library/stats]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
