import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

type CitationFormat = 'ISNAD' | 'APA' | 'CHICAGO' | 'MLA'

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
    } = body as {
      title: string
      description?: string
      topic?: string
      purpose?: string
      audience?: string
      citationFormat?: CitationFormat
      language?: string
    }

    if (!title || typeof title !== 'string' || title.trim() === '') {
      return NextResponse.json({ error: 'title is required' }, { status: 400 })
    }

    const validFormats: CitationFormat[] = ['ISNAD', 'APA', 'CHICAGO', 'MLA']
    if (citationFormat && !validFormats.includes(citationFormat)) {
      return NextResponse.json({ error: 'Invalid citationFormat' }, { status: 400 })
    }

    const project = await prisma.project.create({
      data: {
        userId,
        title: title.trim(),
        description: description ?? null,
        topic: topic ?? null,
        purpose: purpose ?? null,
        audience: audience ?? null,
        citationFormat: citationFormat ?? 'ISNAD',
        language: language ?? 'tr',
        status: 'roadmap',
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
