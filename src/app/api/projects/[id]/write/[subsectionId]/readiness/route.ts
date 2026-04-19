import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

type RouteContext = { params: Promise<{ id: string; subsectionId: string }> }

interface MappingReadiness {
  mappingId: string
  title: string
  authorSurname: string
  authorName: string | null
  priority: string
  hasProjectSource: boolean
  hasLibraryEntryReady: boolean
  libraryEntryId: string | null
  pdfStatus: string | null
  usable: boolean
}

/**
 * GET /api/projects/:id/write/:subsectionId/readiness
 * Reports which of the subsection's mapped sources actually have usable
 * content (project-uploaded PDF with chunks, or a library entry whose
 * PDF is ready). The write UI shows a warning when coverage is poor.
 */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id: projectId, subsectionId } = await ctx.params

    const subsection = await prisma.subsection.findFirst({
      where: {
        id: subsectionId,
        section: { chapter: { project: { id: projectId, userId: session.user.id } } },
      },
      select: { id: true, title: true },
    })
    if (!subsection) {
      return NextResponse.json({ error: 'Subsection not found' }, { status: 404 })
    }

    const mappings = await prisma.sourceMapping.findMany({
      where: { subsectionId },
      include: {
        bibliography: {
          select: {
            title: true,
            authorSurname: true,
            authorName: true,
            sourceId: true,
            libraryEntryId: true,
            source: {
              select: {
                processed: true,
                _count: { select: { chunks: true } },
              },
            },
            libraryEntry: {
              select: { id: true, pdfStatus: true },
            },
          },
        },
      },
    })

    const summary: MappingReadiness[] = mappings.map((m) => {
      const bib = m.bibliography
      const hasProjectSource =
        !!bib.sourceId && !!bib.source?.processed && (bib.source?._count?.chunks ?? 0) > 0
      const hasLibraryEntryReady =
        !!bib.libraryEntryId && bib.libraryEntry?.pdfStatus === 'ready'
      return {
        mappingId: m.id,
        title: bib.title,
        authorSurname: bib.authorSurname,
        authorName: bib.authorName,
        priority: m.priority,
        hasProjectSource,
        hasLibraryEntryReady,
        libraryEntryId: bib.libraryEntryId,
        pdfStatus: bib.libraryEntry?.pdfStatus ?? null,
        usable: hasProjectSource || hasLibraryEntryReady,
      }
    })

    const total = summary.length
    const usable = summary.filter((s) => s.usable).length
    const missing = total - usable

    return NextResponse.json({
      subsectionId,
      subsectionTitle: subsection.title,
      total,
      usable,
      missing,
      mappings: summary,
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET .../readiness]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
