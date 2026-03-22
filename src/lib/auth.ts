import { getServerSession as nextAuthGetServerSession, type NextAuthOptions, type Session } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { prisma } from '@/lib/db'


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
            amount: 50,
            balance: 50,
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
