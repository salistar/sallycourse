import type { Metadata } from 'next';
import { AuditLog, connectDb } from '@sallycourse/db';
import { Badge, EmptyState } from '@/components/ui';
import { requireUser } from '@/lib/session';

/**
 * Réglages → "Mon activité" (P149, transparence) : l'utilisateur voit SES
 * PROPRES entrées du journal d'audit (connexions, changements de credentials
 * plateforme, déploiements, suppressions de cours). Lecture seule — le
 * journal est immuable (packages/db/src/models/audit-log.ts). Pas de données
 * d'autres utilisateurs : filtre systématique sur userId = l'utilisateur connecté.
 */

export const metadata: Metadata = {
  title: 'Mon activité — SallyCourse',
  description: 'Historique de vos actions sensibles : connexions, credentials, déploiements, suppressions.',
};

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 200;
const dateFormatter = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

const ACTION_LABELS: Record<string, string> = {
  login: 'Connexion réussie',
  'login.failed': 'Tentative de connexion échouée',
  register: 'Création du compte',
  logout: 'Déconnexion',
  'credentials.changed': 'Identifiants plateforme modifiés',
  'credentials.deleted': 'Identifiants plateforme supprimés',
  'deployment.created': 'Déploiement lancé',
  'course.deleted': 'Cours supprimé',
  'admin.access': 'Accès à l’espace admin',
};

export default async function MyActivityPage() {
  const user = await requireUser();

  await connectDb();

  const entries = await AuditLog.find({ userId: user.id }).sort({ createdAt: -1 }).limit(PAGE_SIZE).lean();

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold text-foreground">Mon activité</h1>
        <p className="max-w-2xl text-muted">
          Historique de vos actions sensibles sur ce compte : connexions, changements d&apos;identifiants
          plateforme, déploiements, suppressions de cours. Conservé 12 mois, jamais modifiable.
        </p>
      </header>

      {entries.length === 0 ? (
        <EmptyState title="Aucune activité enregistrée" description="Rien à afficher pour le moment." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface/60">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-start text-2xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 text-start font-semibold">Date</th>
                <th className="px-4 py-3 text-start font-semibold">Action</th>
                <th className="px-4 py-3 text-start font-semibold">Détail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={String(e._id)} className="border-b border-border/60 last:border-b-0">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">{dateFormatter.format(e.createdAt)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={e.action === 'login.failed' ? 'failed' : 'draft'} hideDot className="text-2xs">
                      {ACTION_LABELS[e.action] ?? e.action}
                    </Badge>
                  </td>
                  <td className="max-w-80 truncate px-4 py-3 text-xs text-muted" title={e.targetId}>
                    {e.targetType ? `${e.targetType}${e.targetId ? ` · ${e.targetId}` : ''}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
