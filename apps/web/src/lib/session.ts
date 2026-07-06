import { redirect } from 'next/navigation';
import type { Session } from 'next-auth';
import { auth } from './auth';

/** Utilisateur de session enrichi (id/role/plan/locale). */
export type SessionUser = Session['user'];

/**
 * Garde pour Server Components / Server Actions : retourne l'utilisateur
 * connecté ou redirige vers /login.
 */
export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  return session.user;
}

/**
 * Garde pour Route Handlers : retourne l'utilisateur connecté ou une
 * Response 401 JSON. Usage :
 *   const user = await requireApiUser();
 *   if (user instanceof Response) return user;
 */
export async function requireApiUser(): Promise<SessionUser | Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'Authentification requise.' }, { status: 401 });
  }
  return session.user;
}
