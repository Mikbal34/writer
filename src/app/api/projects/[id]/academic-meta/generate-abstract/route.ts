/**
 * POST /api/projects/[id]/academic-meta/generate-abstract
 *
 * Body: { target: AbstractTarget }
 *
 * Gathers the project's subsection text, calls the format-aware
 * abstract generator, and returns a shape-matched result the form
 * component splices back into its meta object.
 *
 * This route is synchronous (awaits the full model response) because
 * abstracts are short and the request is already user-gated on a
 * button press. If latency becomes an issue, upgrade to SSE and stream
 * the text chunks using streamChat from @/lib/claude.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import {
  generateAbstract,
  type AbstractTarget,
} from '@/lib/academic-meta/abstract-generator'
import { isAcademicFormat } from '@/lib/academic-meta'

type RouteContext = { params: Promise<{ id: string }> }

const VALID_TARGETS: ReadonlySet<AbstractTarget> = new Set<AbstractTarget>([
  'abstract',
  'structuredAbstract',
  'keyPoints',
  'indexTerms',
  'keywords',
  'abstractTr',
  'abstractEn',
  'keywordsTr',
  'keywordsEn',
])

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
      select: {
        id: true,
        title: true,
        language: true,
        citationFormat: true,
        chapters: {
          orderBy: { sortOrder: 'asc' },
          select: {
            title: true,
            sections: {
              orderBy: { sortOrder: 'asc' },
              select: {
                title: true,
                subsections: {
                  orderBy: { sortOrder: 'asc' },
                  select: { title: true, content: true },
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
    if (!isAcademicFormat(project.citationFormat)) {
      return NextResponse.json(
        { error: 'Project is not in an academic citation format' },
        { status: 400 }
      )
    }

    const body = (await req.json()) as { target?: string }
    const target = body.target as AbstractTarget | undefined
    if (!target || !VALID_TARGETS.has(target)) {
      return NextResponse.json(
        { error: 'Invalid target' },
        { status: 400 }
      )
    }

    const fullBody = project.chapters
      .flatMap((ch) =>
        ch.sections.flatMap((s) =>
          s.subsections
            .filter((ss) => ss.content && ss.content.trim().length > 0)
            .map((ss) => ss.content ?? '')
        )
      )
      .join('\n\n')

    if (!fullBody.trim()) {
      return NextResponse.json(
        {
          error:
            'This project has no written content yet. Write at least one subsection before generating an abstract.',
        },
        { status: 400 }
      )
    }

    const result = await generateAbstract({
      format: project.citationFormat,
      target,
      source: {
        title: project.title,
        language: project.language,
        body: fullBody,
      },
    })

    // Flatten the result into the same shape the client applier expects.
    switch (result.kind) {
      case 'text':
        return NextResponse.json({ result: result.text })
      case 'keywords':
        return NextResponse.json({ result: result.terms })
      case 'vancouverStructured':
        return NextResponse.json({
          result: {
            background: result.background,
            methods: result.methods,
            results: result.results,
            conclusions: result.conclusions,
          },
        })
      case 'amaStructured':
        return NextResponse.json({
          result: {
            importance: result.importance,
            objective: result.objective,
            designSettingParticipants: result.designSettingParticipants,
            interventions: result.interventions,
            mainOutcomesAndMeasures: result.mainOutcomesAndMeasures,
            results: result.results,
            conclusionsAndRelevance: result.conclusionsAndRelevance,
            trialRegistration: result.trialRegistration,
          },
        })
      case 'keyPoints':
        return NextResponse.json({
          result: {
            question: result.question,
            findings: result.findings,
            meaning: result.meaning,
          },
        })
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /academic-meta/generate-abstract]', err)
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : 'Internal error',
      },
      { status: 500 }
    )
  }
}
