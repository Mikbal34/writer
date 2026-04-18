import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

/**
 * GET /api/library/pdf-status?ids=a,b,c
 * Returns PDF download status for a batch of library entries.
 * UI polls this while the background pipeline processes entries.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth()
    const idsParam = req.nextUrl.searchParams.get('ids') ?? ''
    const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean)

    if (ids.length === 0) {
      return NextResponse.json({ entries: [] })
    }

    const entries = await prisma.libraryEntry.findMany({
      where: { id: { in: ids }, userId: session.user.id },
      select: { id: true, pdfStatus: true, pdfError: true, filePath: true },
    })

    return NextResponse.json({ entries })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/library/pdf-status]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
