/**
 * POST /api/library/admin-attach-file — admin-authed: save a PDF file onto
 * an EXISTING library entry WITHOUT re-processing it. Use when an entry's
 * chunks were ingested separately (e.g. text-only OCR ingest of a giant
 * scanned book whose PDF was too large to upload with the text) and we just
 * want the viewer to have the original file. Does NOT touch chunks, status,
 * or embeddings — purely sets filePath.
 *
 * multipart/form-data: { file (pdf), entryId }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { savePdfBytes } from "@/lib/library-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BYTES = 200 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const adminSecret = process.env.ADMIN_SESSION_SECRET;
  if (!adminSecret || req.headers.get("x-admin-secret") !== adminSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const entryId = String(form.get("entryId") ?? "");
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: "bad file" }, { status: 400 });
  }
  if (!entryId) {
    return NextResponse.json({ error: "entryId required" }, { status: 400 });
  }

  const entry = await prisma.libraryEntry.findUnique({
    where: { id: entryId },
    select: { id: true, userId: true },
  });
  if (!entry) {
    return NextResponse.json({ error: "entry not found" }, { status: 404 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const filePath = await savePdfBytes(entry.userId, entry.id, bytes, "pdf");
  await prisma.libraryEntry.update({
    where: { id: entry.id },
    data: { filePath, fileType: "pdf" },
  });
  return NextResponse.json({ ok: true, entryId: entry.id, filePath });
}
