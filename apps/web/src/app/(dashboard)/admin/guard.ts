import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { requireUser, type SessionUser } from '@/lib/session';
import { recordAudit } from '@sallycourse/db';

/**
 * Garde des pages admin (P57) : exige un utilisateur connecté ET de rôle
 * admin, sinon redirige. Non-connecté → /login (via requireUser) ;
 * connecté mais non-admin → /dashboard.
 *
 * Journal d'audit (P149) : chaque accès effectif à une page /admin/* est
 * journalisé (best-effort, ne bloque jamais l'affichage de la page). Un seul
 * point de câblage ici couvre toutes les pages admin qui appellent cette garde.
 */
export async function requireAdmin(section?: string): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== 'admin') redirect('/dashboard');

  const hdrs = await headers();
  void recordAudit({
    action: 'admin.access',
    userId: user.id,
    targetType: 'admin_page',
    targetId: section ?? 'admin',
    ip: hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? hdrs.get('x-real-ip') ?? undefined,
    userAgent: hdrs.get('user-agent') ?? undefined,
  });

  return user;
}
