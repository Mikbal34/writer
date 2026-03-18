import { NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function DELETE() {
  try {
    const session = await requireAuth()
    await prisma.zoteroConnection.deleteMany({ where: { userId: session.user.id } })
    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[DELETE /api/library/zotero/disconnect]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
