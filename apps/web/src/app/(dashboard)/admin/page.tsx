import type { Metadata } from 'next';
import { BookOpen, CheckCircle2, TrendingUp, Users } from 'lucide-react';
import {
  Course,
  Deployment,
  GenerationJob,
  User,
  connectDb,
} from '@sallycourse/db';
import { PLANS, courseStatusSchema, type PlanId } from '@sallycourse/shared';
import { AdminNav, StatCard } from '@/components/admin';
import { Badge } from '@/components/ui';
import { requireAdmin } from './guard';
import {
  approvalStats,
  averagePerDay,
  courseStatusBreakdown,
  fillDailySeries,
  formatRate,
  planBreakdown,
  platformShares,
  sumDaily,
  topPlatform,
  type DailyBucket,
  type PlanBucket,
  type PlatformBucket,
  type StatusBucket,
} from './stats';

/**
 * Vue d'ensemble admin (P57) : indicateurs globaux issus d'agrégations Mongo
 * ($group, lean). Cours générés par jour, taux d'approbation Udemy, plateforme
 * la plus utilisée, plus la répartition des statuts de cours et des plans.
 */

export const metadata: Metadata = {
  title: 'Admin — Vue d’ensemble — SallyCourse',
};

export const dynamic = 'force-dynamic';

const DAYS_WINDOW = 30;
const COURSE_STATUS_ORDER = courseStatusSchema.options;
const PLAN_ORDER = Object.keys(PLANS) as PlanId[];

const STATUS_BADGE: Record<string, 'draft' | 'generating' | 'ready' | 'published' | 'failed'> = {
  draft: 'draft',
  generating: 'generating',
  'outline-review': 'generating',
  ready: 'ready',
  published: 'published',
  failed: 'failed',
};

const numberFmt = new Intl.NumberFormat('fr-FR');

export default async function AdminOverviewPage() {
  await requireAdmin();
  await connectDb();

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (DAYS_WINDOW - 1));
  since.setUTCHours(0, 0, 0, 0);

  const [
    dailyRaw,
    deployStatusRaw,
    platformRaw,
    courseStatusRaw,
    planRaw,
    totals,
  ] = await Promise.all([
    // Cours créés par jour (fenêtre glissante) — $dateToString en UTC.
    Course.aggregate<{ _id: string; count: number }>([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
          count: { $sum: 1 },
        },
      },
    ]),
    // Déploiements Udemy par statut → taux d'approbation.
    Deployment.aggregate<{ _id: string; count: number }>([
      { $match: { platform: 'udemy' } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    // Plateforme la plus utilisée (tous déploiements confondus).
    Deployment.aggregate<{ _id: string; count: number }>([
      { $group: { _id: '$platform', count: { $sum: 1 } } },
    ]),
    // Répartition des statuts de cours.
    Course.aggregate<{ _id: string; count: number }>([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    // Répartition des utilisateurs par plan.
    User.aggregate<{ _id: string; count: number }>([
      { $group: { _id: '$plan', count: { $sum: 1 } } },
    ]),
    // Compteurs globaux.
    Promise.all([
      User.estimatedDocumentCount(),
      Course.estimatedDocumentCount(),
      GenerationJob.countDocuments({ error: { $exists: true, $nin: [null, ''] } }),
    ]),
  ]);

  const [totalUsers, totalCourses, failedJobs] = totals;

  // Projection des _id d'agrégation vers les formes attendues par stats.ts.
  const daily: DailyBucket[] = dailyRaw.map((r) => ({ day: r._id, count: r.count }));
  const deployStatus: StatusBucket[] = deployStatusRaw.map((r) => ({ status: r._id, count: r.count }));
  const platforms: PlatformBucket[] = platformRaw.map((r) => ({ platform: r._id, count: r.count }));
  const courseStatus: StatusBucket[] = courseStatusRaw.map((r) => ({ status: r._id, count: r.count }));
  const plans: PlanBucket[] = planRaw.map((r) => ({ plan: r._id, count: r.count }));

  const series = fillDailySeries(daily, DAYS_WINDOW);
  const generatedThisWindow = sumDaily(series);
  const perDay = averagePerDay(series, DAYS_WINDOW);
  const approval = approvalStats(deployStatus);
  const top = topPlatform(platforms);
  const shares = platformShares(platforms);
  const statusBars = courseStatusBreakdown(courseStatus, COURSE_STATUS_ORDER);
  const planBars = planBreakdown(plans, PLAN_ORDER);

  const maxDaily = Math.max(1, ...series.map((s) => s.count));
  const maxStatus = Math.max(1, ...statusBars.map((s) => s.count));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">Vue d’ensemble</h1>
        <p className="mt-1 text-sm text-muted">
          Statistiques globales de la plateforme sur les {DAYS_WINDOW} derniers jours.
        </p>
      </div>

      <AdminNav />

      {/* Indicateurs clés */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Cours / jour"
          value={numberFmt.format(perDay)}
          hint={`${numberFmt.format(generatedThisWindow)} sur ${DAYS_WINDOW} j`}
          icon={<TrendingUp />}
        />
        <StatCard
          label="Approbation Udemy"
          value={formatRate(approval.rate)}
          hint={`${numberFmt.format(approval.published)} publiés / ${numberFmt.format(approval.terminal)} terminés`}
          icon={<CheckCircle2 />}
        />
        <StatCard
          label="Plateforme n°1"
          value={top ? top.platform : '—'}
          hint={top ? `${numberFmt.format(top.count)} déploiements` : 'Aucun déploiement'}
          icon={<TrendingUp />}
        />
        <StatCard
          label="Utilisateurs"
          value={numberFmt.format(totalUsers)}
          hint={`${numberFmt.format(totalCourses)} cours au total`}
          icon={<Users />}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Cours générés par jour — mini histogramme */}
        <section className="rounded-lg border border-border bg-surface/60 p-5">
          <h2 className="text-sm font-semibold text-foreground">Cours générés par jour</h2>
          <div className="mt-4 flex h-32 items-end gap-0.5" role="img" aria-label="Cours générés par jour">
            {series.map((point) => (
              <div
                key={point.day}
                className="flex-1 rounded-t-sm bg-primary-400/70 transition-colors hover:bg-primary-400"
                style={{ height: `${Math.max(2, (point.count / maxDaily) * 100)}%` }}
                title={`${point.day} : ${point.count}`}
              />
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            {numberFmt.format(generatedThisWindow)} cours créés, pic à {numberFmt.format(maxDaily)}/j.
          </p>
        </section>

        {/* Répartition par statut de cours */}
        <section className="rounded-lg border border-border bg-surface/60 p-5">
          <h2 className="text-sm font-semibold text-foreground">Cours par statut</h2>
          <ul className="mt-4 flex flex-col gap-3">
            {statusBars.map((row) => (
              <li key={row.status} className="flex items-center gap-3">
                <Badge variant={STATUS_BADGE[row.status] ?? 'draft'} className="w-32 justify-center">
                  {row.status}
                </Badge>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-subtle">
                  <div
                    className="h-full rounded-full bg-accent/70"
                    style={{ width: `${(row.count / maxStatus) * 100}%` }}
                  />
                </div>
                <span className="w-10 text-end tabular-nums text-sm text-muted">
                  {numberFmt.format(row.count)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Plateformes utilisées */}
        <section className="rounded-lg border border-border bg-surface/60 p-5">
          <h2 className="text-sm font-semibold text-foreground">Plateformes utilisées</h2>
          {shares.length === 0 ? (
            <p className="mt-4 text-sm text-muted">Aucun déploiement pour l’instant.</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {shares.map((row) => (
                <li key={row.platform} className="flex items-center gap-3">
                  <span className="w-32 truncate text-sm font-medium text-foreground" title={row.platform}>
                    {row.platform}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-subtle">
                    <div
                      className="h-full rounded-full bg-primary-400/70"
                      style={{ width: `${Math.max(2, row.share * 100)}%` }}
                    />
                  </div>
                  <span className="w-14 text-end tabular-nums text-sm text-muted">
                    {formatRate(row.share)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Utilisateurs par plan */}
        <section className="rounded-lg border border-border bg-surface/60 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <BookOpen aria-hidden="true" className="size-4 text-muted" />
            Utilisateurs par plan
          </h2>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {planBars.map((row) => (
              <div key={row.plan} className="rounded-md border border-border bg-background/40 p-3 text-center">
                <p className="text-2xs font-semibold uppercase tracking-wide text-muted">{row.plan}</p>
                <p className="mt-1 font-display text-xl font-semibold tabular-nums text-foreground">
                  {numberFmt.format(row.count)}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted">
            {numberFmt.format(failedJobs)} job(s) en échec —{' '}
            <a href="/admin/jobs" className="font-medium text-accent hover:underline">
              superviser
            </a>
            .
          </p>
          <p className="mt-1 text-xs text-muted">
            Templates de slides —{' '}
            {/* Playground de templates livré en P93 ; lien préparé. */}
            <a href="/admin/playground" className="font-medium text-accent hover:underline">
              ouvrir le playground
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
