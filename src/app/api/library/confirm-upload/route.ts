/**
 * POST /api/library/confirm-upload
 *
 * Direct-to-R2 upload, step 2 of 2. Browser called /presign-upload,
 * PUT the file straight to R2, and now tells us it's done. Server's
 * job: verify the file landed (HEAD R2), apply file-hash dedup
 * (browser computes hash client-side and sends it), enqueue the
 * worker, mark status="queued".
 *
 * Body: { entryId, fileHash } — fileHash is browser-computed SHA-256
 * of the bytes; lets us dedup without re-downloading from R2.
 *
 * Response: { status: 'queued' | 'duplicate', existingId?, existingTitle? }
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { pdfExistsR2 } from '@/lib/r2-storage'
import { enqueueIngest } from '@/lib/queue'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()
    const { entryId, fileHash } = await req.json() as {
      entryId?: string
      fileHash?: string
    }
    if (!entryId || !fileHash) {
      return NextResponse.json({ error: 'entryId and fileHash required' }, { status: 400 })
    }
    if (!/^[a-f0-9]{64}$/i.test(fileHash)) {
      return NextResponse.json({ error: 'invalid fileHash (expect SHA-256 hex)' }, { status: 400 })
    }

    const entry = await prisma.libraryEntry.findFirst({
      where: { id: entryId, userId: session.user.id },
      select: { id: true, filePath: true, pdfStatus: true, fileType: true },
    })
    if (!entry) {
      return NextResponse.json({ error: 'entry not found' }, { status: 404 })
    }
    if (!entry.filePath) {
      return NextResponse.json({ error: 'entry has no filePath (presign step skipped?)' }, { status: 400 })
    }

    // Dedup — does this user already have an entry with the same hash?
    // (Excluding the placeholder we just created in /presign-upload.)
    const dup = await prisma.libraryEntry.findFirst({
      where: {
        userId: session.user.id,
        fileHash,
        id: { not: entryId },
      },
      select: { id: true, title: true, authorSurname: true },
    })
    if (dup) {
      // Soft-delete the placeholder entry we created up-front.
      // (Don't bother deleting R2 file — daily prune handles orphans.)
      await prisma.libraryEntry.delete({ where: { id: entryId } }).catch(() => {})
      return NextResponse.json(
        {
          status: 'duplicate',
          message: `"${dup.title}" zaten kütüphanende.`,
          existingId: dup.id,
          existingTitle: dup.title,
          existingAuthor: dup.authorSurname,
        },
        { status: 409 },
      )
    }

    // Sanity-check the file actually landed in R2. If browser failed
    // mid-upload but called confirm anyway, we want a clear error.
    const exists = await pdfExistsR2(entry.filePath)
    if (!exists) {
      return NextResponse.json(
        { error: 'file not found in storage — upload may have failed' },
        { status: 400 },
      )
    }

    // Persist hash + flip status, then enqueue.
    await prisma.libraryEntry.update({
      where: { id: entryId },
      data: { fileHash, pdfStatus: 'queued' },
    })
    await enqueueIngest({ kind: 'entry', entryId })

    return NextResponse.json({ status: 'queued', entryId })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library/confirm-upload]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
