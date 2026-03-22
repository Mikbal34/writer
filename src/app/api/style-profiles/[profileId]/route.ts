import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'

type RouteContext = { params: Promise<{ profileId: string }> }

// GET /api/style-profiles/[profileId]
export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { profileId } = await ctx.params

    const profile = await prisma.userStyleProfile.findFirst({
      where: { id: profileId, userId: session.user.id },
    })

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    return NextResponse.json(profile)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/style-profiles/[profileId]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/style-profiles/[profileId]
// Body: { name?: string, profile?: object }
export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { profileId } = await ctx.params

    const existing = await prisma.userStyleProfile.findFirst({
      where: { id: profileId, userId: session.user.id },
      select: { id: true },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const body = await req.json()
    const data: Prisma.UserStyleProfileUpdateInput = {}

    if (body.name !== undefined && typeof body.name === 'string' && body.name.trim()) {
      data.name = body.name.trim()
    }
    if (body.profile !== undefined) {
      data.profile = body.profile as Prisma.InputJsonValue
    }

    const updated = await prisma.userStyleProfile.update({
      where: { id: profileId },
      data,
    })

    return NextResponse.json(updated)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[PUT /api/style-profiles/[profileId]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/style-profiles/[profileId]
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { profileId } = await ctx.params

    const existing = await prisma.userStyleProfile.findFirst({
      where: { id: profileId, userId: session.user.id },
      select: { id: true },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    await prisma.userStyleProfile.delete({ where: { id: profileId } })

    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[DELETE /api/style-profiles/[profileId]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
