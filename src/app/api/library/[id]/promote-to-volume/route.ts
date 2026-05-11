/**
 * POST /api/library/[id]/promote-to-volume
 *
 * Resolves the "this looks like Cilt N of X" suggestion Haiku raised
 * during enrichment. The current entry gets folded into a multi-volume
 * structure: its chunks are re-tagged to a fresh LibraryEntryVolume
 * row, its PDF is moved under the parent's directory, and the stub
 * entry itself is deleted (its bytes survive as the new volume).
 *
 * Two shapes for the body:
 *   - { parentEntryId, volumeNumber?, label? }  — attach to existing parent
 *   - { newParentTitle, newParentAuthorSurname?, newParentAuthorName?,
 *       volumeNumber?, label? }                 — create new parent first
 *
 * volumeNumber defaults to the Haiku-detected hint, or one past the
 * parent's current tail volume.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { moveToVolumePath } from '@/lib/library-storage'
import type { Prisma } from '@prisma/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

type DocFileType = 'pdf' | 'epub' | 'docx'

function asDocFileType(value: string | null | undefined): DocFileType {
  if (value === 'epub' || value === 'docx') return value
  return 'pdf'
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params
    const body = (await req.json().catch(() => ({}))) as {
      parentEntryId?: string
      newParentTitle?: string
      newParentAuthorSurname?: string
      newParentAuthorName?: string | null
      volumeNumber?: number
      label?: string | null
    }

    const entry = await prisma.libraryEntry.findFirst({
      where: { id, userId: session.user.id },
      select: {
        id: true,
        userId: true,
        title: true,
        authorSurname: true,
        authorName: true,
        year: true,
        publisher: true,
        filePath: true,
        fileType: true,
        pdfStatus: true,
        metadata: true,
      },
    })
    if (!entry) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Resolve parent: existing entry or freshly created one.
    let parentId: string
    if (body.parentEntryId) {
      const parent = await prisma.libraryEntry.findFirst({
        where: { id: body.parentEntryId, userId: session.user.id },
        select: { id: true },
      })
      if (!parent) {
        return NextResponse.json({ error: 'Parent not found' }, { status: 404 })
      }
      if (parent.id === entry.id) {
        return NextResponse.json(
          { error: 'Cannot promote an entry into itself' },
          { status: 400 },
        )
      }
      parentId = parent.id
    } else if (body.newParentTitle && body.newParentTitle.trim()) {
      const surname =
        body.newParentAuthorSurname?.trim() ||
        // Reuse the current entry's author when the user didn't supply
        // one — sensible default since the volume came from that file.
        entry.authorSurname.replace(/^\(Yükleme[^)]*\)$/i, '').trim() ||
        'Unknown'
      let created
      try {
        created = await prisma.libraryEntry.create({
          data: {
            userId: session.user.id,
            entryType: 'kitap',
            title: body.newParentTitle.trim(),
            authorSurname: surname,
            authorName: body.newParentAuthorName?.trim() || entry.authorName,
            year: entry.year,
            publisher: entry.publisher,
            keywords: [],
            importSource: 'multi-volume',
          },
          select: { id: true },
        })
      } catch (err) {
        if (
          typeof err === 'object' &&
          err &&
          'code' in err &&
          (err as { code: string }).code === 'P2002'
        ) {
          return NextResponse.json(
            { error: 'Bu yazar + başlık zaten kütüphanende — onun yerine onu seç' },
            { status: 409 },
          )
        }
        throw err
      }
      parentId = created.id
    } else {
      return NextResponse.json(
        { error: 'parentEntryId or newParentTitle required' },
        { status: 400 },
      )
    }

    // Pick the volume number. Caller hint → existing tail+1 → fallback.
    let volumeNumber: number
    if (
      typeof body.volumeNumber === 'number' &&
      Number.isFinite(body.volumeNumber) &&
      body.volumeNumber > 0
    ) {
      volumeNumber = Math.floor(body.volumeNumber)
    } else {
      const tail = await prisma.libraryEntryVolume.findFirst({
        where: { libraryEntryId: parentId },
        orderBy: { volumeNumber: 'desc' },
        select: { volumeNumber: true },
      })
      volumeNumber = (tail?.volumeNumber ?? 0) + 1
    }

    const hint = (entry.metadata as Prisma.JsonObject | null)?.volumeHint as
      | { volumeLabel?: string | null }
      | undefined
    const label =
      (typeof body.label === 'string' && body.label.trim())
        ? body.label.trim()
        : (typeof hint?.volumeLabel === 'string' && hint.volumeLabel.trim())
          ? hint.volumeLabel.trim()
          : null

    // 1. Create the volume row with no filePath yet (we'll set it after
    //    the file move so we don't end up with a dangling reference).
    let volume
    try {
      volume = await prisma.libraryEntryVolume.create({
        data: {
          libraryEntryId: parentId,
          volumeNumber,
          label,
          pdfStatus: entry.pdfStatus === 'ready' ? 'ready' : 'pending',
          fileType: asDocFileType(entry.fileType),
        },
        select: { id: true, volumeNumber: true, label: true },
      })
    } catch (err) {
      if (
        typeof err === 'object' &&
        err &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        return NextResponse.json(
          { error: `Bu eserde Cilt ${volumeNumber} zaten var` },
          { status: 409 },
        )
      }
      throw err
    }

    // 2. Move the PDF file under the parent's directory (rename, not
    //    copy, so we don't double the disk footprint). If the source
    //    isn't on disk (legacy entry), skip — the chunks still carry
    //    the text content.
    let newPath: string | null = null
    if (entry.filePath) {
      try {
        newPath = await moveToVolumePath(
          entry.userId,
          entry.filePath,
          parentId,
          volume.id,
          asDocFileType(entry.fileType),
        )
      } catch (err) {
        console.error('[promote-to-volume] file move failed:', err)
      }
    }
    if (newPath) {
      await prisma.libraryEntryVolume.update({
        where: { id: volume.id },
        data: { filePath: newPath },
      })
    }

    // 3. Re-parent the chunks. updateMany re-tags them in one statement
    //    so we don't blow past the transaction budget on large books.
    await prisma.libraryChunk.updateMany({
      where: { libraryEntryId: entry.id, volumeId: null },
      data: { libraryEntryId: parentId, volumeId: volume.id },
    })

    // 4. Drop the stub entry. Do NOT use the regular DELETE route —
    //    that would also unlink the moved file. Direct prisma.delete
    //    cascades through chunks (none left because we re-parented),
    //    tags, etc. The file is already at its new home.
    await prisma.libraryEntry.delete({ where: { id: entry.id } })

    return NextResponse.json({
      parentEntryId: parentId,
      volume: {
        id: volume.id,
        volumeNumber: volume.volumeNumber,
        label: volume.label,
      },
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library/[id]/promote-to-volume]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
