import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * User-level rollups for the Writing Twin hero band. Counts are
 * approximate where the per-sample storage hasn't landed yet:
 *
 *   - profileCount      — raw count of UserStyleProfile rows
 *   - sampleCount       — user-authored StyleChatMessage rows
 *                         (each meaningful answer doubles as a sample
 *                          we infer voice from)
 *   - analysisWordCount — sum of words across those messages
 *
 * Once StyleSample lands as a first-class table the sampleCount can
 * pivot to its row count without changing the response shape.
 */
export async function GET() {
  try {
    const session = await requireAuth();
    const userId = session.user.id as string;

    const [profileCount, userMessages] = await Promise.all([
      prisma.userStyleProfile.count({ where: { userId } }),
      // Pull user-role messages across all of this user's profiles.
      // Keeps the query a single round-trip — the StyleChatMessage rows
      // are small (content text) and per-user volume is low.
      prisma.styleChatMessage.findMany({
        where: {
          role: "user",
          styleProfile: { userId },
        },
        select: { content: true },
      }),
    ]);

    let analysisWordCount = 0;
    for (const m of userMessages) {
      analysisWordCount += m.content
        .split(/\s+/)
        .filter((w) => w.length > 0).length;
    }

    return NextResponse.json({
      profileCount,
      sampleCount: userMessages.length,
      analysisWordCount,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[GET /api/style-profiles/stats]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
