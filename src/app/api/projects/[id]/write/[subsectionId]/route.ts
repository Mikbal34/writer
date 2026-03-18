import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { buildSessionContext } from '@/lib/prompts/session-context'

type RouteContext = { params: Promise<{ id: string; subsectionId: string }> }

// GET /api/projects/[id]/write/[subsectionId]
// Returns the full writing context for a subsection.
export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id: projectId, subsectionId } = await ctx.params

    // Verify project ownership
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: session.user.id },
      select: { id: true },
    })

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Verify subsection belongs to this project
    const subsection = await prisma.subsection.findFirst({
      where: {
        id: subsectionId,
        section: { chapter: { projectId } },
      },
      select: { id: true },
    })

    if (!subsection) {
      return NextResponse.json({ error: 'Subsection not found' }, { status: 404 })
    }

    const writingContext = await buildSessionContext(subsectionId)

    return NextResponse.json({
      subsection: {
        id: writingContext.subsection.id,
        title: writingContext.subsection.title,
        description: writingContext.subsection.description,
        content: writingContext.subsection.content,
        status: writingContext.subsection.status,
        wordCount: writingContext.subsection.wordCount,
        subsectionId: writingContext.subsection.subsectionId,
      },
      section: {
        id: writingContext.section.id,
        title: writingContext.section.title,
        sectionId: writingContext.section.sectionId,
      },
      chapter: {
        id: writingContext.chapter.id,
        title: writingContext.chapter.title,
        number: writingContext.chapter.number,
      },
      position: writingContext.position,
      prevSubsection: writingContext.prevSubsection
        ? {
            ...writingContext.prevSubsection,
            dbId: writingContext.prevSubsection.subsectionId,
          }
        : null,
      nextSubsection: writingContext.nextSubsection
        ? {
            ...writingContext.nextSubsection,
            dbId: writingContext.nextSubsection.subsectionId,
          }
        : null,
      sources: writingContext.sources.map((s) => ({
        bibliographyId: s.bibliographyId,
        authorSurname: s.authorSurname,
        authorName: s.authorName,
        title: s.title,
        shortTitle: s.shortTitle,
        entryType: s.entryType,
        priority: s.priority,
        relevance: s.relevance,
      })),
      styleProfile: writingContext.styleProfile,
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/projects/[id]/write/[subsectionId]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
