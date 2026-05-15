/**
 * DELETE /api/library/highlights/[id]
 *
 * Removes a highlight. If a note was created together with it
 * (LibraryHighlight.noteId), the note is left alone — the user might
 * want to keep the written-up version after deleting the underlying
 * PDF mark.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const hl = await prisma.libraryHighlight.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    })
    if (!hl) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    await prisma.libraryHighlight.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[DELETE /api/library/highlights/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
