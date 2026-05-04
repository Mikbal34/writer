/**
 * Lightweight "what will this look like?" rendering for a single
 * subsection. Resolves inline `[cite:…]` markers against the project's
 * bibliography and citation format so the writing editor can show a
 * faithful preview without dragging the full export pipeline along.
 *
 *   GET /api/projects/[id]/subsections/[subId]/preview
 *   → { content: string }     (markdown with citations resolved)
 */
import { NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getCitationFormatter } from '@/lib/citations/formatter'
import { resolveInlineCitations, createResolverState } from '@/lib/citations/inline-resolver'
import type { BibliographyEntry } from '@/types/bibliography'
import type { CitationFormat } from '@prisma/client'

type RouteContext = { params: Promise<{ id: string; subId: string }> }

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireAuth()
    const { id: projectId, subId } = await params

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: session.user.id },
      select: { citationFormat: true },
    })
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const subsection = await prisma.subsection.findFirst({
      where: {
        id: subId,
        section: { chapter: { projectId } },
      },
      select: { content: true },
    })
    if (!subsection) {
      return NextResponse.json({ error: 'Subsection not found' }, { status: 404 })
    }

    if (!subsection.content) {
      return NextResponse.json({ content: '' })
    }

    const bibliography = (await prisma.bibliography.findMany({
      where: { projectId },
      orderBy: [{ authorSurname: 'asc' }, { year: 'asc' }],
    })) as unknown as BibliographyEntry[]

    const formatter = getCitationFormatter(project.citationFormat as CitationFormat)
    const state = createResolverState()
    const resolved = resolveInlineCitations(subsection.content, bibliography, formatter, state)

    return NextResponse.json({ content: resolved })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET subsection/preview]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
