/**
 * POST /api/library/citation-chase
 *
 * Body: {
 *   seed: { doi?, openalexId?, semanticScholarId?, title? }
 *   query?: string  // optional original query — used to rerank
 *                      results by relevance to what the user was
 *                      actually researching
 *   limit?: number  // per direction, default 50
 * }
 *
 * Returns: {
 *   seed: { title, authors },
 *   backward: AcademicSearchResult[],  // references — sorted by reranker score
 *   forward:  AcademicSearchResult[],  // citing works — sorted by reranker score
 *   counts: { backwardRaw, forwardRaw, alreadyInLibrary }
 * }
 *
 * Snowball workflow: the user picks a "seed" paper (either from
 * literature search results or from an entry already in their
 * library), this endpoint expands its citation graph one hop in
 * both directions, flags entries the user already owns, and
 * (optionally) reranks the unowned results against the original
 * search query so the most relevant follow-up reading floats to
 * the top.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { chaseCitations } from "@/lib/citation-graph";
import { rerankChunks } from "@/lib/rerank";
import type { AcademicSearchResult } from "@/lib/academic-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RequestBody {
  seed?: {
    doi?: string;
    openalexId?: string;
    semanticScholarId?: string;
    title?: string;
  };
  query?: string;
  limit?: number;
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;
    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const seed = body.seed;
    if (
      !seed ||
      !(seed.doi || seed.openalexId || seed.semanticScholarId || seed.title)
    ) {
      return NextResponse.json(
        {
          error:
            "seed { doi | openalexId | semanticScholarId | title } gerekli",
        },
        { status: 400 },
      );
    }
    const limit = Math.min(Math.max(body.limit ?? 50, 5), 100);

    // ── Citation graph ──────────────────────────────────────────
    const chase = await chaseCitations(
      {
        doi: seed.doi ?? null,
        openalexId: seed.openalexId ?? null,
        semanticScholarId: seed.semanticScholarId ?? null,
        title: seed.title ?? null,
      },
      { limit, dedupe: true },
    );

    const backwardRaw = chase.backward.length;
    const forwardRaw = chase.forward.length;

    // ── Library presence check ──────────────────────────────────
    const allResults = [...chase.backward, ...chase.forward];
    const dois = allResults
      .map((r) => r.doi?.toLowerCase())
      .filter((d): d is string => !!d);
    const titleKeys = allResults.map(
      (r) =>
        `${r.title.toLowerCase().slice(0, 60)}|${r.authorSurname.toLowerCase()}`,
    );
    const existing = await prisma.libraryEntry.findMany({
      where: {
        userId,
        OR: [
          dois.length > 0 ? { doi: { in: dois } } : undefined,
          { title: { in: allResults.map((r) => r.title) } },
        ].filter(Boolean) as Array<Record<string, unknown>>,
      },
      select: { title: true, authorSurname: true, doi: true },
    });
    const ownedDois = new Set(
      existing.map((e) => e.doi?.toLowerCase()).filter(Boolean) as string[],
    );
    const ownedTitleKeys = new Set(
      existing.map(
        (e) =>
          `${e.title.toLowerCase().slice(0, 60)}|${e.authorSurname.toLowerCase()}`,
      ),
    );
    let alreadyInLibrary = 0;
    for (let i = 0; i < allResults.length; i++) {
      const r = allResults[i];
      const tk = titleKeys[i];
      const owned =
        (r.doi && ownedDois.has(r.doi.toLowerCase())) ||
        ownedTitleKeys.has(tk);
      if (owned) {
        r.alreadyInLibrary = true;
        alreadyInLibrary++;
      }
    }

    // ── Rerank against the original query ───────────────────────
    // Skip when no query was supplied — bare snowball still
    // benefits from the citation graph order (forward is citation-
    // count-sorted by OpenAlex).
    const query = (body.query ?? "").trim();
    if (query.length >= 5) {
      const rankableFor = (list: AcademicSearchResult[]) =>
        list.map((r, i) => ({
          id: `${r.provider}-${i}-${r.externalId}`,
          content: [r.title, r.abstract ?? ""].filter(Boolean).join(" — "),
          title: r.title,
          sectionTitle: r.journalName ?? r.publisher ?? null,
          pageLabel: r.year ?? null,
        }));

      // Rerank backward + forward independently so the UI's two
      // columns each get their own ordering.
      const [bwRank, fwRank] = await Promise.all([
        chase.backward.length > 1
          ? rerankChunks(query, rankableFor(chase.backward))
          : Promise.resolve(
              chase.backward.map((r, i) => ({
                id: `${r.provider}-${i}-${r.externalId}`,
                score: 5,
              })),
            ),
        chase.forward.length > 1
          ? rerankChunks(query, rankableFor(chase.forward))
          : Promise.resolve(
              chase.forward.map((r, i) => ({
                id: `${r.provider}-${i}-${r.externalId}`,
                score: 5,
              })),
            ),
      ]);
      const sortBy = (list: AcademicSearchResult[], ranked: typeof bwRank) => {
        const score = new Map(ranked.map((r) => [r.id, r.score]));
        return list
          .map((r, i) => ({
            r,
            s: score.get(`${r.provider}-${i}-${r.externalId}`) ?? 0,
          }))
          .sort((a, b) => b.s - a.s)
          .map((x) => x.r);
      };
      chase.backward = sortBy(chase.backward, bwRank);
      chase.forward = sortBy(chase.forward, fwRank);
    }

    return NextResponse.json({
      seed: { title: chase.seedTitle, authors: chase.seedAuthors },
      backward: chase.backward,
      forward: chase.forward,
      counts: {
        backwardRaw,
        forwardRaw,
        alreadyInLibrary,
      },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[POST /api/library/citation-chase]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
