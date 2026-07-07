import { redirect } from 'next/navigation';
import { requireUser, type SessionUser } from '@/lib/session';

/**
 * Garde des pages admin (P57) : exige un utilisateur connecté ET de rôle
 * admin, sinon redirige. Non-connecté → /login (via requireUser) ;
 * connecté mais non-admin → /dashboard.
 */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== 'admin') redirect('/dashboard');
  return user;
}
