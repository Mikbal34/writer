/**
 * POST /api/projects/[id]/citations/verify
 *
 * Walks every citation marker in the project's subsection content,
 * runs the 3-tier verifier (exact → fuzzy → semantic → page ±2),
 * and upserts the result into `CitationVerification`.
 *
 * Optional body: `{ only: string[] }` — citation keys from
 * GET /api/projects/[id]/citations. When omitted, verifies all.
 *
 * Returns `{ verified: number, suspected: number, failed: number,
 * results: Array<{ key, status, matchedPage, matchScore }> }` so the
 * UI can update its list state without a separate GET.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  verifyCitation,
  quoteHashOf,
  type VerificationStatus,
} from "@/lib/citation-verifier";
import { parseMarker } from "@/lib/citations/inline-resolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // long-running for bulk

type RouteContext = { params: Promise<{ id: string }> };

const SPAN_RE =
  /<span\b[^>]*data-cite-bib-id\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/span>/g;
const MARKDOWN_RE = /\[cite:([^\]]+)\]/g;

function attr(html: string, name: string): string | null {
  const m = html.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`));
  return m ? m[1] : null;
}

interface Marker {
  key: string;
  subsectionId: string;
  bibliographyId: string;
  page: number | null;
  quote: string | null;
  volumeId: string | null;
  // Position in `content` so we can sort the two parser passes back
  // into reading order before we hand the list to the verifier.
  position: number;
}

function extractMarkers(
  subsectionId: string,
  content: string,
): Marker[] {
  if (!content) return [];
  const out: Marker[] = [];

  // 1) HTML span markers (round-tripped editor output).
  SPAN_RE.lastIndex = 0;
  for (const match of content.matchAll(SPAN_RE)) {
    const fullSpan = match[0];
    const bibId = match[1];
    const pageStr = attr(fullSpan, "data-page");
    const page = pageStr ? parseInt(pageStr, 10) : null;
    const quote = attr(fullSpan, "data-quote");
    const volumeId = attr(fullSpan, "data-volume-id");
    out.push({
      key: "",
      subsectionId,
      bibliographyId: bibId,
      page: Number.isFinite(page as number) ? (page as number) : null,
      quote: quote || null,
      volumeId: volumeId || null,
      position: match.index ?? 0,
    });
  }

  // 2) Markdown markers (raw LLM output sitting on disk).
  MARKDOWN_RE.lastIndex = 0;
  for (const match of content.matchAll(MARKDOWN_RE)) {
    const parsed = parseMarker(match[1]);
    if (!parsed) continue;
    const page =
      parsed.page && /^\d+/.test(parsed.page)
        ? parseInt(parsed.page, 10)
        : null;
    out.push({
      key: "",
      subsectionId,
      bibliographyId: parsed.bibId,
      page: Number.isFinite(page as number) ? (page as number) : null,
      quote: parsed.quote ?? null,
      volumeId: null,
      position: match.index ?? 0,
    });
  }

  // Sort by reading order and assign stable keys (matches the GET
  // endpoint's `subsectionId::idx` scheme).
  out.sort((a, b) => a.position - b.position);
  return out.map((m, i) => ({ ...m, key: `${subsectionId}::${i}` }));
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth();
    const { id: projectId } = await ctx.params;

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: session.user.id },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const onlyKeys: Set<string> | null =
      Array.isArray(body?.only) && body.only.length > 0
        ? new Set(body.only as string[])
        : null;

    const subsections = await prisma.subsection.findMany({
      where: { section: { chapter: { projectId } } },
      select: { id: true, content: true },
    });

    const markers: Marker[] = [];
    for (const sub of subsections) {
      markers.push(...extractMarkers(sub.id, sub.content ?? ""));
    }
    const filtered = onlyKeys
      ? markers.filter((m) => onlyKeys.has(m.key))
      : markers;

    if (filtered.length === 0) {
      return NextResponse.json({ verified: 0, suspected: 0, failed: 0, results: [] });
    }

    const tally: Record<VerificationStatus, number> = {
      unverified: 0,
      verified: 0,
      suspected: 0,
      failed: 0,
    };
    const results: Array<{
      key: string;
      status: VerificationStatus;
      matchedPage: number | null;
      matchScore: number | null;
      matchMethod: string | null;
    }> = [];

    for (const m of filtered) {
      const result = await verifyCitation(prisma, {
        projectId,
        subsectionId: m.subsectionId,
        bibliographyId: m.bibliographyId,
        page: m.page,
        quote: m.quote,
        volumeId: m.volumeId,
      });

      const hash = quoteHashOf(m.quote);
      const pageDb = m.page ?? -1;

      // Upsert — never overwrite a row the user manually overrode.
      const existing = await prisma.citationVerification.findUnique({
        where: {
          subsectionId_bibliographyId_page_quoteHash: {
            subsectionId: m.subsectionId,
            bibliographyId: m.bibliographyId,
            page: pageDb,
            quoteHash: hash,
          },
        },
        select: { id: true, userOverride: true },
      });

      if (existing?.userOverride) {
        // User pinned the verdict — keep DB row as-is, but still
        // return the user's verdict in results.
        const row = await prisma.citationVerification.findUnique({
          where: { id: existing.id },
        });
        if (row) {
          tally[row.status]++;
          results.push({
            key: m.key,
            status: row.status,
            matchedPage: row.matchedPage,
            matchScore: row.matchScore,
            matchMethod: row.matchMethod,
          });
        }
        continue;
      }

      if (existing) {
        await prisma.citationVerification.update({
          where: { id: existing.id },
          data: {
            status: result.status,
            matchScore: result.matchScore,
            matchMethod: result.matchMethod,
            matchedPage: result.matchedPage,
            matchedSnippet: result.matchedSnippet,
            verifiedAt: new Date(),
          },
        });
      } else {
        await prisma.citationVerification.create({
          data: {
            projectId,
            subsectionId: m.subsectionId,
            bibliographyId: m.bibliographyId,
            page: pageDb,
            quoteHash: hash,
            status: result.status,
            matchScore: result.matchScore,
            matchMethod: result.matchMethod,
            matchedPage: result.matchedPage,
            matchedSnippet: result.matchedSnippet,
            verifiedAt: new Date(),
          },
        });
      }
      tally[result.status]++;
      results.push({
        key: m.key,
        status: result.status,
        matchedPage: result.matchedPage,
        matchScore: result.matchScore,
        matchMethod: result.matchMethod,
      });
    }

    return NextResponse.json({
      verified: tally.verified,
      suspected: tally.suspected,
      failed: tally.failed,
      total: filtered.length,
      results,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[POST /api/projects/[id]/citations/verify]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
