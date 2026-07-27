import type { Metadata } from 'next';
import type { Types } from 'mongoose';
import { getTranslations } from 'next-intl/server';
import { Course, User, CostRecord, connectDb } from '@sallycourse/db';
import { COURSE_COST_ALERT_USD, HETZNER_USD_PER_HOUR, type PlanId } from '@sallycourse/shared';
import { AdminNav } from '@/components/admin';
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@/components/ui';
import { cn } from '@/lib/cn';
import { requireAdmin } from '../guard';
import {
  costByCourse,
  marginByPlan,
  usageByCourse,
  compareCourseCost,
  costByProvider,
  usageTimeline,
  type CostRow,
} from './cost-stats';
import { deriveCacheStats, overallHitRate, totalEstimatedSavingsUsd } from './cache-stats';
import { readCacheCounts } from './read-cache-stats';
import { UsageTimelineChart, ProviderUsageBars } from './usage-charts';

/**
 * Dashboard admin des coûts de génération (P55) : coût par cours (ventilé par
 * nature), marge par plan (revenu − coût), et alertes sur les cours qui
 * dépassent le seuil. Les montants sont ré-estimés depuis la table de tarifs
 * partagée à partir des métriques brutes conservées sur chaque CostRecord.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.costsPage');
  return {
    title: t('metaTitle'),
  };
}

export const dynamic = 'force-dynamic';

/** Limite de cours affichés dans le tableau détaillé (les plus chers). */
const COURSE_LIMIT = 100;

const usd = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });
const usd2 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

const KIND_LABELS: Record<CostRow['kind'], string> = {
  claude: 'costKind.claude',
  tts: 'costKind.tts',
  render: 'costKind.render',
  image: 'costKind.image',
  // Whisper + avatar (audit coûts 2026-07-26).
  transcribe: 'costKind.transcribe',
  avatar: 'costKind.avatar',
};

export default async function AdminCostsPage() {
  await requireAdmin();
  await connectDb();
  const t = await getTranslations('admin.costsPage');

  // Lignes de coût brutes (métriques + contexte) — ré-estimation côté pur.
  const records = await CostRecord.find({})
    .select('courseId userId kind tokensIn tokensOut chars seconds model createdAt')
    .lean();

  const rows: CostRow[] = records.map((r) => ({
    courseId: String(r.courseId),
    userId: String(r.userId),
    kind: r.kind,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    chars: r.chars,
    seconds: r.seconds,
    model: r.model,
    createdAt: r.createdAt,
  }));

  const courseCosts = costByCourse(rows);

  // ── Usage par provider + historique 30 jours (dashboard providers) ──────────
  const providerUsage = costByProvider(rows);
  const today = new Date().toISOString().slice(0, 10);
  const timeline = usageTimeline(rows, today, 30);

  // ── Marge par plan : coût par plan (via propriétaire → plan) + effectifs ──
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const users = await User.find({ _id: { $in: userIds } })
    .select('plan')
    .lean();
  const planByUser = new Map(users.map((u) => [(u._id as Types.ObjectId).toString(), (u.plan as PlanId) ?? 'free']));

  const costByPlan: Record<string, number> = {};
  for (const c of courseCosts) {
    const plan = planByUser.get(c.userId) ?? 'free';
    costByPlan[plan] = (costByPlan[plan] ?? 0) + c.totalUsd;
  }

  // Effectifs par plan sur toute la base (revenu = prix × nb utilisateurs actifs).
  const planCounts = await User.aggregate<{ _id: string; count: number }>([
    { $group: { _id: '$plan', count: { $sum: 1 } } },
  ]);
  const activeUsersByPlan: Record<string, number> = {};
  for (const p of planCounts) activeUsersByPlan[p._id] = p.count;

  const margins = marginByPlan(costByPlan, activeUsersByPlan);

  // ── Titres des cours (jointure mémoire) + alertes ────────────────────────
  const shown = courseCosts.slice(0, COURSE_LIMIT);
  const courseIds = shown.map((c) => c.courseId);
  const courses = await Course.find({ _id: { $in: courseIds } })
    .select('title locale providerMix')
    .lean();
  const titleById = new Map(courses.map((c) => [(c._id as Types.ObjectId).toString(), c.title]));
  const localeById = new Map(courses.map((c) => [(c._id as Types.ObjectId).toString(), c.locale]));
  const providerMixById = new Map(courses.map((c) => [(c._id as Types.ObjectId).toString(), c.providerMix]));

  const alerts = courseCosts.filter((c) => c.overThreshold);
  const grandTotal = courseCosts.reduce((acc, c) => acc + c.totalUsd, 0);

  // ── Comparateur cloud vs OSS (P160) : coût OSS ré-estimé depuis les mêmes
  // métriques brutes, mix recommandé (langue rare/plan business → cloud pour
  // le llm) et mix réellement utilisé (Course.providerMix, défaut OSS si absent) ──
  const usageMap = usageByCourse(rows);
  const comparisons = shown.map((c) => {
    const plan = planByUser.get(c.userId) ?? 'free';
    const locale = localeById.get(c.courseId) ?? 'fr';
    return compareCourseCost({
      courseId: c.courseId,
      cloudTotalUsd: c.totalUsd,
      usage: usageMap.get(c.courseId) ?? { tokensIn: 0, tokensOut: 0, chars: 0, renderSeconds: 0, images: 0 },
      locale,
      plan,
      actualMix: providerMixById.get(c.courseId) as
        | { llm: 'oss' | 'cloud'; tts: 'oss' | 'cloud'; image: 'oss' | 'cloud' }
        | undefined,
    });
  });
  const comparisonByCourse = new Map(comparisons.map((c) => [c.courseId, c]));
  const ossTotal = comparisons.reduce((acc, c) => acc + c.ossTotalUsd, 0);
  const MIX_LABELS: Record<'oss' | 'cloud', string> = { oss: 'OSS', cloud: 'Cloud' };

  // ── Cache intelligent (P72) : taux de hit + économie estimée par namespace ──
  const cacheCounts = await readCacheCounts();
  const cacheStats = deriveCacheStats(cacheCounts);
  const cacheSavingsTotal = totalEstimatedSavingsUsd(cacheStats);
  const cacheHitRateOverall = overallHitRate(cacheStats);
  const percent = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 });

  const CACHE_NAMESPACE_LABELS: Record<(typeof cacheStats)[number]['namespace'], string> = {
    claude: 'cacheNamespace.claude',
    tts: 'cacheNamespace.tts',
    screenshot: 'cacheNamespace.screenshot',
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">{t('heading')}</h1>
        <p className="mt-1 text-sm text-muted">
          {t('intro', { threshold: usd2.format(COURSE_COST_ALERT_USD) })}
        </p>
      </div>

      <AdminNav />

      {/* Synthèse */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted">{t('summary.totalCost')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums text-foreground">{usd2.format(grandTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted">{t('summary.trackedCourses')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums text-foreground">{courseCosts.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted">{t('summary.alertCourses')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={cn(
                'font-display text-2xl font-semibold tabular-nums',
                alerts.length > 0 ? 'text-danger' : 'text-foreground',
              )}
            >
              {alerts.length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Usage & coût par provider (historique + ventilation) */}
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold text-foreground">{t('providers.heading')}</h2>
        <UsageTimelineChart days={timeline} />
        <div className="rounded-lg border border-border bg-surface/60 p-4">
          <div className="mb-3 flex items-center justify-between text-2xs uppercase tracking-wide text-muted">
            <span>{t('providers.colProviderModel')}</span>
            <span className="flex gap-6">
              <span className="w-16 text-end">{t('providers.colCalls')}</span>
              <span className="w-24 text-end">{t('providers.colCost')}</span>
            </span>
          </div>
          <ProviderUsageBars providers={providerUsage} />
        </div>
        <p className="text-2xs text-muted">{t('providers.note')}</p>
      </section>

      {/* Marge par plan */}
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold text-foreground">{t('margin.heading')}</h2>
        <div className="overflow-x-auto rounded-lg border border-border bg-surface/60">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-start text-2xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 text-start font-semibold">{t('margin.colPlan')}</th>
                <th className="px-4 py-3 text-end font-semibold">{t('margin.colRevenue')}</th>
                <th className="px-4 py-3 text-end font-semibold">{t('margin.colCost')}</th>
                <th className="px-4 py-3 text-end font-semibold">{t('margin.colMargin')}</th>
              </tr>
            </thead>
            <tbody>
              {margins.map((m) => {
                return (
                  <tr key={m.plan} className="border-b border-border/60 last:border-b-0">
                    <td className="px-4 py-3 font-medium text-foreground">{m.plan}</td>
                    <td className="px-4 py-3 text-end tabular-nums text-muted">{usd2.format(m.revenueUsd)}</td>
                    <td className="px-4 py-3 text-end tabular-nums text-muted">{usd2.format(m.costUsd)}</td>
                    <td
                      className={cn(
                        'px-4 py-3 text-end font-semibold tabular-nums',
                        m.marginUsd < 0 ? 'text-danger' : 'text-foreground',
                      )}
                    >
                      {usd2.format(m.marginUsd)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Coût par cours */}
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold text-foreground">{t('byCourse.heading')}</h2>
        {shown.length === 0 ? (
          <EmptyState
            title={t('byCourse.emptyTitle')}
            description={t('byCourse.emptyDescription')}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface/60">
            <table className="w-full min-w-[56rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-start text-2xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 text-start font-semibold">{t('byCourse.colCourse')}</th>
                  <th className="px-4 py-3 text-end font-semibold">{t('byCourse.colClaude')}</th>
                  <th className="px-4 py-3 text-end font-semibold">{t('byCourse.colVoice')}</th>
                  <th className="px-4 py-3 text-end font-semibold">{t('byCourse.colVideo')}</th>
                  <th className="px-4 py-3 text-end font-semibold">{t('byCourse.colImages')}</th>
                  <th className="px-4 py-3 text-end font-semibold">{t('byCourse.colTotal')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr
                    key={c.courseId}
                    className={cn(
                      'border-b border-border/60 last:border-b-0 hover:bg-primary-soft/30',
                      c.overThreshold && 'bg-danger/5',
                    )}
                  >
                    <td className="max-w-72 px-4 py-3">
                      <span className="flex items-center gap-2">
                        {c.overThreshold && (
                          <Badge variant="failed" hideDot className="text-2xs">
                            {t('byCourse.alertBadge')}
                          </Badge>
                        )}
                        <span className="block truncate font-medium text-foreground" title={titleById.get(c.courseId)}>
                          {titleById.get(c.courseId) ?? t('byCourse.deletedCourse')}
                        </span>
                      </span>
                      <span className="block truncate font-mono text-2xs text-muted">{c.courseId}</span>
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums text-muted">{usd.format(c.byKind.claude)}</td>
                    <td className="px-4 py-3 text-end tabular-nums text-muted">{usd.format(c.byKind.tts)}</td>
                    <td className="px-4 py-3 text-end tabular-nums text-muted">{usd.format(c.byKind.render)}</td>
                    <td className="px-4 py-3 text-end tabular-nums text-muted">{usd.format(c.byKind.image)}</td>
                    <td className="px-4 py-3 text-end font-semibold tabular-nums text-foreground">
                      {usd.format(c.totalUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-2xs text-muted">
          {t('byCourse.note', { kinds: Object.values(KIND_LABELS).map((k) => t(k)).join(' · ') })}
        </p>
      </section>

      {/* Comparateur cloud vs OSS (P160) */}
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold text-foreground">{t('compare.heading')}</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-muted">{t('compare.cloudCurrent')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-display text-2xl font-semibold tabular-nums text-foreground">{usd2.format(grandTotal)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-muted">{t('compare.fullOss')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-display text-2xl font-semibold tabular-nums text-foreground">{usd2.format(ossTotal)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-muted">{t('compare.potentialSavings')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-display text-2xl font-semibold tabular-nums text-success">
                {usd2.format(Math.max(0, grandTotal - ossTotal))}
              </p>
            </CardContent>
          </Card>
        </div>
        {shown.length === 0 ? (
          <EmptyState
            title={t('compare.emptyTitle')}
            description={t('compare.emptyDescription')}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface/60">
            <table className="w-full min-w-[56rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-start text-2xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 text-start font-semibold">{t('compare.colCourse')}</th>
                  <th className="px-4 py-3 text-end font-semibold">{t('compare.colCloudCost')}</th>
                  <th className="px-4 py-3 text-end font-semibold">{t('compare.colOssCost')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t('compare.colRecommendedMix')}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t('compare.colActualMix')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => {
                  const cmp = comparisonByCourse.get(c.courseId);
                  if (!cmp) return null;
                  return (
                    <tr key={c.courseId} className="border-b border-border/60 last:border-b-0 hover:bg-primary-soft/30">
                      <td className="max-w-72 px-4 py-3">
                        <span className="block truncate font-medium text-foreground" title={titleById.get(c.courseId)}>
                          {titleById.get(c.courseId) ?? t('byCourse.deletedCourse')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-end tabular-nums text-muted">{usd.format(cmp.cloudTotalUsd)}</td>
                      <td className="px-4 py-3 text-end tabular-nums text-foreground">{usd.format(cmp.ossTotalUsd)}</td>
                      <td className="px-4 py-3">
                        <span className="flex flex-wrap gap-1 text-2xs text-muted">
                          <span>llm:{MIX_LABELS[cmp.recommendedMix.llm]}</span>
                          <span>· tts:{MIX_LABELS[cmp.recommendedMix.tts]}</span>
                          <span>· img:{MIX_LABELS[cmp.recommendedMix.image]}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex flex-wrap gap-1 text-2xs text-muted">
                          <span>llm:{MIX_LABELS[cmp.actualMix.llm]}</span>
                          <span>· tts:{MIX_LABELS[cmp.actualMix.tts]}</span>
                          <span>· img:{MIX_LABELS[cmp.actualMix.image]}</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-2xs text-muted">{t('compare.note', { rate: usd2.format(HETZNER_USD_PER_HOUR) })}</p>
      </section>

      {/* Cache intelligent (P72) */}
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold text-foreground">{t('cache.heading')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-muted">{t('cache.overallHitRate')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-display text-2xl font-semibold tabular-nums text-foreground">
                {percent.format(cacheHitRateOverall)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-muted">{t('cache.estimatedSavings')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-display text-2xl font-semibold tabular-nums text-foreground">
                {usd2.format(cacheSavingsTotal)}
              </p>
            </CardContent>
          </Card>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border bg-surface/60">
          <table className="w-full min-w-[48rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-start text-2xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 text-start font-semibold">{t('cache.colCache')}</th>
                <th className="px-4 py-3 text-end font-semibold">{t('cache.colHits')}</th>
                <th className="px-4 py-3 text-end font-semibold">{t('cache.colMiss')}</th>
                <th className="px-4 py-3 text-end font-semibold">{t('cache.colHitRate')}</th>
                <th className="px-4 py-3 text-end font-semibold">{t('cache.colSavings')}</th>
              </tr>
            </thead>
            <tbody>
              {cacheStats.map((s) => (
                <tr key={s.namespace} className="border-b border-border/60 last:border-b-0">
                  <td className="px-4 py-3 font-medium text-foreground">{t(CACHE_NAMESPACE_LABELS[s.namespace])}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-muted">{s.hits}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-muted">{s.misses}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-muted">{percent.format(s.hitRate)}</td>
                  <td className="px-4 py-3 text-end font-semibold tabular-nums text-foreground">
                    {usd2.format(s.estimatedSavingsUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-2xs text-muted">{t('cache.note')}</p>
      </section>
    </div>
  );
}
