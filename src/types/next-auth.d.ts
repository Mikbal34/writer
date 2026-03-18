import type { DefaultSession } from 'next-auth'

// Augment the built-in Session / JWT types so TypeScript knows
// that session.user.id is always present after the JWT callback.
declare module 'next-auth' {
  interface Session {
    user: {
      id: string
    } & DefaultSession['user']
  }

  interface User {
    id: string
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string
  }
}
