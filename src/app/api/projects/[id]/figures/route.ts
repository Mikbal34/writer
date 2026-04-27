/**
 * POST /api/projects/[id]/figures
 *
 * Manual figure upload — accepts multipart/form-data with a single
 * `file` field (PNG / JPG / SVG). Stored as a ProjectImage row with
 * `prompt = 'manual_upload'` so the rest of the pipeline knows it
 * isn't AI-generated. Returns the new image id; the user references
 * it in markdown via `![](upload:<id>)`.
 *
 * Academic exports look up these uploads at render time and embed
 * with the per-format figure caption pipeline.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

type RouteContext = { params: Promise<{ id: string }> }

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id: projectId } = await ctx.params

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: session.user.id },
      select: { id: true },
    })
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'File too large (10 MB max)' }, { status: 413 })
    }

    const accepted = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp', 'image/gif']
    if (!accepted.includes(file.type)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.type}. Accepted: ${accepted.join(', ')}` },
        { status: 400 }
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const created = await prisma.projectImage.create({
      data: {
        projectId,
        imageData: buffer,
        prompt: 'manual_upload',
        style: file.type,
        layout: 'inline',
        position: 'after',
        sortOrder: 0,
      },
      select: { id: true },
    })

    return NextResponse.json({
      id: created.id,
      markdown: `![${file.name}](upload:${created.id})`,
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/projects/[id]/figures]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
