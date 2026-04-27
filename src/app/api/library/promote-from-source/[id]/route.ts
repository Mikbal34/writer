import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { EntryType } from '@prisma/client'

type RouteContext = { params: Promise<{ id: string }> }

const VALID_ENTRY_TYPES = new Set(Object.values(EntryType))

function toEntryType(value: string | null | undefined): EntryType {
  if (value && VALID_ENTRY_TYPES.has(value as EntryType)) return value as EntryType
  return EntryType.kitap
}

/**
 * POST /api/library/promote-from-source/:id
 * Promote a project-level Source (uploaded PDF) to the user's library so
 * it becomes available cross-project. Reuses the already-embedded
 * SourceChunks by copying them into LibraryChunks — no re-processing.
 *
 * If a matching LibraryEntry already exists (same author+title), link to
 * it instead of duplicating.
 */
export async function POST(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id: sourceId } = await ctx.params

    const source = await prisma.source.findFirst({
      where: { id: sourceId, project: { userId: session.user.id } },
      include: {
        project: { select: { userId: true } },
        bibliography: true,
      },
    })
    if (!source) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 })
    }

    // The Source has 0..N Bibliography entries; prefer the richest one
    // (the one Haiku's source-upload extraction filled in).
    const bib = (source.bibliography ?? []).sort(
      (a, b) =>
        Number(!!b.year) - Number(!!a.year) +
        Number(!!b.doi) - Number(!!a.doi)
    )[0]

    if (!bib || !bib.title?.trim() || !bib.authorSurname?.trim()) {
      return NextResponse.json(
        { error: 'Source has no bibliography metadata — cannot promote' },
        { status: 400 }
      )
    }

    const userId = session.user.id

    // 1. Find or create the LibraryEntry.
    let entry = await prisma.libraryEntry.findUnique({
      where: {
        userId_authorSurname_title: {
          userId,
          authorSurname: bib.authorSurname,
          title: bib.title,
        },
      },
    })

    if (!entry) {
      entry = await prisma.libraryEntry.create({
        data: {
          userId,
          entryType: toEntryType(bib.entryType),
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
          importSource: 'pdf-upload',
          pdfStatus: 'ready',
          fileType: source.fileType,
          filePath: source.filePath,
        },
      })
    }

    // 2. Link the bibliography to the library entry (if not already).
    if (bib.libraryEntryId !== entry.id) {
      await prisma.bibliography.update({
        where: { id: bib.id },
        data: { libraryEntryId: entry.id },
      })
    }

    // 3. Copy SourceChunks → LibraryChunks (skip if library already has
    //    chunks for this entry — the copy is idempotent within a session
    //    but we never want duplicates).
    const existingCount = await prisma.libraryChunk.count({
      where: { libraryEntryId: entry.id },
    })

    let copiedCount = 0
    if (existingCount === 0) {
      const sourceChunks = await prisma.sourceChunk.findMany({
        where: { sourceId: source.id },
        select: {
          pageNumber: true,
          chunkIndex: true,
          content: true,
          metadata: true,
        },
        orderBy: [{ pageNumber: 'asc' }, { chunkIndex: 'asc' }],
      })

      if (sourceChunks.length > 0) {
        await prisma.libraryChunk.createMany({
          data: sourceChunks.map((c) => ({
            libraryEntryId: entry!.id,
            pageNumber: c.pageNumber,
            chunkIndex: c.chunkIndex,
            content: c.content,
            metadata: c.metadata as object | undefined,
          })),
        })

        // Copy embeddings over via raw SQL (pgvector column not directly
        // round-trippable through Prisma's createMany).
        await prisma.$executeRaw`
          UPDATE "LibraryChunk" AS lc
          SET embedding = sc.embedding
          FROM "SourceChunk" AS sc
          WHERE lc."libraryEntryId" = ${entry.id}
            AND sc."sourceId" = ${source.id}
            AND lc."pageNumber" IS NOT DISTINCT FROM sc."pageNumber"
            AND lc."chunkIndex" = sc."chunkIndex"
        `

        copiedCount = sourceChunks.length
      }
    }

    return NextResponse.json({
      libraryEntryId: entry.id,
      created: existingCount === 0,
      chunksCopied: copiedCount,
      chunksExisting: existingCount,
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library/promote-from-source]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
