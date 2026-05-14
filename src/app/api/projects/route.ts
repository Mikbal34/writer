import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

type CitationFormat = 'ISNAD' | 'APA' | 'CHICAGO' | 'MLA' | 'HARVARD' | 'VANCOUVER' | 'IEEE' | 'AMA' | 'TURABIAN'
type ProjectType = 'ACADEMIC' | 'CREATIVE'

// GET /api/projects
// Returns all projects belonging to the authenticated user, with chapter count
// and current status.
export async function GET() {
  try {
    const session = await requireAuth()
    const userId = session.user.id

    const projects = await prisma.project.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: {
          select: { chapters: true },
        },
      },
    })

    return NextResponse.json(projects)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/projects]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/projects
// Body: { title, description?, topic?, purpose?, audience?, citationFormat?, language? }
// Creates a new project for the authenticated user.
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()
    const userId = session.user.id

    const body = await req.json()
    const {
      title,
      description,
      topic,
      purpose,
      audience,
      citationFormat,
      language,
      projectType,
      styleProfileId,
      styleOverrides,
      seriesId,
      seriesOrder,
      newSeriesName,
    } = body as {
      title: string
      description?: string
      topic?: string
      purpose?: string
      audience?: string
      citationFormat?: CitationFormat
      language?: string
      projectType?: ProjectType
      styleProfileId?: string
      // Project-scoped writing style overrides — set in the wizard's
      // Step 4 (ProjectStyleSetup). Stored under writingGuidelines.
      styleOverrides?: Record<string, unknown> | null
      seriesId?: string | null
      seriesOrder?: number | null
      newSeriesName?: string | null
    }

    if (!title || typeof title !== 'string' || title.trim() === '') {
      return NextResponse.json({ error: 'title is required' }, { status: 400 })
    }

    const validFormats: CitationFormat[] = ['ISNAD', 'APA', 'CHICAGO', 'MLA', 'HARVARD', 'VANCOUVER', 'IEEE', 'AMA', 'TURABIAN']
    if (citationFormat && !validFormats.includes(citationFormat)) {
      return NextResponse.json({ error: 'Invalid citationFormat' }, { status: 400 })
    }

    // Verify the chosen style profile belongs to the user; link it as a live
    // FK (edits to the profile will flow through to future writing sessions).
    let verifiedStyleProfileId: string | null = null
    if (styleProfileId) {
      const userStyle = await prisma.userStyleProfile.findFirst({
        where: { id: styleProfileId, userId },
        select: { id: true },
      })
      if (userStyle) verifiedStyleProfileId = userStyle.id
    }

    const validTypes: ProjectType[] = ['ACADEMIC', 'CREATIVE']
    // CREATIVE ("Serbest Yazım") is hidden behind a "Soon" badge in the
    // UI for the launch — we only ship the academic flow first. Server-
    // side gate so a client that bypasses the disabled button still
    // can't open creative projects.
    if (projectType === 'CREATIVE') {
      return NextResponse.json(
        { error: 'Serbest Yazım yakında — şimdilik sadece akademik projeler oluşturulabilir.' },
        { status: 403 },
      )
    }
    const resolvedType = projectType && validTypes.includes(projectType) ? projectType : 'ACADEMIC'

    // Series resolution. Three accepted shapes:
    //   - newSeriesName set       → create the series, this becomes Cilt 1
    //   - seriesId set            → join an existing (user-owned) series
    //   - both null/undefined     → standalone project (default)
    let resolvedSeriesId: string | null = null
    let resolvedSeriesOrder: number | null = null
    const trimmedNewSeries = newSeriesName?.trim() || null

    if (trimmedNewSeries) {
      try {
        const series = await prisma.series.create({
          data: { userId, name: trimmedNewSeries },
          select: { id: true },
        })
        resolvedSeriesId = series.id
        resolvedSeriesOrder = 1
      } catch (err) {
        if (
          typeof err === 'object' &&
          err &&
          'code' in err &&
          (err as { code: string }).code === 'P2002'
        ) {
          return NextResponse.json(
            { error: 'Bu isimde bir seri zaten var' },
            { status: 409 },
          )
        }
        throw err
      }
    } else if (seriesId) {
      const series = await prisma.series.findFirst({
        where: { id: seriesId, userId },
        select: { id: true },
      })
      if (!series) {
        return NextResponse.json({ error: 'Series not found' }, { status: 404 })
      }
      resolvedSeriesId = series.id
      // Auto-assign the next free volume order if the caller didn't pick one.
      if (typeof seriesOrder === 'number' && Number.isFinite(seriesOrder) && seriesOrder > 0) {
        resolvedSeriesOrder = Math.floor(seriesOrder)
      } else {
        const tail = await prisma.project.findFirst({
          where: { seriesId: series.id },
          orderBy: { seriesOrder: 'desc' },
          select: { seriesOrder: true },
        })
        resolvedSeriesOrder = (tail?.seriesOrder ?? 0) + 1
      }
    }

    // Persist styleOverrides under the existing writingGuidelines JSON
    // bucket (namespace: styleOverrides). The bucket is also used by the
    // creative pipeline for `artStyle`; coexistence is fine — we only
    // populate styleOverrides at creation time. Cast through Prisma's
    // InputJsonValue contract.
    const writingGuidelines: Prisma.InputJsonValue | undefined =
      styleOverrides && typeof styleOverrides === 'object'
        ? ({ styleOverrides } as Prisma.InputJsonValue)
        : undefined

    const project = await prisma.project.create({
      data: {
        userId,
        title: title.trim(),
        description: description ?? null,
        topic: topic ?? null,
        purpose: purpose ?? null,
        audience: audience ?? null,
        projectType: resolvedType,
        citationFormat: resolvedType === 'ACADEMIC' ? (citationFormat ?? 'ISNAD') : 'ISNAD',
        language: language ?? 'en',
        status: 'roadmap',
        ...(verifiedStyleProfileId && { styleProfileId: verifiedStyleProfileId }),
        ...(writingGuidelines && { writingGuidelines }),
        ...(resolvedSeriesId && {
          seriesId: resolvedSeriesId,
          seriesOrder: resolvedSeriesOrder,
        }),
      },
    })

    return NextResponse.json(project, { status: 201 })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/projects]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
