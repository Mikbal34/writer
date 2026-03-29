import { NextRequest } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'

type RouteContext = { params: Promise<{ id: string; imageId: string }> }

// GET — serve image binary
export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    await requireAuth()
    const { id: projectId, imageId } = await ctx.params

    const image = await prisma.projectImage.findFirst({
      where: { id: imageId, projectId },
      select: { imageData: true },
    })

    if (!image) {
      return new Response('Not found', { status: 404 })
    }

    return new Response(image.imageData, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return new Response('Unauthorized', { status: 401 })
    }
    return new Response('Internal server error', { status: 500 })
  }
}

// PATCH — update image (assign chapter, change sort order)
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id: projectId, imageId } = await ctx.params

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: session.user.id },
      select: { id: true },
    })
    if (!project) {
      return new Response('Not found', { status: 404 })
    }

    const body = await req.json()
    const data: Record<string, unknown> = {}
    if ('chapterId' in body) data.chapterId = body.chapterId ?? null
    if ('subsectionId' in body) data.subsectionId = body.subsectionId ?? null
    if ('sortOrder' in body) data.sortOrder = body.sortOrder
    if ('layout' in body) data.layout = body.layout
    if ('position' in body) data.position = body.position
    if ('widthPercent' in body) data.widthPercent = body.widthPercent
    if ('posX' in body) data.posX = body.posX
    if ('posY' in body) data.posY = body.posY

    await prisma.projectImage.update({
      where: { id: imageId },
      data,
    })

    return Response.json({ success: true })
  } catch (err) {
    if (err instanceof AuthError) {
      return new Response('Unauthorized', { status: 401 })
    }
    return new Response('Internal server error', { status: 500 })
  }
}

// DELETE — remove an image
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id: projectId, imageId } = await ctx.params

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: session.user.id },
      select: { id: true },
    })
    if (!project) {
      return new Response('Not found', { status: 404 })
    }

    await prisma.projectImage.delete({
      where: { id: imageId },
    })

    return new Response(null, { status: 204 })
  } catch (err) {
    if (err instanceof AuthError) {
      return new Response('Unauthorized', { status: 401 })
    }
    return new Response('Internal server error', { status: 500 })
  }
}
