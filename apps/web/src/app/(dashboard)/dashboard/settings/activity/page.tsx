import type { Metadata } from 'next';
import { AuditLog, connectDb } from '@sallycourse/db';
import { Badge, EmptyState } from '@/components/ui';
import { requireUser } from '@/lib/session';
import { getTranslations } from 'next-intl/server';

/**
 * Réglages → "Mon activité" (P149, transparence) : l'utilisateur voit SES
 * PROPRES entrées du journal d'audit (connexions, changements de credentials
 * plateforme, déploiements, suppressions de cours). Lecture seule — le
 * journal est immuable (packages/db/src/models/audit-log.ts). Pas de données
 * d'autres utilisateurs : filtre systématique sur userId = l'utilisateur connecté.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.activity');
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 200;
const dateFormatter = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

const ACTION_LABEL_KEYS: Record<string, string> = {
  login: 'actions.login',
  'login.failed': 'actions.loginFailed',
  register: 'actions.register',
  logout: 'actions.logout',
  'credentials.changed': 'actions.credentialsChanged',
  'credentials.deleted': 'actions.credentialsDeleted',
  'deployment.created': 'actions.deploymentCreated',
  'course.deleted': 'actions.courseDeleted',
  'admin.access': 'actions.adminAccess',
};

export default async function MyActivityPage() {
  const user = await requireUser();
  const t = await getTranslations('settings.activity');

  await connectDb();

  const entries = await AuditLog.find({ userId: user.id }).sort({ createdAt: -1 }).limit(PAGE_SIZE).lean();

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold text-foreground">{t('title')}</h1>
        <p className="max-w-2xl text-muted">{t('description')}</p>
      </header>

      {entries.length === 0 ? (
        <EmptyState title={t('empty.title')} description={t('empty.description')} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface/60">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-start text-2xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 text-start font-semibold">{t('table.date')}</th>
                <th className="px-4 py-3 text-start font-semibold">{t('table.action')}</th>
                <th className="px-4 py-3 text-start font-semibold">{t('table.detail')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={String(e._id)} className="border-b border-border/60 last:border-b-0">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">{dateFormatter.format(e.createdAt)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={e.action === 'login.failed' ? 'failed' : 'draft'} hideDot className="text-2xs">
                      {ACTION_LABEL_KEYS[e.action] ? t(ACTION_LABEL_KEYS[e.action]) : e.action}
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
