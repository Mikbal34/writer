import { createHash } from 'node:crypto'

export function hashCode(code: string, email: string): string {
  const secret = process.env.NEXTAUTH_SECRET ?? ''
  return createHash('sha256').update(`${email.toLowerCase()}:${code}:${secret}`).digest('hex')
}

export function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}
