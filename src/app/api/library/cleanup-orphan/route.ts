/**
 * POST /api/library/cleanup-orphan
 *
 * One-shot admin maintenance endpoint. Deletes a single library
 * entry by id (and via cascade, all its chunks / notes /
 * highlights). Use when the ingest pipeline left a half-baked
 * row that the UI's normal delete path can't reach — e.g. an
 * entry whose metadata update crashed mid-flight so the title
 * stayed as the temp filename.
 *
 * Will be removed once we add proper UI-side delete-on-failure
 * handling for stuck uploads.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const adminSecret = process.env.ADMIN_SESSION_SECRET;
  const secret = req.headers.get("x-admin-secret");
  if (!adminSecret || secret !== adminSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    entryId?: string;
    entryIds?: string[];
    // Bulk: delete every no-file entry (filePath + openAccessUrl null)
    // for a given user — the partial-text backlog we're re-uploading.
    scope?: "nofile";
    userId?: string;
    dryRun?: boolean;
  };

  // ── Bulk: scope=nofile ──────────────────────────────────────
  if (body.scope === "nofile") {
    if (!body.userId) {
      return NextResponse.json({ error: "userId required for scope" }, { status: 400 });
    }
    const targets = await prisma.libraryEntry.findMany({
      where: { userId: body.userId, filePath: null, openAccessUrl: null },
      select: { id: true, title: true },
    });
    if (body.dryRun) {
      return NextResponse.json({ dryRun: true, count: targets.length, titles: targets.map((t) => t.title) });
    }
    const ids = targets.map((t) => t.id);
    const del = await prisma.libraryEntry.deleteMany({ where: { id: { in: ids } } });
    return NextResponse.json({ ok: true, deletedCount: del.count, titles: targets.map((t) => t.title) });
  }

  // ── Bulk: explicit entryIds ─────────────────────────────────
  if (Array.isArray(body.entryIds) && body.entryIds.length > 0) {
    const del = await prisma.libraryEntry.deleteMany({
      where: { id: { in: body.entryIds } },
    });
    return NextResponse.json({ ok: true, deletedCount: del.count });
  }

  // ── Single entry ────────────────────────────────────────────
  if (!body.entryId) {
    return NextResponse.json({ error: "entryId | entryIds | scope required" }, { status: 400 });
  }
  const entry = await prisma.libraryEntry.findUnique({
    where: { id: body.entryId },
    select: {
      id: true,
      title: true,
      pdfStatus: true,
      _count: { select: { chunks: true, notes: true, highlights: true } },
    },
  });
  if (!entry) {
    return NextResponse.json({ error: "entry not found" }, { status: 404 });
  }
  await prisma.libraryEntry.delete({ where: { id: body.entryId } });
  return NextResponse.json({
    ok: true,
    deleted: {
      id: entry.id,
      title: entry.title,
      pdfStatus: entry.pdfStatus,
      chunks: entry._count.chunks,
      notes: entry._count.notes,
      highlights: entry._count.highlights,
    },
  });
}
