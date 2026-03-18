import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

type SubsectionStatus = 'pending' | 'in_progress' | 'draft' | 'review' | 'completed'

type RouteContext = { params: Promise<{ id: string }> }

// ---------------------------------------------------------------------------
// Helper: verify the subsection belongs to the requesting user
// ---------------------------------------------------------------------------
async function getOwnedSubsection(subsectionId: string, userId: string) {
  return prisma.subsection.findFirst({
    where: {
      id: subsectionId,
      section: { chapter: { project: { userId } } },
    },
  })
}

// GET /api/subsections/[id]
// Returns the subsection with its source mappings (and full bibliography entries).
export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const subsection = await prisma.subsection.findFirst({
      where: {
        id,
        section: { chapter: { project: { userId: session.user.id } } },
      },
      include: {
        sourceMappings: {
          include: { bibliography: true },
        },
      },
    })

    if (!subsection) {
      return NextResponse.json({ error: 'Subsection not found' }, { status: 404 })
    }

    return NextResponse.json(subsection)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/subsections/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/subsections/[id]
// Body: { title?, description?, whatToWrite?, keyPoints?, writingStrategy?,
//         estimatedPages?, status?, content?, wordCount?, sortOrder? }
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const owned = await getOwnedSubsection(id, session.user.id)
    if (!owned) {
      return NextResponse.json({ error: 'Subsection not found' }, { status: 404 })
    }

    const body = await req.json()
    const {
      title,
      description,
      whatToWrite,
      keyPoints,
      writingStrategy,
      estimatedPages,
      status,
      content,
      wordCount,
      sortOrder,
    } = body as {
      title?: string
      description?: string
      whatToWrite?: string
      keyPoints?: string[]
      writingStrategy?: string
      estimatedPages?: number
      status?: SubsectionStatus
      content?: string
      wordCount?: number
      sortOrder?: number
    }

    const validStatuses: SubsectionStatus[] = ['pending', 'in_progress', 'draft', 'review', 'completed']
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    // Auto-calculate word count from content if content is provided but wordCount is not
    let resolvedWordCount = wordCount
    if (content !== undefined && wordCount === undefined) {
      resolvedWordCount = content.trim().split(/\s+/).filter(Boolean).length
    }

    const updated = await prisma.subsection.update({
      where: { id },
      data: {
        ...(title !== undefined && { title: title.trim() }),
        ...(description !== undefined && { description }),
        ...(whatToWrite !== undefined && { whatToWrite }),
        ...(keyPoints !== undefined && { keyPoints }),
        ...(writingStrategy !== undefined && { writingStrategy }),
        ...(estimatedPages !== undefined && { estimatedPages }),
        ...(status !== undefined && { status }),
        ...(content !== undefined && { content }),
        ...(resolvedWordCount !== undefined && { wordCount: resolvedWordCount }),
        ...(sortOrder !== undefined && { sortOrder }),
      },
    })

    return NextResponse.json(updated)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[PATCH /api/subsections/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/subsections/[id]
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const owned = await getOwnedSubsection(id, session.user.id)
    if (!owned) {
      return NextResponse.json({ error: 'Subsection not found' }, { status: 404 })
    }

    await prisma.subsection.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[DELETE /api/subsections/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
