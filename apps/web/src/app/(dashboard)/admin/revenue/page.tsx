import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AdminNav } from '@/components/admin';
import { Card, CardContent, CardHeader, CardTitle, BarChart } from '@/components/ui';
import { requireAdmin } from '../guard';
import { loadAllRevenueEntries } from '@/lib/revenue-data';
import { aggregateMonthlyRevenue, totalBySource, totalRevenue } from '@/lib/revenue-aggregate';

/**
 * Tableau de bord revenus consolidé (P99) : agrège Udemy/YouTube
 * (CourseAnalytics.revenue), abonnements SaaS (CMI/Paddle) et Gumroad (0
 * documenté — pas de flux de revenu fiable exposé par l'adapter actuel), tout
 * converti en USD via la table de taux statique (@sallycourse/shared/fx-rates).
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.revenue');
  return {
    title: t('metaTitle'),
  };
}

export const dynamic = 'force-dynamic';

const usd2 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

const SOURCE_LABELS: Record<'udemy' | 'youtube' | 'subscription' | 'gumroad', string> = {
  udemy: 'source.udemy',
  youtube: 'source.youtube',
  subscription: 'source.subscription',
  gumroad: 'source.gumroad',
};

export default async function AdminRevenuePage() {
  await requireAdmin();
  const t = await getTranslations('admin.revenue');

  const entries = await loadAllRevenueEntries();
  const grandTotal = totalRevenue(entries, 'USD');
  const bySource = totalBySource(entries, 'USD');
  const monthly = aggregateMonthlyRevenue(entries, 'USD', 12);

  const barPoints = monthly.map((m) => ({ label: m.month.slice(2), value: m.totalConverted }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted">
            {t('subtitle', { path: 'packages/shared/src/fx-rates.ts' })}
          </p>
        </div>
        <a
          href="/api/admin/revenue/export"
          className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-4 py-2 text-sm font-semibold text-foreground transition-colors duration-fast hover:bg-primary-soft/80"
        >
          {t('exportCsv')}
        </a>
      </div>

      <AdminNav />

      {/* Synthèse */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted">{t('totalRevenue')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums text-foreground">{usd2.format(grandTotal)}</p>
          </CardContent>
        </Card>
        {(['udemy', 'youtube', 'subscription', 'gumroad'] as const).map((source) => (
          <Card key={source}>
            <CardHeader>
              <CardTitle className="text-sm text-muted">{t(SOURCE_LABELS[source])}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-display text-2xl font-semibold tabular-nums text-foreground">
                {usd2.format(bySource[source])}
              </p>
              {source === 'gumroad' && bySource.gumroad === 0 ? (
                <p className="mt-1 text-2xs text-muted">
                  {t('gumroadNotExposed')}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Graphique mensuel */}
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold text-foreground">{t('monthlyRevenueTitle')}</h2>
        <Card>
          <CardContent className="p-6">
            <BarChart points={barPoints} formatValue={(v) => usd2.format(v)} height={200} />
          </CardContent>
        </Card>
      </section>

      {/* Détail mensuel par source */}
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold text-foreground">{t('monthlyDetailTitle')}</h2>
        <div className="overflow-x-auto rounded-lg border border-border bg-surface/60">
          <table className="w-full min-w-[56rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-start text-2xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 text-start font-semibold">{t('colMonth')}</th>
                <th className="px-4 py-3 text-end font-semibold">Udemy</th>
                <th className="px-4 py-3 text-end font-semibold">YouTube</th>
                <th className="px-4 py-3 text-end font-semibold">{t('colSubscriptions')}</th>
                <th className="px-4 py-3 text-end font-semibold">Gumroad</th>
                <th className="px-4 py-3 text-end font-semibold">{t('colTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((m) => (
                <tr key={m.month} className="border-b border-border/60 last:border-b-0">
                  <td className="px-4 py-3 font-medium text-foreground">{m.month}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-muted">{usd2.format(m.bySource.udemy)}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-muted">{usd2.format(m.bySource.youtube)}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-muted">
                    {usd2.format(m.bySource.subscription)}
                  </td>
                  <td className="px-4 py-3 text-end tabular-nums text-muted">{usd2.format(m.bySource.gumroad)}</td>
                  <td className="px-4 py-3 text-end font-semibold tabular-nums text-foreground">
                    {usd2.format(m.totalConverted)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-2xs text-muted">
          {t('fxNote', { path: 'packages/shared/src/fx-rates.ts' })}
        </p>
      </section>
    </div>
  );
}
