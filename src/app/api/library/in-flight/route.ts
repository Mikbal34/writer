/**
 * GET /api/library/in-flight
 *
 * Lightweight poll endpoint for the Library page's "processing" banner.
 * Returns a small summary of the user's entries (and volumes) that are
 * still being processed — used to show "3 kitap arka planda işleniyor"
 * with the top titles + an ETA per item.
 *
 * Polled every 15-30s. Stays well under 1KB even for many in-flight.
 */
import { NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

const IN_FLIGHT = ['queued', 'extracting', 'embedding', 'pending', 'downloading'] as const

export async function GET() {
  try {
    const session = await requireAuth()
    const uid = session.user.id

    const [entries, volumes] = await Promise.all([
      prisma.libraryEntry.findMany({
        where: { userId: uid, pdfStatus: { in: IN_FLIGHT as unknown as string[] } },
        select: { id: true, title: true, authorSurname: true, pdfStatus: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      prisma.libraryEntryVolume.findMany({
        where: {
          libraryEntry: { userId: uid },
          pdfStatus: { in: IN_FLIGHT as unknown as string[] },
        },
        select: {
          id: true, volumeNumber: true, pdfStatus: true, createdAt: true,
          libraryEntry: { select: { id: true, title: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ])

    return NextResponse.json({
      count: entries.length + volumes.length,
      entries: entries.map((e) => ({
        id: e.id,
        title: e.title,
        authorSurname: e.authorSurname,
        status: e.pdfStatus,
        kind: 'entry' as const,
      })),
      volumes: volumes.map((v) => ({
        id: v.id,
        parentId: v.libraryEntry.id,
        parentTitle: v.libraryEntry.title,
        volumeNumber: v.volumeNumber,
        status: v.pdfStatus,
        kind: 'volume' as const,
      })),
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/library/in-flight]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
