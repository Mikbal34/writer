import { NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getCollections } from '@/lib/zotero'

export async function GET() {
  try {
    const session = await requireAuth()
    const conn = await prisma.zoteroConnection.findUnique({
      where: { userId: session.user.id },
    })
    if (!conn) {
      return NextResponse.json({ error: 'No Zotero connection' }, { status: 404 })
    }

    const collections = await getCollections(conn.zoteroUserId, conn.apiKey)
    return NextResponse.json({ collections, syncCollections: conn.syncCollections })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/library/zotero/collections]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
