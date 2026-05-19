/**
 * Smart provider routing for academic search.
 *
 * Fanning every query out across all 8 providers in parallel works
 * for English STEM queries but wastes time + tokens + rate-limit
 * budget on the long tail. arXiv has no Turkish humanities papers;
 * bioRxiv won't help you find a kelâm tezi. The slowest provider
 * sets the visible latency, so even one irrelevant call can add
 * 2–3 seconds for nothing.
 *
 * Heuristic-only — cheap, deterministic, no LLM call. Wrong
 * predictions are recoverable because users can explicitly toggle
 * provider chips in the UI, and the underlying searchAcademic()
 * is unchanged. So this module is purely "what should we hit by
 * default for this query."
 *
 * Two always-on providers (openalex + crossref) anchor every
 * search so we can't silently produce zero results from over-
 * aggressive filtering. The rest opt in by signal.
 */

export type ProviderName =
  | "openalex"
  | "semantic_scholar"
  | "crossref"
  | "google_books"
  | "arxiv"
  | "pmc"
  | "doaj"
  | "biorxiv";

const ALL: ProviderName[] = [
  "openalex",
  "semantic_scholar",
  "crossref",
  "google_books",
  "arxiv",
  "pmc",
  "doaj",
  "biorxiv",
];

// Always queried — broad multilingual coverage, good baseline.
const ALWAYS: ProviderName[] = ["openalex", "crossref"];

export interface RoutingSignals {
  query: string;
  type?: "makale" | "kitap" | "tez";
  /** Caller-side explicit override — when the user toggled chips
   *  in the UI, respect their selection and skip auto-routing. */
  explicit?: ProviderName[];
}

export interface RoutingDecision {
  providers: ProviderName[];
  skipped: ProviderName[];
  /** Human-readable reasons for telemetry / debug overlays. */
  reasons: string[];
}

// Cheap script detection. We're not perfect-detecting language,
// just answering "is this query reachable by Anglo-American
// preprint servers?"
function isLatinDominant(s: string): boolean {
  const letters = s.match(/[A-Za-zÇŞĞÜÖİçşğüöı؀-ۿ]/g) ?? [];
  if (letters.length === 0) return true; // pure-digit / DOI / id query
  const latin = letters.filter((c) => /[A-Za-z]/.test(c)).length;
  return latin / letters.length >= 0.7;
}

function hasTurkishMarks(s: string): boolean {
  return /[çğıİöşüÇĞÖŞÜ]/.test(s);
}

function hasArabicScript(s: string): boolean {
  return /[؀-ۿݐ-ݿ]/.test(s);
}

function looksLikeDoi(s: string): boolean {
  return /\b10\.\d{4,9}\/\S+\b/.test(s);
}

const MED_TERMS = /\b(clinical|patient|trial|disease|cancer|tumor|tumour|gene|protein|cell|enzyme|DNA|RNA|mRNA|vaccine|therapy|diagnosis|pharmac|virus|bacterial|infection|epidem)/i;
const BIO_TERMS = /\b(species|ecology|evolution|phylogen|enzyme|microb|organism|chromosom)/i;
const CS_TERMS = /\b(algorithm|neural|machine learning|deep learning|transformer|nlp|computer vision|gpu|tensor|reinforcement|distributed system)/i;
const PHYSICS_TERMS = /\b(quantum|relativity|particle|astrophys|cosmolog|condensed matter|black hole)/i;

export function routeProviders(signals: RoutingSignals): RoutingDecision {
  if (signals.explicit && signals.explicit.length > 0) {
    return {
      providers: signals.explicit,
      skipped: ALL.filter((p) => !signals.explicit!.includes(p)),
      reasons: ["explicit provider selection from caller"],
    };
  }

  const q = signals.query;
  const picked = new Set<ProviderName>(ALWAYS);
  const reasons: string[] = ["openalex+crossref always on"];

  // DOI lookup → degenerate case, only need authority sources.
  if (looksLikeDoi(q)) {
    return {
      providers: ["crossref", "openalex"],
      skipped: ALL.filter((p) => p !== "crossref" && p !== "openalex"),
      reasons: ["DOI detected — querying authority sources only"],
    };
  }

  const turkishSignal = hasTurkishMarks(q);
  const arabicSignal = hasArabicScript(q);
  const latinDominant = isLatinDominant(q);
  const nonEnglishHumanities = (turkishSignal || arabicSignal) && !latinDominant;

  // Semantic Scholar — broad coverage but predominantly English.
  // Worth including unless we're sure the corpus is unreachable.
  if (!arabicSignal) {
    picked.add("semantic_scholar");
    reasons.push("semantic_scholar: broad enough for non-Arabic queries");
  } else {
    reasons.push("semantic_scholar: skipped (Arabic-script query)");
  }

  // DOAJ — open-access journals worldwide, multilingual coverage.
  // Cheap to call, keep it on by default.
  picked.add("doaj");
  reasons.push("doaj: cheap and multilingual");

  // Type filter overrides language for books.
  if (signals.type === "kitap" || /\b(kitap|book|monograph)\b/i.test(q)) {
    picked.add("google_books");
    reasons.push("google_books: query suggests book");
  } else if (signals.type === "makale" || signals.type === "tez") {
    reasons.push("google_books: skipped (article/thesis intent)");
  } else if (latinDominant && !nonEnglishHumanities) {
    // Latin-script general query — books may still be relevant.
    picked.add("google_books");
    reasons.push("google_books: Latin-dominant general query");
  }

  // English-only preprint + biomed servers — skip everything but
  // clear positive signals to keep them on.
  if (latinDominant && !turkishSignal && !arabicSignal) {
    if (CS_TERMS.test(q) || PHYSICS_TERMS.test(q)) {
      picked.add("arxiv");
      reasons.push("arxiv: CS/physics keywords detected");
    }
    if (MED_TERMS.test(q)) {
      picked.add("pmc");
      reasons.push("pmc: biomedical keywords detected");
    }
    if (MED_TERMS.test(q) || BIO_TERMS.test(q)) {
      picked.add("biorxiv");
      reasons.push("biorxiv: biology/medical keywords detected");
    }
  } else {
    reasons.push("arxiv/pmc/biorxiv: skipped (non-English query)");
  }

  const providers = ALL.filter((p) => picked.has(p));
  return {
    providers,
    skipped: ALL.filter((p) => !picked.has(p)),
    reasons,
  };
}
