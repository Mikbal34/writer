/**
 * POST /api/library/eval  — internal RAG evaluation harness.
 *
 * Runs the SAME retrieval path the chat uses (query embed →
 * hybrid vector+FTS → RRF → Haiku rerank → top-K), generates a
 * grounded answer, and — when `expected` criteria are supplied —
 * has a Haiku judge score the answer. Returns everything as JSON
 * so `scripts/rag-eval.mjs` can run a question set and print a
 * scorecard without touching the streaming chat endpoint or
 * needing a user session.
 *
 * NOT user-facing. Admin-secret guarded. Measures end-to-end RAG
 * quality (retrieval + answer), the layer we just rebuilt
 * (worker fix → sectionTitle/pdfPageLabel, 001 model, etc.).
 * Delete the endpoint + script once the measurement work is done.
 *
 * Library scoping: the corpus is per-user, so we resolve the
 * owner of the most LibraryEntries and evaluate against that
 * library (the dev's own). Override with body.userId if needed.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateJSONWithUsage, SONNET, HAIKU } from "@/lib/claude";
import { ftsChunks, rrfMerge, type RetrievedRow } from "@/lib/hybrid-retrieval";
import { rerankChunks } from "@/lib/rerank";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";
const RETRIEVAL_POOL = 30;
const TOP_K = 8;

async function embedQueryText(text: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${PYTHON_SERVICE_URL}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: [text] }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { embeddings: number[][] };
    return data.embeddings?.[0] ?? null;
  } catch {
    return null;
  }
}

const ANSWER_SYSTEM =
  "Sen kullanıcının PDF kütüphanesi üzerinde çalışan bir araştırma " +
  "asistanısın. Türkçe yanıtla. Her bilgi parçasını [1], [2] gibi " +
  "numaralı atıflarla işaretle. Excerpt'lerde olmayan bir iddiada " +
  "BULUNMA. Kaynaklarda cevap yoksa açıkça 'Verilen kaynaklarda bu " +
  "soruyu doğrudan yanıtlayan pasaj yok' de. Sadece sana verilen [n] " +
  'numaralarını kullan. Output ONLY JSON: { "answer": "..." }';

const JUDGE_SYSTEM =
  "You are a strict evaluator of a RAG system's answer. Given the " +
  "question, the answer, the source excerpts the answer was built " +
  "from, and what a good answer should cover, score the answer 0-10 " +
  "on three axes:\n" +
  "- groundedness: every claim is supported by the excerpts, nothing " +
  "fabricated (0 = hallucinated, 10 = fully grounded)\n" +
  "- relevance: directly answers the question (0 = off-topic, 10 = " +
  "bullseye)\n" +
  "- citations: claims carry [n] citations to the excerpts\n" +
  "Be harsh: a fluent answer with an unsupported claim scores low on " +
  "groundedness. An honest 'not in sources' when the excerpts truly " +
  "lack the answer is CORRECT and scores high.\n" +
  'Output ONLY JSON: { "groundedness": n, "relevance": n, ' +
  '"citations": n, "overall": n, "reason": "one sentence" }';

interface RequestBody {
  question?: string;
  expected?: string;
  userId?: string;
}

export async function POST(req: NextRequest) {
  const adminSecret = process.env.ADMIN_SESSION_SECRET;
  const secret = req.headers.get("x-admin-secret");
  if (!adminSecret || secret !== adminSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as RequestBody;
  const question = (body.question ?? "").trim();
  if (!question) {
    return NextResponse.json({ error: "question required" }, { status: 400 });
  }

  // Resolve library owner (most entries) unless caller pins userId.
  let userId = body.userId;
  if (!userId) {
    const [owner] = await prisma.$queryRawUnsafe<Array<{ userId: string }>>(
      `SELECT "userId" FROM "LibraryEntry" GROUP BY "userId" ORDER BY COUNT(*) DESC LIMIT 1`,
    );
    userId = owner?.userId;
  }
  if (!userId) {
    return NextResponse.json({ error: "no library found" }, { status: 404 });
  }

  // ── Retrieval (same path as chat) ───────────────────────────
  const queryVec = await embedQueryText(question);
  if (!queryVec) {
    return NextResponse.json(
      { error: "embedding failed (python service?)" },
      { status: 502 },
    );
  }
  const vecLiteral = JSON.stringify(queryVec);
  const [vecChunks, lexChunks] = await Promise.all([
    prisma.$queryRaw<RetrievedRow[]>`
      SELECT lc.id AS id, 'chunk' AS kind, le.id AS "entryId",
             lc."volumeId" AS "volumeId", le.title AS title,
             le."authorSurname" AS "authorSurname", lc."pageNumber" AS "pageNumber",
             lc."pdfPageLabel" AS "pdfPageLabel", lc."sectionTitle" AS "sectionTitle",
             lc.content AS content, NULL AS "noteTitle"
      FROM "LibraryChunk" lc
      JOIN "LibraryEntry" le ON lc."libraryEntryId" = le.id
      WHERE le."userId" = ${userId} AND lc.embedding IS NOT NULL
      ORDER BY lc.embedding <=> ${vecLiteral}::vector
      LIMIT ${RETRIEVAL_POOL}
    `,
    ftsChunks(userId, question, null, RETRIEVAL_POOL).catch(() => [] as RetrievedRow[]),
  ]);
  let pool = rrfMerge(vecChunks, lexChunks).slice(0, RETRIEVAL_POOL);

  // Rerank to top-K.
  if (pool.length > TOP_K) {
    const ranked = await rerankChunks(
      question,
      pool.map((c) => ({
        id: c.id,
        content: c.content,
        title: c.title,
        sectionTitle: c.sectionTitle,
        pageLabel: c.pdfPageLabel,
      })),
    );
    const order = new Map(ranked.map((r, i) => [r.id, i]));
    pool = pool
      .slice()
      .sort(
        (a, b) =>
          (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity),
      )
      .slice(0, TOP_K);
  }

  const excerptBlock = pool
    .map((c, i) => {
      const author = c.authorSurname ? `${c.authorSurname}, ` : "";
      const page = c.pdfPageLabel ?? c.pageNumber;
      const pageStr = page != null ? ` (s. ${page})` : "";
      return `[${i + 1}] ${author}${c.title}${pageStr}\n${c.content}`;
    })
    .join("\n\n");

  // ── Answer ──────────────────────────────────────────────────
  const answerRes = await generateJSONWithUsage<{ answer?: string }>(
    `KAYNAK EXCERPTS:\n${excerptBlock}\n\nSORU: ${question}`,
    ANSWER_SYSTEM,
    { model: SONNET },
  );
  const answer = answerRes.data?.answer ?? "";

  // ── Judge (optional) ────────────────────────────────────────
  let judge: Record<string, unknown> | null = null;
  if (body.expected) {
    const judgeRes = await generateJSONWithUsage<Record<string, unknown>>(
      `QUESTION: ${question}\n\nANSWER:\n${answer}\n\nSOURCE EXCERPTS:\n${excerptBlock}\n\nWHAT A GOOD ANSWER SHOULD COVER:\n${body.expected}`,
      JUDGE_SYSTEM,
      { model: HAIKU },
    );
    judge = judgeRes.data ?? null;
  }

  return NextResponse.json({
    question,
    answer,
    judge,
    sources: pool.map((c, i) => ({
      n: i + 1,
      title: c.title,
      page: c.pdfPageLabel ?? c.pageNumber,
      section: c.sectionTitle,
      snippet: c.content.slice(0, 160),
    })),
    retrievedCount: pool.length,
  });
}
