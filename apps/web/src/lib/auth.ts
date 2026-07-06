import NextAuth, { type NextAuthResult } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { compare, hash } from 'bcryptjs';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { connectDb, User as UserModel } from '@sallycourse/db';
import { authConfig, type AppJwtClaims } from './auth.config';

/**
 * Config Auth.js complète (runtime Node) : Credentials (email + mot de passe
 * vérifié via bcrypt contre UserModel) + Google conditionnel hérité de
 * auth.config.ts. Sessions JWT — les claims id/role/plan/locale sont posés
 * dans le callback jwt et exposés par le callback session (auth.config.ts).
 */

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

const nextAuth = NextAuth({
  ...authConfig,
  providers: [
    ...authConfig.providers,
    Credentials({
      name: 'Email et mot de passe',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Mot de passe', type: 'password' },
      },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        await connectDb();
        const user = await UserModel.findOne({ email: parsed.data.email });
        if (!user) return null;

        const valid = await compare(parsed.data.password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user._id.toString(),
          email: user.email,
          name: user.name,
          role: user.role,
          plan: user.plan,
          locale: user.locale,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    // À la connexion, recopie les claims métier dans le JWT.
    async jwt({ token, user, account }) {
      if (!user) return token;

      let enriched = user;

      // Connexion Google : synchronise (ou crée) le compte en base pour
      // obtenir un id Mongo stable + plan/rôle/locale réels.
      if (account?.provider === 'google' && user.email) {
        await connectDb();
        const email = user.email.toLowerCase();
        let doc = await UserModel.findOne({ email });
        if (!doc) {
          doc = await UserModel.create({
            email,
            name: user.name ?? email.split('@')[0],
            // Mot de passe aléatoire inutilisable : ce compte passe par Google.
            passwordHash: await hash(randomUUID(), 10),
            plan: 'free',
          });
        }
        enriched = {
          ...user,
          id: doc._id.toString(),
          role: doc.role,
          plan: doc.plan,
          locale: doc.locale,
        };
      }

      Object.assign(token, {
        id: enriched.id ?? token.sub,
        role: enriched.role ?? 'user',
        plan: enriched.plan ?? 'free',
        locale: enriched.locale ?? 'fr',
      } satisfies AppJwtClaims);
      return token;
    },
  },
});

// Annotations explicites via NextAuthResult : évite le TS2742 « not
// portable » (chemins .pnpm de @auth/core) sur les exports inférés.
export const handlers: NextAuthResult['handlers'] = nextAuth.handlers;
export const auth: NextAuthResult['auth'] = nextAuth.auth;
export const signIn: NextAuthResult['signIn'] = nextAuth.signIn;
export const signOut: NextAuthResult['signOut'] = nextAuth.signOut;
