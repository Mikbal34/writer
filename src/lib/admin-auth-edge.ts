// Edge-runtime-safe admin session verification (middleware).
// Uses Web Crypto API — no Node APIs, no Prisma.

export interface AdminSessionPayload {
  adminId: string
  username: string
  expiresAt: number
}

function b64urlDecode(input: string): Uint8Array {
  const pad = 4 - (input.length % 4)
  const padded = input + (pad < 4 ? '='.repeat(pad) : '')
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToB64url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

async function hmacSign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return bytesToB64url(new Uint8Array(sig))
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function verifyAdminToken(
  token: string,
  secret: string
): Promise<AdminSessionPayload | null> {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [body, sig] = parts
  const expected = await hmacSign(body, secret)
  if (!timingSafeEqualStr(expected, sig)) return null
  try {
    const bytes = b64urlDecode(body)
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as AdminSessionPayload
    if (!payload.adminId || !payload.expiresAt || payload.expiresAt < Date.now()) {
      return null
    }
    return payload
  } catch {
    return null
  }
}

export const ADMIN_COOKIE_NAME = 'admin_session'
