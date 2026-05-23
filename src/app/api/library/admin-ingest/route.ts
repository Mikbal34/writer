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
import { savePdfBytesR2, saveVolumePdfBytesR2 } from "@/lib/r2-storage";
import { enqueueIngest } from "@/lib/queue";
import {
  ingestExtractedTextForEntry,
  ingestExtractedTextForVolume,
} from "@/lib/library-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BYTES = 200 * 1024 * 1024; // big scanned single-file works (e.g. 2260-page Taberi ≈ 62 MB)

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

  const hasFile = file instanceof File;
  // A file is normally required, but when ocrText is supplied the text alone
  // is enough to ingest (chunks + RAG). Used for giant scanned PDFs whose
  // file is too large to upload through the edge — the viewer PDF can be
  // attached separately later.
  if (!hasFile && !ocrPages) {
    return NextResponse.json({ error: "file or ocrText required" }, { status: 400 });
  }
  if (!userId || !title) {
    return NextResponse.json({ error: "userId + title required" }, { status: 400 });
  }
  let fileType: "pdf" | "epub" | "docx" = "pdf";
  if (hasFile) {
    if (file.size === 0 || file.size > MAX_BYTES) {
      return NextResponse.json({ error: "bad file size" }, { status: 400 });
    }
    const ft = fileTypeFromName(file.name);
    if (!ft) {
      return NextResponse.json({ error: "pdf/epub/docx only" }, { status: 400 });
    }
    fileType = ft;
  }
  const owner = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!owner) {
    return NextResponse.json({ error: "userId not found" }, { status: 404 });
  }

  const bytes = hasFile ? Buffer.from(await file.arrayBuffer()) : null;

  // ── single-file work ────────────────────────────────────────
  if (mode === "single") {
    const entry = await prisma.libraryEntry.create({
      data: {
        userId,
        entryType: "kitap",
        title,
        authorSurname: `(Yükleme ${randomUUID().slice(0, 8)})`,
        importSource: "admin-ingest",
        pdfStatus: ocrPages ? "extracting" : "queued",
        fileType,
        keywords: [],
      },
      select: { id: true },
    });
    if (hasFile && bytes) {
      try {
        const filePath = await savePdfBytesR2(userId, entry.id, bytes, fileType);
        await prisma.libraryEntry.update({ where: { id: entry.id }, data: { filePath } });
      } catch (err) {
        console.error("[admin-ingest] R2 save failed", entry.id, err);
        if (!ocrPages) {
          await prisma.libraryEntry.update({
            where: { id: entry.id },
            data: { pdfStatus: "failed", pdfError: "Dosya depolanamadı (R2)" },
          });
          return NextResponse.json({ error: "storage failed" }, { status: 502 });
        }
      }
    }
    if (ocrPages) {
      // Pre-extracted OCR text lives in the request, not R2 — ingest it
      // synchronously (admin batch tool paces itself via pdfStatus polling).
      setImmediate(() => {
        ingestExtractedTextForEntry(entry.id, ocrPages, { enrich: true })
          .catch((e) => console.error("[admin-ingest] OCR ingest failed", entry.id, e));
      });
    } else {
      await enqueueIngest({ kind: "entry", entryId: entry.id, filename: (file as File).name }, { batch: true });
    }
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
      pdfStatus: ocrPages ? "extracting" : "queued",
      fileType,
    },
    select: { id: true },
  });
  if (hasFile && bytes) {
    try {
      const filePath = await saveVolumePdfBytesR2(userId, entryId, volume.id, bytes, fileType);
      await prisma.libraryEntryVolume.update({ where: { id: volume.id }, data: { filePath } });
    } catch (err) {
      console.error("[admin-ingest] volume R2 save failed", volume.id, err);
      if (!ocrPages) {
        await prisma.libraryEntryVolume.update({
          where: { id: volume.id },
          data: { pdfStatus: "failed", pdfError: "Dosya depolanamadı (R2)" },
        });
        return NextResponse.json({ error: "storage failed" }, { status: 502 });
      }
    }
  }
  if (ocrPages) {
    setImmediate(() => {
      ingestExtractedTextForVolume(entryId!, volume.id, ocrPages)
        .catch((e) => console.error("[admin-ingest] volume OCR ingest failed", volume.id, e));
    });
  } else {
    await enqueueIngest({ kind: "volume", entryId: entryId!, volumeId: volume.id, filename: (file as File).name }, { batch: true });
  }
  return NextResponse.json({ entryId, volumeId: volume.id, volumeNumber, ocr: Boolean(ocrPages) });
}
