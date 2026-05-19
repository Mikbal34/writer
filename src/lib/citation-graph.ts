/**
 * Snowball / citation chasing.
 *
 * Given a seed paper (by DOI, OpenAlex ID, or Semantic Scholar ID),
 * pull both directions of its citation graph:
 *
 *   backward  — papers the seed cites    (its bibliography)
 *   forward   — papers that cite the seed (impact / follow-up work)
 *
 * The classic academic "snowball" method does this manually by
 * walking from bibliography to bibliography; this module
 * mechanises one hop. Combine with the rerank pipeline downstream
 * and the user can grow a literature net around any seminal paper
 * in seconds instead of an afternoon.
 *
 * Provider strategy: OpenAlex first (250M+ works, no rate-limit
 * pain, citation graph included on every Work record). Semantic
 * Scholar as a fallback / enrichment source — its DBLP / venue
 * coverage is better for CS-adjacent fields, and it surfaces a
 * different slice of forward citations.
 *
 * Returned shape mirrors AcademicSearchResult so the existing
 * dedup / scoring / "already in library" pipeline can consume it
 * unchanged.
 */

import type { AcademicSearchResult } from "@/lib/academic-search";

const POLITE_EMAIL = process.env.UNPAYWALL_EMAIL || "quilpen@example.com";

export interface CitationSeed {
  /** At least one of these must be present. We prefer OpenAlex
   *  IDs because they round-trip through the OpenAlex citation
   *  graph natively; DOIs work too but cost an extra lookup. */
  openalexId?: string | null;
  doi?: string | null;
  semanticScholarId?: string | null;
  /** Display title — used as a fallback search query if no
   *  identifier resolves. */
  title?: string | null;
}

export interface CitationChaseOptions {
  /** Max papers per direction. Default 50 each so we have a wide
   *  pool to rerank against the user's original query. */
  limit?: number;
  /** When true, dedupe forward & backward into a single list so
   *  the caller doesn't see the same paper twice (commonly a
   *  paper cites X and is also cited by X — though rare).  */
  dedupe?: boolean;
}

export interface CitationChaseResult {
  backward: AcademicSearchResult[];
  forward: AcademicSearchResult[];
  seedTitle: string | null;
  seedAuthors: string[] | null;
}

// ── OpenAlex helpers ──────────────────────────────────────────────

interface OpenAlexAuthor {
  author?: {
    display_name?: string;
  };
}

interface OpenAlexWork {
  id?: string;
  doi?: string | null;
  title?: string | null;
  publication_year?: number | null;
  cited_by_count?: number | null;
  type?: string | null;
  authorships?: OpenAlexAuthor[];
  primary_location?: {
    source?: {
      display_name?: string | null;
      publisher?: string | null;
    } | null;
  } | null;
  open_access?: {
    is_oa?: boolean;
    oa_url?: string | null;
  } | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  referenced_works?: string[];
}

function decodeInvertedAbstract(
  index: Record<string, number[]> | null | undefined,
): string | null {
  if (!index) return null;
  const positions: Array<{ word: string; pos: number }> = [];
  for (const [word, occurrences] of Object.entries(index)) {
    for (const pos of occurrences) positions.push({ word, pos });
  }
  positions.sort((a, b) => a.pos - b.pos);
  return positions.map((p) => p.word).join(" ") || null;
}

function mapOpenAlexType(t: string | null | undefined): string {
  if (!t) return "makale";
  const lower = t.toLowerCase();
  if (lower.includes("book")) return "kitap";
  if (lower.includes("dissertation") || lower.includes("thesis")) return "tez";
  return "makale";
}

function splitAuthor(displayName: string): {
  surname: string;
  firstName: string | null;
} {
  if (!displayName) return { surname: "Unknown", firstName: null };
  const parts = displayName.trim().split(/\s+/);
  if (parts.length === 1) return { surname: parts[0], firstName: null };
  return {
    surname: parts[parts.length - 1],
    firstName: parts.slice(0, -1).join(" "),
  };
}

function workToResult(w: OpenAlexWork): AcademicSearchResult | null {
  if (!w.title) return null;
  const authors = (w.authorships ?? [])
    .map((a) => a.author?.display_name)
    .filter((n): n is string => typeof n === "string" && n.length > 0);
  const first = authors[0] ? splitAuthor(authors[0]) : { surname: "Unknown", firstName: null };
  const doi = w.doi
    ? w.doi.replace(/^https?:\/\/doi\.org\//i, "")
    : null;
  return {
    externalId: w.id ?? doi ?? `oa-${Math.random().toString(36).slice(2, 10)}`,
    provider: "openalex",
    title: w.title,
    authorSurname: first.surname,
    authorName: first.firstName,
    authors,
    year: w.publication_year ? String(w.publication_year) : null,
    publisher: w.primary_location?.source?.publisher ?? null,
    journalName: w.primary_location?.source?.display_name ?? null,
    journalVolume: null,
    journalIssue: null,
    pageRange: null,
    doi,
    url: w.id ?? (doi ? `https://doi.org/${doi}` : null),
    abstract: decodeInvertedAbstract(w.abstract_inverted_index ?? null),
    citationCount: typeof w.cited_by_count === "number" ? w.cited_by_count : null,
    entryType: mapOpenAlexType(w.type),
    openAccessUrl: w.open_access?.oa_url ?? null,
  };
}

async function fetchOpenAlexWork(
  seed: CitationSeed,
): Promise<OpenAlexWork | null> {
  // Prefer OpenAlex ID, then DOI, then title fallback.
  if (seed.openalexId) {
    const id = seed.openalexId.startsWith("https://")
      ? seed.openalexId
      : `https://openalex.org/${seed.openalexId.replace(/^W?/, "W")}`;
    const url = `${id}?mailto=${POLITE_EMAIL}`;
    try {
      const r = await fetch(url);
      if (r.ok) return (await r.json()) as OpenAlexWork;
    } catch {
      /* fall through */
    }
  }
  if (seed.doi) {
    const url = `https://api.openalex.org/works/https://doi.org/${seed.doi}?mailto=${POLITE_EMAIL}`;
    try {
      const r = await fetch(url);
      if (r.ok) return (await r.json()) as OpenAlexWork;
    } catch {
      /* fall through */
    }
  }
  if (seed.title) {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(seed.title)}&per_page=1&mailto=${POLITE_EMAIL}`;
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      const data = (await r.json()) as { results?: OpenAlexWork[] };
      return data.results?.[0] ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

async function fetchOpenAlexWorksByIds(
  ids: string[],
): Promise<OpenAlexWork[]> {
  if (ids.length === 0) return [];
  // OpenAlex filter param accepts a pipe-separated id list; cap at
  // 50 ids per request to stay under URL length limits.
  const out: OpenAlexWork[] = [];
  for (let i = 0; i < ids.length; i += 40) {
    const slice = ids.slice(i, i + 40);
    // Normalise to short IDs ("W2762981870") for the filter.
    const filterIds = slice
      .map((id) => id.replace(/^https?:\/\/openalex\.org\//, ""))
      .join("|");
    const url = `https://api.openalex.org/works?filter=ids.openalex:${filterIds}&per_page=50&mailto=${POLITE_EMAIL}`;
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const data = (await r.json()) as { results?: OpenAlexWork[] };
      if (data.results) out.push(...data.results);
    } catch {
      /* skip this slice */
    }
  }
  return out;
}

async function fetchOpenAlexForwardCitations(
  seedId: string,
  limit: number,
): Promise<OpenAlexWork[]> {
  const id = seedId.replace(/^https?:\/\/openalex\.org\//, "");
  // sort=cited_by_count:desc surfaces the most-cited follow-ups
  // first — almost always what the user actually wants.
  const url = `https://api.openalex.org/works?filter=cites:${id}&per_page=${Math.min(limit, 50)}&sort=cited_by_count:desc&mailto=${POLITE_EMAIL}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return [];
    const data = (await r.json()) as { results?: OpenAlexWork[] };
    return data.results ?? [];
  } catch {
    return [];
  }
}

// ── Public API ────────────────────────────────────────────────────

export async function chaseCitations(
  seed: CitationSeed,
  options: CitationChaseOptions = {},
): Promise<CitationChaseResult> {
  const limit = options.limit ?? 50;
  const seedWork = await fetchOpenAlexWork(seed);
  if (!seedWork) {
    return {
      backward: [],
      forward: [],
      seedTitle: seed.title ?? null,
      seedAuthors: null,
    };
  }

  const seedTitle = seedWork.title ?? seed.title ?? null;
  const seedAuthors =
    (seedWork.authorships ?? [])
      .map((a) => a.author?.display_name)
      .filter((n): n is string => typeof n === "string") || null;

  // Backward: fetch every referenced_works entry. OpenAlex returns
  // them as full URIs; batch-fetch their work records so we can
  // populate the AcademicSearchResult shape.
  const refIds = (seedWork.referenced_works ?? []).slice(0, limit);
  const backwardWorks = refIds.length > 0
    ? await fetchOpenAlexWorksByIds(refIds)
    : [];

  // Forward: query OpenAlex for "what cites this seed", sorted by
  // citation count so highest-impact follow-ups float up.
  const forwardWorks = seedWork.id
    ? await fetchOpenAlexForwardCitations(seedWork.id, limit)
    : [];

  const backward = backwardWorks
    .map(workToResult)
    .filter((r): r is AcademicSearchResult => r !== null);
  const forward = forwardWorks
    .map(workToResult)
    .filter((r): r is AcademicSearchResult => r !== null);

  if (options.dedupe) {
    const seen = new Set<string>();
    const merge = (list: AcademicSearchResult[]) =>
      list.filter((r) => {
        const key = (r.doi ?? r.externalId).toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    return {
      backward: merge(backward),
      forward: merge(forward),
      seedTitle,
      seedAuthors,
    };
  }

  return { backward, forward, seedTitle, seedAuthors };
}
