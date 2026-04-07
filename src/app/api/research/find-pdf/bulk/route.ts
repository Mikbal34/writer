import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { findPdf, type PdfSearchResult } from '@/lib/pdf-finder'

/**
 * POST /api/research/find-pdf/bulk
 * Searches PDFs for all bibliography entries without a source in a project.
 * Body: { projectId: string }
 * Returns: { results: Array<{ bibId, title, authorSurname, ...PdfSearchResult }>, total, found }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()
    const { projectId } = (await req.json()) as { projectId: string }

    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: session.user.id },
      select: { id: true },
    })
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Get all bibliography entries without a source
    const bibs = await prisma.bibliography.findMany({
      where: { projectId, sourceId: null },
      select: {
        id: true,
        title: true,
        authorSurname: true,
        entryType: true,
        doi: true,
      },
    })

    if (bibs.length === 0) {
      return NextResponse.json({ results: [], total: 0, found: 0 })
    }

    // Search in parallel with concurrency limit of 5
    const CONCURRENCY = 5
    const results: Array<{
      bibId: string
      title: string
      authorSurname: string
    } & PdfSearchResult> = []

    for (let i = 0; i < bibs.length; i += CONCURRENCY) {
      const batch = bibs.slice(i, i + CONCURRENCY)
      const batchResults = await Promise.allSettled(
        batch.map(async (bib) => {
          const result = await findPdf({
            doi: bib.doi,
            title: bib.title,
            authorSurname: bib.authorSurname,
            entryType: bib.entryType,
            isbn: null,
          })
          return {
            bibId: bib.id,
            title: bib.title,
            authorSurname: bib.authorSurname,
            ...result,
          }
        })
      )

      for (const r of batchResults) {
        if (r.status === 'fulfilled') {
          results.push(r.value)
        }
      }
    }

    const foundCount = results.filter((r) => r.found).length

    return NextResponse.json({
      results,
      total: bibs.length,
      found: foundCount,
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/research/find-pdf/bulk]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
