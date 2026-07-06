import type { DefaultSession } from 'next-auth';
import type { Locale, PlanId } from '@sallycourse/shared';

/** Rôle applicatif — miroir de l'enum du modèle User. */
export type UserRole = 'user' | 'admin';

declare module 'next-auth' {
  /** Session enrichie : id Mongo + claims métier exposés au front. */
  interface Session {
    user: {
      id: string;
      role: UserRole;
      plan: PlanId;
      locale: Locale;
    } & DefaultSession['user'];
  }

  /** Utilisateur retourné par authorize()/OAuth — champs métier optionnels. */
  interface User {
    role?: UserRole;
    plan?: PlanId;
    locale?: Locale;
  }
}

declare module 'next-auth/jwt' {
  /** Claims persistés dans le JWT. */
  interface JWT {
    id?: string;
    role?: UserRole;
    plan?: PlanId;
    locale?: Locale;
  }
}
