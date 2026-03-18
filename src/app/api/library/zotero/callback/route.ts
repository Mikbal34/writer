import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getAccessToken } from '@/lib/zotero-oauth'

/**
 * GET /api/library/zotero/callback
 *
 * Zotero redirects here after user authorizes.
 * Query params: oauth_token, oauth_verifier
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth()
    const userId = session.user.id

    const url = new URL(req.url)
    const oauthToken = url.searchParams.get('oauth_token')
    const oauthVerifier = url.searchParams.get('oauth_verifier')

    if (!oauthToken || !oauthVerifier) {
      return NextResponse.redirect(new URL('/library?zotero=error&reason=missing_params', req.url))
    }

    // Retrieve stored request token secret
    const pending = await prisma.zoteroConnection.findUnique({
      where: { userId },
    })

    if (!pending || !pending.apiKey.startsWith('pending:')) {
      return NextResponse.redirect(new URL('/library?zotero=error&reason=no_pending', req.url))
    }

    const oauthTokenSecret = pending.apiKey.replace('pending:', '')

    // Exchange for access token
    const { accessToken, zoteroUserId, username } = await getAccessToken(
      oauthToken,
      oauthTokenSecret,
      oauthVerifier
    )

    // Update connection with real credentials
    await prisma.zoteroConnection.update({
      where: { userId },
      data: {
        apiKey: accessToken,
        zoteroUserId,
      },
    })

    // Redirect back to library page with success
    const successUrl = new URL('/library?zotero=connected', req.url)
    if (username) successUrl.searchParams.set('username', username)
    return NextResponse.redirect(successUrl)
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.redirect(new URL('/library?zotero=error&reason=unauthorized', req.url))
    }
    console.error('[GET /api/library/zotero/callback]', err)
    return NextResponse.redirect(new URL('/library?zotero=error&reason=exchange_failed', req.url))
  }
}
