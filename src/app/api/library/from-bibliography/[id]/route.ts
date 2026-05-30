/**
 * POST /api/library/from-bibliography/[id]
 *
 * Bibliography'i kullanıcının kütüphanesine taşır (reverse promote).
 * Akışı:
 *   1. Bibliography'i fetch et — proje sahibi auth'lı kullanıcı olmalı.
 *   2. Zaten libraryEntryId varsa → kütüphanede; "matched" döner.
 *   3. Aynı user + authorSurname + title + entryType eşleşmesi varsa
 *      mevcut LibraryEntry'e bağla → "matched".
 *   4. Yoksa yeni metadata-only LibraryEntry yarat ve bibliography'i
 *      bağla → "created".
 *
 * PDF işlemi YOK — kullanıcı kütüphane sayfasından upload eder.
 * Bu endpoint sadece künyeyi kütüphane yörüngesine alır.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth";
import { prisma } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;
    const { id: bibId } = await ctx.params;

    const bib = await prisma.bibliography.findFirst({
      where: { id: bibId, project: { userId } },
      select: {
        id: true,
        libraryEntryId: true,
        entryType: true,
        authorSurname: true,
        authorName: true,
        coAuthors: true,
        title: true,
        shortTitle: true,
        editor: true,
        translator: true,
        publisher: true,
        publishPlace: true,
        year: true,
        volume: true,
        edition: true,
        journalName: true,
        journalVolume: true,
        journalIssue: true,
        pageRange: true,
        doi: true,
        url: true,
        accessDate: true,
        metadata: true,
      },
    });

    if (!bib) {
      return NextResponse.json({ error: "Bibliography not found" }, { status: 404 });
    }

    if (bib.libraryEntryId) {
      return NextResponse.json({ matched: true, libraryEntryId: bib.libraryEntryId });
    }

    // Aynı kullanıcının kütüphanesinde author+title+type eşleşmesi
    // var mı — varsa yeniden yaratma, mevcudu bağla.
    const existing = await prisma.libraryEntry.findFirst({
      where: {
        userId,
        entryType: bib.entryType,
        authorSurname: bib.authorSurname,
        title: bib.title,
      },
      select: { id: true },
    });

    let libraryEntryId: string;
    let matched = false;
    if (existing) {
      libraryEntryId = existing.id;
      matched = true;
    } else {
      const created = await prisma.libraryEntry.create({
        data: {
          userId,
          entryType: bib.entryType,
          authorSurname: bib.authorSurname,
          authorName: bib.authorName,
          coAuthors: bib.coAuthors ?? undefined,
          title: bib.title,
          shortTitle: bib.shortTitle,
          editor: bib.editor,
          translator: bib.translator,
          publisher: bib.publisher,
          publishPlace: bib.publishPlace,
          year: bib.year,
          volume: bib.volume,
          edition: bib.edition,
          journalName: bib.journalName,
          journalVolume: bib.journalVolume,
          journalIssue: bib.journalIssue,
          pageRange: bib.pageRange,
          doi: bib.doi,
          url: bib.url,
          accessDate: bib.accessDate,
          metadata: bib.metadata ?? undefined,
          importSource: "manual",
        },
        select: { id: true },
      });
      libraryEntryId = created.id;
    }

    await prisma.bibliography.update({
      where: { id: bibId },
      data: { libraryEntryId },
    });

    return NextResponse.json({ matched, libraryEntryId });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[POST /api/library/from-bibliography/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
