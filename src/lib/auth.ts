import { getServerSession as nextAuthGetServerSession, type NextAuthOptions, type Session } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import EmailProvider from 'next-auth/providers/email'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { Resend } from 'resend'
import { prisma } from '@/lib/db'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const FROM_EMAIL = process.env.EMAIL_FROM ?? 'Quilpen <onboarding@resend.dev>'

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as NextAuthOptions['adapter'],
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
      authorization: {
        params: {
          scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    }),
    EmailProvider({
      from: FROM_EMAIL,
      maxAge: 24 * 60 * 60, // 24 hours
      async sendVerificationRequest({ identifier: email, url }) {
        if (!resend) {
          throw new Error('RESEND_API_KEY is not set — magic-link email cannot be sent.')
        }
        const { host } = new URL(url)
        const { error } = await resend.emails.send({
          from: FROM_EMAIL,
          to: email,
          subject: `Quilpen'e giris yapin`,
          text: `Quilpen'e giris yapmak icin bu baglantiyi kullanin:\n\n${url}\n\nBu baglanti 24 saat gecerlidir. Bu istegi siz baslatmadiysaniz goz ardi edebilirsiniz.\n`,
          html: renderMagicLinkEmail({ url, host }),
        })
        if (error) {
          console.error('[auth] Resend failed:', error)
          throw new Error(`Email could not be sent: ${error.message}`)
        }
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({ token, user, account }) {
      // On first sign-in user object is available – persist id into token
      if (user?.id) {
        token.id = user.id
      }
      // Persist Google tokens to Account table on sign-in
      if (account?.provider === 'google' && user?.id) {
        try {
          await prisma.account.upsert({
            where: {
              provider_providerAccountId: {
                provider: account.provider,
                providerAccountId: account.providerAccountId,
              },
            },
            update: {
              access_token: account.access_token,
              refresh_token: account.refresh_token,
              expires_at: account.expires_at,
              token_type: account.token_type,
              scope: account.scope,
              id_token: account.id_token,
            },
            create: {
              userId: user.id,
              type: account.type,
              provider: account.provider,
              providerAccountId: account.providerAccountId,
              access_token: account.access_token,
              refresh_token: account.refresh_token,
              expires_at: account.expires_at,
              token_type: account.token_type,
              scope: account.scope,
              id_token: account.id_token,
            },
          })
        } catch (e) {
          console.error('[auth] Failed to persist account tokens:', e)
        }
      }
      return token
    },
    async session({ session, token }) {
      if (token.id && session.user) {
        // TypeScript will accept this after the module augmentation in next-auth.d.ts
        ;(session.user as Session['user'] & { id: string }).id = token.id as string
      }
      return session
    },
  },
  events: {
    async createUser({ user }) {
      try {
        await prisma.creditTransaction.create({
          data: {
            userId: user.id,
            amount: 1500,
            balance: 1500,
            type: 'initial_grant',
            metadata: { reason: 'signup_bonus' },
          },
        })
      } catch (e) {
        console.error('[auth] Failed to create initial credit grant:', e)
      }
    },
  },
  pages: {
    signIn: '/auth/signin',
  },
  debug: process.env.NODE_ENV === 'development',
  secret: process.env.NEXTAUTH_SECRET,
}

/**
 * Returns the session for the current server request.
 * Returns null when the user is not authenticated.
 *
 * Usage (Server Component / Route Handler):
 *   const session = await getServerSession()
 *   if (!session) redirect('/auth/signin')
 */
export async function getServerSession() {
  return nextAuthGetServerSession(authOptions)
}

function renderMagicLinkEmail({ url, host }: { url: string; host: string }): string {
  const escapedHost = host.replace(/\./g, '&#8203;.')
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#F5F0E6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0E6;padding:40px 20px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#FAF7F0;border:1px solid #d4c9b5;border-radius:4px;padding:40px;">
        <tr><td align="center" style="padding-bottom:24px;">
          <div style="font-family:Georgia,serif;font-size:24px;font-weight:700;color:#2D1F0E;">Quilpen</div>
          <div style="width:24px;height:2px;background:#C9A84C;margin:12px auto;"></div>
        </td></tr>
        <tr><td style="font-size:16px;color:#2D1F0E;line-height:1.6;padding-bottom:24px;">
          <strong>${escapedHost}</strong> uzerine giris icin asagidaki butona tiklayin. Baglanti 24 saat icinde gecerlidir.
        </td></tr>
        <tr><td align="center" style="padding:8px 0 32px;">
          <a href="${url}" style="display:inline-block;background:#2D1F0E;color:#FAF7F0;text-decoration:none;padding:14px 28px;border-radius:4px;font-weight:600;font-size:14px;">Giris Yap</a>
        </td></tr>
        <tr><td style="font-size:12px;color:#8a7a65;line-height:1.5;padding-top:24px;border-top:1px solid #e8e2d8;">
          Bu istegi siz baslatmadiysaniz goz ardi edebilirsiniz.<br>
          Buton calismiyorsa <a href="${url}" style="color:#C9A84C;">bu baglantiyi</a> kopyalayip tarayicinizda acin.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

export class AuthError extends Error {
  constructor(message = 'Unauthorized') {
    super(message)
    this.name = 'AuthError'
  }
}

// -----------------------------------------------------------------------
// Augmented session type: guarantees session.user.id is always present
// after requireAuth() resolves.
// -----------------------------------------------------------------------
export type AuthenticatedSession = Session & {
  user: NonNullable<Session['user']> & { id: string }
}

/**
 * Requires an authenticated session and returns it with a typed user.id.
 * Throws AuthError (callers should convert to a 401 response) when the
 * user is not signed in.
 *
 * Usage (Route Handler):
 *   const session = await requireAuth()
 *   const userId = session.user.id
 */
export async function requireAuth(): Promise<AuthenticatedSession> {
  const session = await getServerSession()
  if (!session || !session.user || !(session.user as { id?: string }).id) {
    throw new AuthError()
  }
  return session as AuthenticatedSession
}
