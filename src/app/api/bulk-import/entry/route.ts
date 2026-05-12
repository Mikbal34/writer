/**
 * POST /api/bulk-import/entry
 *
 * Static-token counterpart of POST /api/library used by the one-shot
 * bulk-import script (scripts/admin/bulk-import-classical.ts).
 *
 * Lives outside /api/admin/* on purpose — proxy.ts gates that whole
 * subtree behind the admin SESSION cookie, which the script can't
 * carry. This endpoint authenticates via the static X-Admin-Token
 * header matched against ADMIN_BULK_IMPORT_TOKEN.
 *
 * Idempotent: returns the existing entry when (userId, authorSurname,
 * title) already match, so re-runs after a partial failure pick up
 * where they left off. Keep the env-var secret; rotate / unset after
 * the import run.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  userId?: string
  authorSurname?: string
  authorName?: string
  title?: string
  year?: string
  publisher?: string
  importSource?: string
}

function authorized(req: NextRequest): boolean {
  const expected = process.env.ADMIN_BULK_IMPORT_TOKEN
  if (!expected) return false
  return req.headers.get('x-admin-token') === expected
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const body = (await req.json()) as Body
    const {
      userId,
      authorSurname,
      authorName,
      title,
      year,
      publisher,
      importSource = 'multi-volume',
    } = body

    if (!userId || !authorSurname?.trim() || !title?.trim()) {
      return NextResponse.json(
        { error: 'userId, authorSurname, title gerekli' },
        { status: 400 },
      )
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    })
    if (!user) {
      return NextResponse.json({ error: 'User bulunamadı' }, { status: 404 })
    }

    const existing = await prisma.libraryEntry.findFirst({
      where: {
        userId,
        authorSurname: authorSurname.trim(),
        title: title.trim(),
      },
      select: { id: true },
    })
    if (existing) {
      return NextResponse.json({ id: existing.id, alreadyExists: true })
    }

    const entry = await prisma.libraryEntry.create({
      data: {
        userId,
        entryType: 'kitap',
        authorSurname: authorSurname.trim(),
        authorName: authorName?.trim() || null,
        title: title.trim(),
        year: year?.trim() || null,
        publisher: publisher?.trim() || null,
        importSource,
        keywords: [],
      },
      select: { id: true },
    })
    return NextResponse.json({ id: entry.id, alreadyExists: false })
  } catch (err) {
    console.error('[admin/bulk-import/entry]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
