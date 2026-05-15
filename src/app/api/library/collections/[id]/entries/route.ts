/**
 * /api/library/collections/[id]/entries
 *
 * Bulk add / remove library entries to a collection.
 *
 * POST   { entryIds: string[] }  → add (createMany skipDuplicates)
 * DELETE { entryIds: string[] }  → remove (junction rows only — entries stay)
 *
 * Both verify the collection and the entries belong to the authenticated
 * user; unknown ids in the array are silently dropped (Prisma's findMany
 * + Set membership filtering) so a stale tab can't accidentally touch
 * someone else's data.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

async function authorizeAndFilter(
  userId: string,
  collectionId: string,
  rawIds: unknown,
): Promise<{ ok: true; entryIds: string[] } | { ok: false; status: number; error: string }> {
  const collection = await prisma.libraryCollection.findFirst({
    where: { id: collectionId, userId },
    select: { id: true },
  })
  if (!collection) return { ok: false, status: 404, error: 'Klasör bulunamadı' }

  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return { ok: false, status: 400, error: 'entryIds dizisi gerekli' }
  }
  const ids = (rawIds as unknown[]).filter((x): x is string => typeof x === 'string')
  if (ids.length === 0) {
    return { ok: false, status: 400, error: 'entryIds dizisi gerekli' }
  }
  if (ids.length > 500) {
    return { ok: false, status: 400, error: 'Tek seferde en fazla 500 entry' }
  }

  // Filter to the user's actual entries.
  const owned = await prisma.libraryEntry.findMany({
    where: { id: { in: ids }, userId },
    select: { id: true },
  })
  return { ok: true, entryIds: owned.map((e) => e.id) }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id: collectionId } = await ctx.params
    const body = (await req.json()) as { entryIds?: unknown }

    const auth = await authorizeAndFilter(session.user.id, collectionId, body.entryIds)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const res = await prisma.libraryEntryCollection.createMany({
      data: auth.entryIds.map((libraryEntryId) => ({
        libraryEntryId,
        collectionId,
      })),
      skipDuplicates: true,
    })
    return NextResponse.json({ added: res.count, requested: auth.entryIds.length })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library/collections/[id]/entries]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id: collectionId } = await ctx.params
    const body = (await req.json()) as { entryIds?: unknown }

    const auth = await authorizeAndFilter(session.user.id, collectionId, body.entryIds)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const res = await prisma.libraryEntryCollection.deleteMany({
      where: {
        collectionId,
        libraryEntryId: { in: auth.entryIds },
      },
    })
    return NextResponse.json({ removed: res.count, requested: auth.entryIds.length })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[DELETE /api/library/collections/[id]/entries]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
