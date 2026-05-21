/**
 * POST /api/library/admin-ingest — admin-authed file ingest for bulk
 * re-upload of local PDFs (the no-file library backlog). Mirrors the
 * UI upload-pdf / volumes flow but authenticates with the admin
 * secret and writes to an explicit target userId, so a local script
 * can push the Desktop source folders straight into the right
 * library without a browser session.
 *
 * multipart/form-data:
 *   file        (required) the .pdf/.epub/.docx bytes
 *   userId      (required) target library owner
 *   title       (required) the work's display title
 *   mode        'single' | 'volume'
 *   entryId     (volume mode, optional) — omit on the FIRST volume to
 *               create the parent entry; pass it back for vols 2..N
 *   volumeNumber, volumeLabel (volume mode, optional)
 *
 * Returns { entryId, volumeId? }. Processing runs in setImmediate
 * (same as the UI path) — the caller polls pdfStatus to pace itself.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { savePdfBytes, saveVolumePdfBytes } from "@/lib/library-storage";
import {
  processLibraryPdfFromBytes,
  processLibraryVolumePdfFromBytes,
  ingestExtractedTextForEntry,
  ingestExtractedTextForVolume,
} from "@/lib/library-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BYTES = 60 * 1024 * 1024;

function fileTypeFromName(name: string): "pdf" | "epub" | "docx" | null {
  const l = name.toLowerCase();
  if (l.endsWith(".pdf")) return "pdf";
  if (l.endsWith(".epub")) return "epub";
  if (l.endsWith(".docx")) return "docx";
  return null;
}

export async function POST(req: NextRequest) {
  const adminSecret = process.env.ADMIN_SESSION_SECRET;
  const secret = req.headers.get("x-admin-secret");
  if (!adminSecret || secret !== adminSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const userId = String(form.get("userId") ?? "");
  const title = String(form.get("title") ?? "").trim();
  const mode = String(form.get("mode") ?? "single");
  const entryIdIn = form.get("entryId") ? String(form.get("entryId")) : null;
  const volumeNumberRaw = form.get("volumeNumber");
  const volumeLabel = form.get("volumeLabel")
    ? String(form.get("volumeLabel")).trim()
    : null;

  // Optional pre-extracted OCR text (Surya service output) — when present
  // we skip pdfjs/Tesseract and chunk this text directly, while still
  // saving the original PDF for the viewer. Accepts page_number|pageNumber.
  const ocrTextRaw = form.get("ocrText");
  let ocrPages: { pageNumber: number; text: string }[] | null = null;
  if (typeof ocrTextRaw === "string" && ocrTextRaw.trim()) {
    try {
      const parsed = JSON.parse(ocrTextRaw) as Array<{
        page_number?: number;
        pageNumber?: number;
        text?: string;
      }>;
      ocrPages = parsed
        .map((p) => ({
          pageNumber: Number(p.pageNumber ?? p.page_number ?? 0),
          text: String(p.text ?? ""),
        }))
        .filter((p) => p.pageNumber > 0 && p.text.trim().length > 0);
      if (ocrPages.length === 0) ocrPages = null;
    } catch {
      return NextResponse.json({ error: "bad ocrText json" }, { status: 400 });
    }
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  if (!userId || !title) {
    return NextResponse.json({ error: "userId + title required" }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: "bad file size" }, { status: 400 });
  }
  const fileType = fileTypeFromName(file.name);
  if (!fileType) {
    return NextResponse.json({ error: "pdf/epub/docx only" }, { status: 400 });
  }
  const owner = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!owner) {
    return NextResponse.json({ error: "userId not found" }, { status: 404 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // ── single-file work ────────────────────────────────────────
  if (mode === "single") {
    const entry = await prisma.libraryEntry.create({
      data: {
        userId,
        entryType: "kitap",
        title,
        authorSurname: `(Yükleme ${randomUUID().slice(0, 8)})`,
        importSource: "admin-ingest",
        pdfStatus: "extracting",
        fileType,
        keywords: [],
      },
      select: { id: true },
    });
    try {
      const filePath = await savePdfBytes(userId, entry.id, bytes, fileType);
      await prisma.libraryEntry.update({ where: { id: entry.id }, data: { filePath } });
    } catch (err) {
      console.error("[admin-ingest] save failed", entry.id, err);
    }
    setImmediate(() => {
      const job = ocrPages
        ? ingestExtractedTextForEntry(entry.id, ocrPages, { enrich: true })
        : processLibraryPdfFromBytes(entry.id, file.name, bytes);
      job.catch((e) => console.error("[admin-ingest] pipeline failed", entry.id, e));
    });
    return NextResponse.json({ entryId: entry.id, ocr: Boolean(ocrPages) });
  }

  // ── multi-volume work ───────────────────────────────────────
  // First volume (no entryId) creates the parent container entry;
  // subsequent volumes attach to it. The parent's own filePath stays
  // null — volumes hold the files.
  let entryId = entryIdIn;
  if (!entryId) {
    const entry = await prisma.libraryEntry.create({
      data: {
        userId,
        entryType: "kitap",
        title,
        authorSurname: `(Yükleme ${randomUUID().slice(0, 8)})`,
        importSource: "admin-ingest",
        pdfStatus: "none",
        fileType,
        keywords: [],
      },
      select: { id: true },
    });
    entryId = entry.id;
  }

  let volumeNumber: number;
  const parsed = typeof volumeNumberRaw === "string" ? parseInt(volumeNumberRaw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    volumeNumber = Math.floor(parsed);
  } else {
    const tail = await prisma.libraryEntryVolume.findFirst({
      where: { libraryEntryId: entryId },
      orderBy: { volumeNumber: "desc" },
      select: { volumeNumber: true },
    });
    volumeNumber = (tail?.volumeNumber ?? 0) + 1;
  }

  const volume = await prisma.libraryEntryVolume.create({
    data: {
      libraryEntryId: entryId,
      volumeNumber,
      label: volumeLabel,
      pdfStatus: "extracting",
      fileType,
    },
    select: { id: true },
  });
  try {
    const filePath = await saveVolumePdfBytes(userId, entryId, volume.id, bytes, fileType);
    await prisma.libraryEntryVolume.update({ where: { id: volume.id }, data: { filePath } });
  } catch (err) {
    console.error("[admin-ingest] volume save failed", volume.id, err);
  }
  setImmediate(() => {
    const job = ocrPages
      ? ingestExtractedTextForVolume(entryId!, volume.id, ocrPages)
      : processLibraryVolumePdfFromBytes(entryId!, volume.id, file.name, bytes);
    job.catch((e) => console.error("[admin-ingest] volume pipeline failed", volume.id, e));
  });
  return NextResponse.json({ entryId, volumeId: volume.id, volumeNumber, ocr: Boolean(ocrPages) });
}
