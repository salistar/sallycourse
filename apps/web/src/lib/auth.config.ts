import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';
import type { Locale, PlanId } from '@sallycourse/shared';

/**
 * Claims métier embarqués dans le JWT. Doublonne l'augmentation de
 * types/next-auth.d.ts : avec pnpm, `declare module 'next-auth/jwt'` ne
 * fusionne pas avec l'interface réelle (réexport de @auth/core/jwt) — on
 * type donc explicitement les lectures/écritures du token.
 */
export interface AppJwtClaims {
  id?: string;
  role?: 'user' | 'admin';
  plan?: PlanId;
  locale?: Locale;
}

/**
 * Config Auth.js edge-safe : AUCUN import Node/Mongoose ici, car ce module
 * est consommé par le middleware (runtime edge). La config complète
 * (Credentials + accès base) vit dans src/lib/auth.ts.
 */

// Google OAuth activé uniquement si les identifiants sont fournis.
const providers: NextAuthConfig['providers'] = [];
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  );
}

// Annotation explicite (pas de `satisfies`) : évite le TS2742 « not portable »
// dû aux chemins .pnpm de @auth/core.
export const authConfig: NextAuthConfig = {
  providers,
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  callbacks: {
    // Expose les claims métier du JWT côté session (Server Components + client).
    session({ session, token }) {
      const claims = token as typeof token & AppJwtClaims;
      session.user.id = claims.id ?? token.sub ?? '';
      session.user.role = claims.role ?? 'user';
      session.user.plan = claims.plan ?? 'free';
      session.user.locale = claims.locale ?? 'fr';
      return session;
    },
  },
};
