import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { FilterQuery, Types } from 'mongoose';
import { RotateCcw } from 'lucide-react';
import { Course, GenerationJob, connectDb, type IGenerationJob } from '@sallycourse/db';
import { Badge, EmptyState, Progress } from '@/components/ui';
import { AdminNav, PendingButton } from '@/components/admin';
import { requireUser } from '@/lib/session';
import { cn } from '@/lib/cn';
import { retryAllFailedAction, retryJobAction } from './actions';

/**
 * Page admin — supervision des jobs de génération : liste filtrable par
 * statut (échoués par défaut), relance unitaire ou en masse.
 */

export const metadata: Metadata = {
  title: 'Admin — Jobs de génération — SallyCourse',
};

export const dynamic = 'force-dynamic';

// ── Statuts dérivés (le modèle ne stocke pas de champ status) ──────
type StatusFilter = 'failed' | 'running' | 'done' | 'all';

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'failed', label: 'Échoués' },
  { id: 'running', label: 'En cours' },
  { id: 'done', label: 'Terminés' },
  { id: 'all', label: 'Tous' },
];

/** `error` renseigné et non vide → échec ; sinon progress décide. */
const NO_ERROR = { error: { $in: [null, ''] } } as const;

const FILTER_QUERIES: Record<StatusFilter, FilterQuery<IGenerationJob>> = {
  failed: { error: { $exists: true, $nin: [null, ''] } },
  running: { ...NO_ERROR, progress: { $lt: 100 } },
  done: { ...NO_ERROR, progress: { $gte: 100 } },
  all: {},
};

function parseFilter(raw: string | undefined): StatusFilter {
  return FILTERS.some((f) => f.id === raw) ? (raw as StatusFilter) : 'failed';
}

interface JobBadge {
  variant: 'failed' | 'generating' | 'ready';
  label: string;
}

function jobBadge(job: { error?: string | null; progress: number }): JobBadge {
  if (job.error) return { variant: 'failed', label: 'Échec' };
  if (job.progress >= 100) return { variant: 'ready', label: 'Terminé' };
  return { variant: 'generating', label: 'En cours' };
}

const dateFormatter = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

interface AdminJobsPageProps {
  searchParams: Promise<{ status?: string }>;
}

export default async function AdminJobsPage({ searchParams }: AdminJobsPageProps) {
  const user = await requireUser();
  if (user.role !== 'admin') redirect('/dashboard');

  const { status } = await searchParams;
  const filter = parseFilter(status);

  await connectDb();

  const [jobs, failedCount, counts] = await Promise.all([
    GenerationJob.find(FILTER_QUERIES[filter]).sort({ updatedAt: -1 }).limit(100).lean(),
    GenerationJob.countDocuments(FILTER_QUERIES.failed),
    Promise.all(FILTERS.map((f) => GenerationJob.countDocuments(FILTER_QUERIES[f.id]))),
  ]);

  // Titres des cours en une requête (pas de populate : typage lean simple).
  const courseIds = [...new Set(jobs.map((j) => j.courseId.toString()))];
  const courses = await Course.find({ _id: { $in: courseIds } })
    .select('title')
    .lean();
  const titleById = new Map(courses.map((c) => [(c._id as Types.ObjectId).toString(), c.title]));

  const countByFilter = new Map(FILTERS.map((f, i) => [f.id, counts[i] ?? 0]));

  return (
    <div className="flex flex-col gap-6">
      <AdminNav />

      {/* En-tête + relance en masse */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">Jobs de génération</h1>
          <p className="mt-1 text-sm text-muted">
            Supervision du pipeline : relancez les étapes échouées, unitairement ou en masse.
          </p>
        </div>
        <form action={retryAllFailedAction}>
          <PendingButton variant="secondary" size="sm" disabled={failedCount === 0}>
            <RotateCcw aria-hidden="true" />
            Relancer tous les échoués ({failedCount})
          </PendingButton>
        </form>
      </div>

      {/* Filtres par statut */}
      <nav aria-label="Filtrer par statut" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = f.id === filter;
          return (
            <Link
              key={f.id}
              href={`/admin/jobs?status=${f.id}`}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors duration-fast',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/80',
                active
                  ? 'border-primary-400/60 bg-primary-soft text-foreground'
                  : 'border-border bg-surface text-muted hover:border-ring/50 hover:text-foreground',
              )}
            >
              {f.label}
              <span className="ms-1.5 tabular-nums opacity-70">{countByFilter.get(f.id)}</span>
            </Link>
          );
        })}
      </nav>

      {jobs.length === 0 ? (
        <EmptyState
          title="Aucun job dans ce filtre"
          description={
            filter === 'failed'
              ? 'Bonne nouvelle : aucun job échoué pour le moment.'
              : 'Aucun job ne correspond à ce statut.'
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface/60">
          <table className="w-full min-w-[64rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-start text-2xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 text-start font-semibold">Cours</th>
                <th className="px-4 py-3 text-start font-semibold">Étape</th>
                <th className="px-4 py-3 text-start font-semibold">Statut</th>
                <th className="px-4 py-3 text-start font-semibold">Progression</th>
                <th className="px-4 py-3 text-start font-semibold">Erreur</th>
                <th className="px-4 py-3 text-start font-semibold">Tentatives</th>
                <th className="px-4 py-3 text-start font-semibold">Mise à jour</th>
                <th className="px-4 py-3 text-end font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const id = job._id.toString();
                const badge = jobBadge(job);
                const title = titleById.get(job.courseId.toString());
                return (
                  <tr key={id} className="border-b border-border/60 last:border-b-0 hover:bg-primary-soft/30">
                    <td className="max-w-56 px-4 py-3">
                      <span className="block truncate font-medium text-foreground" title={title ?? job.courseId.toString()}>
                        {title ?? 'Cours supprimé'}
                      </span>
                      <span className="block truncate font-mono text-2xs text-muted">{job.courseId.toString()}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-foreground">{job.step}</td>
                    <td className="px-4 py-3">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Progress value={job.progress} className="w-24" aria-label={`Progression ${job.progress} %`} />
                        <span className="tabular-nums text-xs text-muted">{Math.round(job.progress)}%</span>
                      </div>
                    </td>
                    <td className="max-w-64 px-4 py-3">
                      {job.error ? (
                        <span className="block truncate text-xs text-danger" title={job.error}>
                          {job.error}
                        </span>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted">{job.attempts}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">
                      {dateFormatter.format(job.updatedAt)}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <form action={retryJobAction.bind(null, id)}>
                        <PendingButton variant="ghost" size="sm">
                          <RotateCcw aria-hidden="true" />
                          Relancer
                        </PendingButton>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
