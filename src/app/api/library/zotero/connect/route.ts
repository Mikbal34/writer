import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { verifyApiKey } from '@/lib/zotero'
import { getRequestToken } from '@/lib/zotero-oauth'

/**
 * POST /api/library/zotero/connect
 *
 * Two modes:
 * 1. OAuth flow (default): Returns { authorizeUrl } — frontend redirects user to Zotero
 * 2. Manual API key: If body contains { apiKey, zoteroUserId } — direct connection (fallback)
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()
    const userId = session.user.id
    const body = await req.json().catch(() => ({}))

    // Mode 2: Manual API key (fallback if OAuth not configured)
    if (body.apiKey && body.zoteroUserId) {
      const valid = await verifyApiKey(body.zoteroUserId, body.apiKey)
      if (!valid) {
        return NextResponse.json(
          { error: 'Invalid Zotero API key or user ID' },
          { status: 400 }
        )
      }

      await prisma.zoteroConnection.upsert({
        where: { userId },
        create: {
          userId,
          apiKey: body.apiKey.trim(),
          zoteroUserId: body.zoteroUserId.trim(),
        },
        update: {
          apiKey: body.apiKey.trim(),
          zoteroUserId: body.zoteroUserId.trim(),
        },
      })

      return NextResponse.json({ connected: true })
    }

    // Mode 1: OAuth flow
    const hasOAuthConfig = process.env.ZOTERO_CLIENT_KEY && process.env.ZOTERO_CLIENT_SECRET
    if (!hasOAuthConfig) {
      return NextResponse.json(
        { error: 'OAuth not configured. Use manual API key mode.', needsManual: true },
        { status: 400 }
      )
    }

    const { oauthToken, oauthTokenSecret, authorizeUrl } = await getRequestToken()

    // Store request token temporarily (keyed by userId)
    // Using a simple DB field — store in ZoteroConnection with a "pending" state
    await prisma.zoteroConnection.upsert({
      where: { userId },
      create: {
        userId,
        apiKey: `pending:${oauthTokenSecret}`, // Temporary: stores token secret
        zoteroUserId: oauthToken, // Temporary: stores request token
      },
      update: {
        apiKey: `pending:${oauthTokenSecret}`,
        zoteroUserId: oauthToken,
      },
    })

    return NextResponse.json({ authorizeUrl })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library/zotero/connect]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
