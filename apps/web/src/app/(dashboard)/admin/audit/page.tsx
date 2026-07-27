import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, getFormatter } from 'next-intl/server';
import { AuditLog, User, connectDb, AUDIT_ACTIONS } from '@sallycourse/db';
import { AdminNav } from '@/components/admin';
import { Badge, EmptyState } from '@/components/ui';
import { requireAdmin } from '../guard';
import { buildAuditLogFilter } from '@/lib/audit-log-query';

/**
 * Page admin "Audit global" (P149) : liste filtrable de TOUTES les entrées du
 * journal d'audit (login, credentials plateforme, déploiement, suppression de
 * cours, accès admin...). Filtrable par action, utilisateur (email) et
 * fenêtre de date. Lecture seule — le journal est immuable (voir
 * packages/db/src/models/audit-log.ts). Export CSV via /api/admin/audit/export
 * (mêmes filtres, transmis en query string).
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.audit');
  return { title: t('metaTitle') };
}

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 200;

const ACTION_LABELS: Record<string, string> = {
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

interface AdminAuditPageProps {
  searchParams: Promise<{ action?: string; email?: string; from?: string; to?: string }>;
}

export default async function AdminAuditPage({ searchParams }: AdminAuditPageProps) {
  await requireAdmin('audit');
  const t = await getTranslations('admin.audit');
  const format = await getFormatter();
  const { action, email, from, to } = await searchParams;

  await connectDb();

  // Résolution email → userId (le filtre Mongo porte sur userId, pas sur l'email).
  let userId: string | undefined;
  if (email?.trim()) {
    const match = await User.findOne({ email: email.trim().toLowerCase() }).select('_id').lean();
    userId = match ? String(match._id) : '__no_match__'; // valeur inatteignable : liste vide si email inconnu
  }

  const filter = buildAuditLogFilter({ userId, action: action as never, from, to });

  const entries = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(PAGE_SIZE).lean();

  const userIds = [...new Set(entries.filter((e) => e.userId).map((e) => String(e.userId)))];
  const users = userIds.length > 0 ? await User.find({ _id: { $in: userIds } }).select('email').lean() : [];
  const emailById = new Map(users.map((u) => [String(u._id), u.email]));

  // Query string réutilisée pour l'export CSV (mêmes filtres).
  const exportParams = new URLSearchParams();
  if (action) exportParams.set('action', action);
  if (email) exportParams.set('email', email);
  if (from) exportParams.set('from', from);
  if (to) exportParams.set('to', to);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('description')}</p>
        </div>
        <a
          href={`/api/admin/audit/export?${exportParams.toString()}`}
          className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-4 py-2 text-sm font-semibold text-foreground transition-colors duration-fast hover:bg-primary-soft/80"
        >
          {t('exportCsv')}
        </a>
      </div>

      <AdminNav />

      {/* Filtres — formulaire GET natif, aucun JS requis. */}
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface/60 p-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="action" className="px-1 text-xs font-semibold text-muted">
            {t('actionLabel')}
          </label>
          <select
            id="action"
            name="action"
            defaultValue={action ?? 'all'}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
          >
            <option value="all">{t('allActions')}</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABELS[a] ? t(ACTION_LABELS[a]) : a}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="px-1 text-xs font-semibold text-muted">
            {t('emailLabel')}
          </label>
          <input
            id="email"
            name="email"
            type="email"
            defaultValue={email ?? ''}
            placeholder="alice@example.com"
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="from" className="px-1 text-xs font-semibold text-muted">
            {t('fromLabel')}
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={from ?? ''}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="to" className="px-1 text-xs font-semibold text-muted">
            {t('toLabel')}
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={to ?? ''}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
          />
        </div>
        <button
          type="submit"
          className="rounded-full bg-primary-400 px-4 py-2 text-sm font-semibold text-white transition-colors duration-fast hover:bg-primary-400/90"
        >
          {t('filter')}
        </button>
        {(action || email || from || to) && (
          <Link href="/admin/audit" className="text-sm text-muted underline-offset-2 hover:underline">
            {t('reset')}
          </Link>
        )}
      </form>

      {entries.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface/60">
          <table className="w-full min-w-[64rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-start text-2xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 text-start font-semibold">{t('colDate')}</th>
                <th className="px-4 py-3 text-start font-semibold">{t('colUser')}</th>
                <th className="px-4 py-3 text-start font-semibold">{t('colAction')}</th>
                <th className="px-4 py-3 text-start font-semibold">{t('colTarget')}</th>
                <th className="px-4 py-3 text-start font-semibold">{t('colIp')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={String(e._id)} className="border-b border-border/60 last:border-b-0 hover:bg-primary-soft/30">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">{format.dateTime(e.createdAt, { dateStyle: 'short', timeStyle: 'medium' })}</td>
                  <td className="max-w-56 truncate px-4 py-3 text-foreground" title={e.userId ? emailById.get(String(e.userId)) : undefined}>
                    {e.userId ? (emailById.get(String(e.userId)) ?? String(e.userId)) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={e.action === 'login.failed' ? 'failed' : 'draft'} hideDot className="text-2xs">
                      {ACTION_LABELS[e.action] ? t(ACTION_LABELS[e.action]) : e.action}
                    </Badge>
                  </td>
                  <td className="max-w-56 truncate px-4 py-3 text-xs text-muted" title={e.targetId}>
                    {e.targetType ? `${e.targetType} · ${e.targetId ?? '—'}` : '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">{e.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
