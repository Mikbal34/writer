/**
 * GET  /api/projects/[id]/academic-meta
 * PATCH /api/projects/[id]/academic-meta
 *
 * GET returns the persisted AcademicMeta row for the project, or an
 * empty meta scaffolded for the project's current citationFormat if no
 * row exists yet. PATCH validates the posted body against the
 * format-specific Zod schema and upserts.
 *
 * The project's citationFormat is authoritative — if the PATCH body's
 * format does not match, the request is rejected. When the user wants
 * to switch citation format they must do so on the project settings
 * page; that flow (not handled here) should re-scaffold the meta row.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import {
  emptyMetaFor,
  isAcademicFormat,
  parseAcademicMetaForFormat,
} from '@/lib/academic-meta'
import { projectColumnsFromMeta } from '@/lib/academic-meta/legacy-adapter'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
      select: {
        id: true,
        citationFormat: true,
        projectType: true,
        academicMeta: {
          select: { format: true, schemaVersion: true, meta: true, updatedAt: true },
        },
      },
    })

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    if (!isAcademicFormat(project.citationFormat)) {
      return NextResponse.json(
        { error: 'Project citation format is not an academic format' },
        { status: 400 }
      )
    }

    // If a row exists and matches the current format → return it.
    // Otherwise scaffold a fresh empty meta for the current format so
    // the form always loads a controlled object.
    const row = project.academicMeta
    if (row && row.format === project.citationFormat) {
      return NextResponse.json({
        format: row.format,
        schemaVersion: row.schemaVersion,
        meta: row.meta,
        updatedAt: row.updatedAt,
      })
    }

    const empty = emptyMetaFor(project.citationFormat)
    return NextResponse.json({
      format: empty.format,
      schemaVersion: empty.schemaVersion,
      meta: empty,
      updatedAt: null,
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/projects/[id]/academic-meta]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true, citationFormat: true },
    })
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    if (!isAcademicFormat(project.citationFormat)) {
      return NextResponse.json(
        { error: 'Project citation format is not an academic format' },
        { status: 400 }
      )
    }

    const body = await req.json()
    const parsed = parseAcademicMetaForFormat(body, project.citationFormat)
    if (!parsed.ok) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 }
      )
    }

    // Authoritative: write the discriminated union to ProjectAcademicMeta.
    // Shadow: flatten to the legacy Project columns so the export pipeline
    // (which still reads from Project directly) stays in sync. Both writes
    // must succeed or neither — wrap in a transaction.
    const legacy = projectColumnsFromMeta(parsed.data)
    const [saved] = await prisma.$transaction([
      prisma.projectAcademicMeta.upsert({
        where: { projectId: project.id },
        create: {
          projectId: project.id,
          format: parsed.data.format,
          schemaVersion: parsed.data.schemaVersion,
          meta: parsed.data as unknown as object,
        },
        update: {
          format: parsed.data.format,
          schemaVersion: parsed.data.schemaVersion,
          meta: parsed.data as unknown as object,
        },
      }),
      prisma.project.update({
        where: { id: project.id },
        data: legacy,
      }),
    ])

    return NextResponse.json({
      format: saved.format,
      schemaVersion: saved.schemaVersion,
      meta: saved.meta,
      updatedAt: saved.updatedAt,
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[PATCH /api/projects/[id]/academic-meta]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
