import { cookies } from 'next/headers'
import { createHmac, timingSafeEqual } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'

const COOKIE_NAME = 'admin_session'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function getSecret(): string {
  const s = process.env.ADMIN_SESSION_SECRET
  if (!s || s.length < 32) {
    throw new Error(
      'ADMIN_SESSION_SECRET env var is missing or too short (min 32 chars).'
    )
  }
  return s
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function b64urlDecode(input: string): Buffer {
  const pad = 4 - (input.length % 4)
  const padded = input + (pad < 4 ? '='.repeat(pad) : '')
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function sign(payload: string): string {
  return b64url(createHmac('sha256', getSecret()).update(payload).digest())
}

function verifySig(payload: string, sig: string): boolean {
  const expected = sign(payload)
  try {
    const a = Buffer.from(expected)
    const b = Buffer.from(sig)
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export interface AdminSessionPayload {
  adminId: string
  username: string
  expiresAt: number
}

export function encodeToken(payload: AdminSessionPayload): string {
  const body = b64url(JSON.stringify(payload))
  const sig = sign(body)
  return `${body}.${sig}`
}

export function decodeToken(token: string): AdminSessionPayload | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [body, sig] = parts
  if (!verifySig(body, sig)) return null
  try {
    const payload = JSON.parse(b64urlDecode(body).toString('utf8')) as AdminSessionPayload
    if (!payload.adminId || !payload.expiresAt || payload.expiresAt < Date.now()) {
      return null
    }
    return payload
  } catch {
    return null
  }
}

export async function setAdminCookie(payload: AdminSessionPayload): Promise<void> {
  const token = encodeToken(payload)
  const store = await cookies()
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(payload.expiresAt),
  })
}

export async function clearAdminCookie(): Promise<void> {
  const store = await cookies()
  store.delete(COOKIE_NAME)
}

export async function readAdminSession(): Promise<AdminSessionPayload | null> {
  const store = await cookies()
  const token = store.get(COOKIE_NAME)?.value
  if (!token) return null
  return decodeToken(token)
}

export class AdminAuthError extends Error {
  constructor(message = 'Unauthorized') {
    super(message)
    this.name = 'AdminAuthError'
  }
}

export async function requireAdmin(): Promise<AdminSessionPayload> {
  const session = await readAdminSession()
  if (!session) throw new AdminAuthError()
  return session
}

export async function verifyAdminCredentials(
  username: string,
  password: string
): Promise<{ id: string; username: string } | null> {
  const admin = await prisma.adminUser.findUnique({ where: { username } })
  if (!admin) return null
  const ok = await bcrypt.compare(password, admin.passwordHash)
  if (!ok) return null
  await prisma.adminUser.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date() },
  })
  return { id: admin.id, username: admin.username }
}

export async function hashAdminPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export { SESSION_TTL_MS, COOKIE_NAME }
