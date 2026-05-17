import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { requireAuth, AuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/account/diag/library
 *
 * Per-user diagnostic for the "PDF yüklenmedi" Railway puzzle. Reports:
 *
 *   - resolved storageRoot at runtime
 *   - storageRootExists / storageRootListing (top-level entries)
 *   - which envs influence the path
 *   - sample of this user's library entries with filePath + on-disk
 *     existence so we can tell DB-vs-disk drift apart from missing
 *     filePaths
 *
 * Auth-scoped to the caller — only your own entries, no cross-user
 * data leak.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolveStorageRoot(): string {
  const fromEnv = process.env.LIBRARY_PDF_STORAGE_ROOT;
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "production") return "/data/library-pdfs";
  return path.join(os.tmpdir(), "library-pdfs");
}

function safeStat(p: string): { exists: boolean; isDir: boolean; size?: number } {
  try {
    const s = fs.statSync(p);
    return { exists: true, isDir: s.isDirectory(), size: s.size };
  } catch {
    return { exists: false, isDir: false };
  }
}

function safeListing(p: string, max = 20): string[] | null {
  try {
    return fs.readdirSync(p).slice(0, max);
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const session = await requireAuth();
    const userId = session.user.id;

    const storageRoot = resolveStorageRoot();
    const rootStat = safeStat(storageRoot);
    const rootListing = rootStat.exists ? safeListing(storageRoot) : null;

    const userDir = path.join(storageRoot, userId.replace(/[^a-zA-Z0-9_-]/g, "_"));
    const userDirStat = safeStat(userDir);
    const userDirListing = userDirStat.exists ? safeListing(userDir, 40) : null;

    const entries = await prisma.libraryEntry.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        title: true,
        authorSurname: true,
        filePath: true,
        pdfStatus: true,
        pdfError: true,
      },
    });

    const entrySamples = entries.map((e) => {
      const stat = e.filePath ? safeStat(e.filePath) : { exists: false, isDir: false };
      return {
        id: e.id,
        title: e.title,
        authorSurname: e.authorSurname,
        pdfStatus: e.pdfStatus,
        pdfError: e.pdfError,
        filePath: e.filePath,
        filePathExists: stat.exists,
        filePathIsFile: stat.exists && !stat.isDir,
        filePathSize: stat.size ?? null,
      };
    });

    const counts = {
      totalEntries: entries.length,
      withFilePath: entries.filter((e) => !!e.filePath).length,
      filePathExists: entrySamples.filter((s) => s.filePathIsFile).length,
      pdfStatus: entries.reduce<Record<string, number>>((acc, e) => {
        acc[e.pdfStatus] = (acc[e.pdfStatus] ?? 0) + 1;
        return acc;
      }, {}),
    };

    return NextResponse.json({
      runtime: {
        nodeEnv: process.env.NODE_ENV ?? null,
        platform: process.platform,
        cwd: process.cwd(),
        tmpdir: os.tmpdir(),
      },
      env: {
        LIBRARY_PDF_STORAGE_ROOT: process.env.LIBRARY_PDF_STORAGE_ROOT ?? null,
      },
      storage: {
        resolvedRoot: storageRoot,
        rootExists: rootStat.exists,
        rootIsDir: rootStat.isDir,
        rootListing,
        userDir,
        userDirExists: userDirStat.exists,
        userDirIsDir: userDirStat.isDir,
        userDirListing,
      },
      counts,
      entrySamples,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[GET /api/account/diag/library]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
