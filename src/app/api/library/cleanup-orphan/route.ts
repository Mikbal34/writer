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
  const body = (await req.json().catch(() => ({}))) as { entryId?: string };
  if (!body.entryId) {
    return NextResponse.json({ error: "entryId required" }, { status: 400 });
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
