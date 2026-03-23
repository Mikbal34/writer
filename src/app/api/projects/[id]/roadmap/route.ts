import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { findOrCreateBibliography } from '@/lib/bibliography'
import type { BookStructure } from '@/types/project'
import type { Prisma } from '@prisma/client'

type RouteContext = { params: Promise<{ id: string }> }

function normalizePriority(raw?: string): string {
  if (!raw) return 'supporting'
  const lower = raw.toLowerCase()
  if (lower === 'primary' || lower === 'birincil') return 'primary'
  return 'supporting'
}

// ---------------------------------------------------------------------------
// GET /api/projects/[id]/roadmap
// Returns existing chapters/sections/subsections from DB.
// ---------------------------------------------------------------------------
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
                  include: {
                    sourceMappings: {
                      include: { bibliography: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    return NextResponse.json({ chapters: project.chapters, projectType: project.projectType })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/projects/[id]/roadmap]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// PUT /api/projects/[id]/roadmap
// Body: { roadmap: BookStructure }
// Saves the roadmap by creating/replacing chapters, sections, and subsections
// in the database. Uses a transaction to keep the DB consistent.
// ---------------------------------------------------------------------------
export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true },
    })

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const body = await req.json()
    const roadmap = body?.roadmap as BookStructure | undefined

    if (!roadmap || !Array.isArray(roadmap.chapters)) {
      return NextResponse.json({ error: 'roadmap is required and must contain chapters' }, { status: 400 })
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Remove existing chapters (cascades to sections, subsections, sourceMappings)
      await tx.chapter.deleteMany({ where: { projectId: id } })
      // Remove bibliography entries that have no linked source file (AI-suggested only)
      await tx.bibliography.deleteMany({ where: { projectId: id, sourceId: null } })

      // Update project title if the roadmap provides one
      if (roadmap.title) {
        await tx.project.update({
          where: { id },
          data: { title: roadmap.title, status: 'roadmap' },
        })
      } else {
        await tx.project.update({
          where: { id },
          data: { status: 'roadmap' },
        })
      }

      for (const [chapterIndex, bookChapter] of roadmap.chapters.entries()) {
        const chapter = await tx.chapter.create({
          data: {
            projectId: id,
            number: bookChapter.id,
            title: bookChapter.title,
            purpose: bookChapter.purpose,
            estimatedPages: bookChapter.estimatedPages,
            sortOrder: chapterIndex,
          },
        })

        for (const [sectionIndex, bookSection] of bookChapter.sections.entries()) {
          const section = await tx.section.create({
            data: {
              chapterId: chapter.id,
              sectionId: bookSection.id,
              title: bookSection.title,
              keyConcepts: bookSection.keyConcepts ?? [],
              sortOrder: sectionIndex,
            },
          })

          for (const [subIndex, bookSub] of bookSection.subsections.entries()) {
            const subsection = await tx.subsection.create({
              data: {
                sectionId: section.id,
                subsectionId: bookSub.id,
                title: bookSub.title,
                description: bookSub.description,
                whatToWrite: bookSub.whatToWrite,
                keyPoints: bookSub.keyPoints ?? [],
                writingStrategy: bookSub.writingStrategy,
                estimatedPages: bookSub.estimatedPages,
                sortOrder: subIndex,
                status: 'pending',
              },
            })

            // Save source suggestions from roadmap as bibliography entries + mappings
            const sources = bookSub.sources ?? { classical: [], modern: [] }
            const allSources: Array<{ author: string; work: string; relevance?: string; priority?: string; howToUse?: string; whereToFind?: string; extractionGuide?: string; type: string }> = [
              ...(sources.classical ?? []).map(s => ({ ...s, type: 'classical' as const })),
              ...(sources.modern ?? []).map(s => ({ ...s, type: 'modern' as const })),
            ]

            for (const src of allSources) {
              if (!src.author || !src.work) continue

              const biblio = await findOrCreateBibliography(tx, id, src.author, src.work)

              // Create source mapping
              await tx.sourceMapping.upsert({
                where: {
                  subsectionId_bibliographyId: {
                    subsectionId: subsection.id,
                    bibliographyId: biblio.id,
                  },
                },
                create: {
                  subsectionId: subsection.id,
                  bibliographyId: biblio.id,
                  relevance: src.relevance ?? null,
                  priority: normalizePriority(src.priority),
                  sourceType: src.type ?? 'modern',
                  howToUse: src.howToUse ?? null,
                  whereToFind: src.whereToFind ?? null,
                  extractionGuide: src.extractionGuide ?? null,
                },
                update: {
                  relevance: src.relevance ?? null,
                  howToUse: src.howToUse ?? null,
                  whereToFind: src.whereToFind ?? null,
                  extractionGuide: src.extractionGuide ?? null,
                },
              })
            }
          }
        }
      }
    })

    // Return the updated project with the full structure
    const updated = await prisma.project.findUnique({
      where: { id },
      include: {
        chapters: {
          orderBy: { sortOrder: 'asc' },
          include: {
            sections: {
              orderBy: { sortOrder: 'asc' },
              include: {
                subsections: {
                  orderBy: { sortOrder: 'asc' },
                  include: {
                    sourceMappings: {
                      include: { bibliography: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })

    return NextResponse.json(updated)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[PUT /api/projects/[id]/roadmap]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
