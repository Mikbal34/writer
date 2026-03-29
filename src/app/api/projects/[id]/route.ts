import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

type CitationFormat = 'ISNAD' | 'APA' | 'CHICAGO' | 'MLA'
type ProjectStatus = 'roadmap' | 'sources' | 'writing' | 'completed'

type RouteContext = { params: Promise<{ id: string }> }

// GET /api/projects/[id]
// Returns the project with fully-nested chapters → sections → subsections.
export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
      include: {
        chapters: {
          orderBy: { sortOrder: 'asc' },
          include: {
            sections: {
              orderBy: { sortOrder: 'asc' },
              include: {
                subsections: {
                  orderBy: { sortOrder: 'asc' },
                  select: {
                    id: true,
                    subsectionId: true,
                    title: true,
                    status: true,
                    wordCount: true,
                    sortOrder: true,
                    sectionId: true,
                  },
                },
              },
            },
          },
        },
        sources: {
          select: { id: true, filename: true, fileType: true, totalPages: true, processed: true },
        },
        _count: {
          select: { bibliography: true },
        },
      },
    })

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    return NextResponse.json(project)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/projects/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/projects/[id]
// Body: partial project fields – title, description, topic, purpose, audience,
//       citationFormat, language, status, styleProfile, writingGuidelines
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const existing = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const body = await req.json()
    const {
      title,
      description,
      topic,
      purpose,
      audience,
      citationFormat,
      language,
      status,
      styleProfile,
      writingGuidelines,
      bookDesign,
    } = body as {
      title?: string
      description?: string
      topic?: string
      purpose?: string
      audience?: string
      citationFormat?: CitationFormat
      language?: string
      status?: ProjectStatus
      styleProfile?: Record<string, unknown>
      writingGuidelines?: Record<string, unknown>
      bookDesign?: Record<string, unknown>
    }

    const validFormats: CitationFormat[] = ['ISNAD', 'APA', 'CHICAGO', 'MLA']
    if (citationFormat && !validFormats.includes(citationFormat)) {
      return NextResponse.json({ error: 'Invalid citationFormat' }, { status: 400 })
    }

    const validStatuses: ProjectStatus[] = ['roadmap', 'sources', 'writing', 'completed']
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const updated = await prisma.project.update({
      where: { id },
      data: {
        ...(title !== undefined && { title: title.trim() }),
        ...(description !== undefined && { description }),
        ...(topic !== undefined && { topic }),
        ...(purpose !== undefined && { purpose }),
        ...(audience !== undefined && { audience }),
        ...(citationFormat !== undefined && { citationFormat }),
        ...(language !== undefined && { language }),
        ...(status !== undefined && { status }),
        // Prisma Json fields require casting through unknown
        ...(styleProfile !== undefined && { styleProfile: styleProfile as unknown as object }),
        ...(writingGuidelines !== undefined && { writingGuidelines: writingGuidelines as unknown as object }),
        ...(bookDesign !== undefined && { bookDesign: bookDesign as unknown as object }),
      },
    })

    return NextResponse.json(updated)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[PATCH /api/projects/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/projects/[id]
// Cascades through chapters, sections, subsections, sources, bibliography, etc.
// via the Prisma onDelete: Cascade rules in the schema.
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const existing = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    await prisma.project.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[DELETE /api/projects/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
