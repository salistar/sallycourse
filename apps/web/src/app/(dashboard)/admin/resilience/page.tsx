import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { AdminNav, CronTriggersPanel } from '@/components/admin';
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@/components/ui';
import { cn } from '@/lib/cn';
import { requireAdmin } from '../guard';
import { degradedCount, severityOf, sortBreakers, type BreakerSeverity } from './breaker-view';
import { readCircuitBreakerSnapshots } from './read-circuit-breakers';

/**
 * Dashboard admin « Résilience » (P77 — mode dégradé) : état courant de chaque
 * circuit breaker du worker (ElevenLabs→OpenAI, …), dernière erreur et prochain
 * essai. Les instantanés sont persistés par le worker dans Redis à chaque
 * transition d'état (voir apps/worker/src/lib/circuit-breaker.ts) — cette page
 * ne fait que les lire, aucun accès à la mémoire du process worker.
 *
 * Déploiement multi-plateformes (P77) : chaque plateforme (Udemy, YouTube, …)
 * est un job BullMQ indépendant sur la queue `deployment` (un job = un couple
 * cours/plateforme, voir processDeployment). Un échec sur une plateforme jette
 * dans SON job uniquement — les autres jobs de la même vague de déploiement
 * continuent sans être affectés (isolation native BullMQ, aucun changement
 * requis ici) ; le statut par plateforme reste visible sur /admin/jobs et la
 * page de déploiement du cours.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.resilience');
  return {
    title: t('metaTitle'),
  };
}

export const dynamic = 'force-dynamic';

const STATE_LABELS: Record<string, string> = {
  closed: 'state.closed',
  'half-open': 'state.halfOpen',
  open: 'state.open',
};

const SEVERITY_BADGE: Record<BreakerSeverity, 'published' | 'generating' | 'failed'> = {
  ok: 'published',
  warning: 'generating',
  critical: 'failed',
};

export default async function AdminResiliencePage() {
  await requireAdmin();

  const t = await getTranslations('admin.resilience');
  const format = await getFormatter();
  const formatTs = (ts: number | null): string =>
    ts === null ? '—' : format.dateTime(new Date(ts), { dateStyle: 'short', timeStyle: 'medium' });

  const snapshots = await readCircuitBreakerSnapshots();
  const sorted = sortBreakers(snapshots);
  const degraded = degradedCount(snapshots);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
      </div>

      <AdminNav />

      <CronTriggersPanel />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted">{t('cards.monitored')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums text-foreground">{sorted.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted">{t('cards.degraded')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={cn(
                'font-display text-2xl font-semibold tabular-nums',
                degraded > 0 ? 'text-danger' : 'text-foreground',
              )}
            >
              {degraded}
            </p>
          </CardContent>
        </Card>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold text-foreground">{t('sections.breakers')}</h2>
        {sorted.length === 0 ? (
          <EmptyState
            title={t('empty.title')}
            description={t('empty.description')}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface/60">
            <table className="w-full min-w-[56rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-start text-2xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 text-start font-semibold">{t('table.breaker')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t('table.state')}</th>
                  <th className="px-4 py-3 text-end font-semibold">{t('table.failures')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t('table.lastError')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t('table.nextAttempt')}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((b) => {
                  const severity = severityOf(b.state);
                  return (
                    <tr
                      key={b.name}
                      className={cn(
                        'border-b border-border/60 last:border-b-0',
                        severity === 'critical' && 'bg-danger/5',
                      )}
                    >
                      <td className="px-4 py-3 font-medium text-foreground">{b.name}</td>
                      <td className="px-4 py-3">
                        <Badge variant={SEVERITY_BADGE[severity]}>{STATE_LABELS[b.state] ? t(STATE_LABELS[b.state]) : b.state}</Badge>
                      </td>
                      <td className="px-4 py-3 text-end tabular-nums text-muted">{b.failureCount}</td>
                      <td className="max-w-96 truncate px-4 py-3 text-muted" title={b.lastError ?? undefined}>
                        {b.lastError ? `${b.lastError} (${formatTs(b.lastErrorAt)})` : '—'}
                      </td>
                      <td className="px-4 py-3 text-muted">{formatTs(b.nextAttemptAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-2xs text-muted">{t('fallbackNote')}</p>
      </section>

      <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface/60 p-5">
        <h2 className="font-display text-lg font-semibold text-foreground">{t('sections.deployment')}</h2>
        <p className="text-sm text-muted">
          {t.rich('deploymentBody', {
            code: (chunks) => (
              <code className="rounded bg-surface-subtle px-1 py-0.5 text-2xs">{chunks}</code>
            ),
            link: (chunks) => (
              <a href="/admin/jobs" className="font-medium text-accent hover:underline">
                {chunks}
              </a>
            ),
          })}
        </p>
      </section>
    </div>
  );
}
