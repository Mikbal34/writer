import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_COOKIE_NAME, verifyAdminToken } from '@/lib/admin-auth-edge'

async function isAdminAuthed(req: NextRequest): Promise<boolean> {
  const secret = process.env.ADMIN_SESSION_SECRET
  if (!secret || secret.length < 32) return false
  const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value
  if (!token) return false
  const payload = await verifyAdminToken(token, secret)
  return payload !== null
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Public endpoints (no auth)
  if (
    pathname === '/analytics/login' ||
    pathname === '/api/admin/login' ||
    pathname === '/api/admin/logout'
  ) {
    return NextResponse.next()
  }

  const authed = await isAdminAuthed(req)

  // Guard /analytics pages → redirect to login
  if (pathname === '/analytics' || pathname.startsWith('/analytics/')) {
    if (!authed) {
      const url = req.nextUrl.clone()
      url.pathname = '/analytics/login'
      url.search = ''
      return NextResponse.redirect(url)
    }
    return NextResponse.next()
  }

  // Guard admin APIs → 401 JSON
  if (
    pathname === '/api/analytics' ||
    pathname === '/api/credits/admin' ||
    pathname.startsWith('/api/admin/')
  ) {
    if (!authed) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.next()
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/analytics',
    '/analytics/:path*',
    '/api/analytics',
    '/api/admin/:path*',
    '/api/credits/admin',
  ],
}
