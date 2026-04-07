import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { findPdf } from '@/lib/pdf-finder'

/**
 * POST /api/research/find-pdf
 * Searches open-access APIs for a downloadable PDF of a bibliography entry.
 * Body: { bibliographyId: string }
 * Returns: { found, pdfUrl, provider, confidence }
 * No credits consumed.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()
    const { bibliographyId } = (await req.json()) as { bibliographyId: string }

    if (!bibliographyId) {
      return NextResponse.json({ error: 'bibliographyId is required' }, { status: 400 })
    }

    // Fetch bibliography and verify ownership via project
    const bib = await prisma.bibliography.findUnique({
      where: { id: bibliographyId },
      include: { project: { select: { userId: true } } },
    })

    if (!bib || bib.project.userId !== session.user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Already has a source — no need to search
    if (bib.sourceId) {
      return NextResponse.json({
        found: true,
        pdfUrl: null,
        provider: null,
        confidence: 'high',
        alreadyHasSource: true,
      })
    }

    const result = await findPdf({
      doi: bib.doi,
      title: bib.title,
      authorSurname: bib.authorSurname,
      entryType: bib.entryType,
      isbn: null,
    })

    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/research/find-pdf]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
