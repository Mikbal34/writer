import { NextRequest, NextResponse } from 'next/server'
import {
  SESSION_TTL_MS,
  setAdminCookie,
  verifyAdminCredentials,
} from '@/lib/admin-auth'

export async function POST(req: NextRequest) {
  try {
    const { username, password } = (await req.json()) as {
      username?: string
      password?: string
    }

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Kullanici adi ve sifre gerekli' },
        { status: 400 }
      )
    }

    const admin = await verifyAdminCredentials(username, password)
    if (!admin) {
      return NextResponse.json(
        { error: 'Kullanici adi veya sifre hatali' },
        { status: 401 }
      )
    }

    await setAdminCookie({
      adminId: admin.id,
      username: admin.username,
      expiresAt: Date.now() + SESSION_TTL_MS,
    })

    return NextResponse.json({ ok: true, username: admin.username })
  } catch (err) {
    console.error('[POST /api/admin/login]', err)
    return NextResponse.json(
      { error: 'Sunucu hatasi' },
      { status: 500 }
    )
  }
}
