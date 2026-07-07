import type { Metadata } from 'next';
import Link from 'next/link';
import type { FilterQuery, Types } from 'mongoose';
import { Course, User, connectDb, type ICourse } from '@sallycourse/db';
import { courseStatusSchema, type CourseStatus } from '@sallycourse/shared';
import { AdminNav } from '@/components/admin';
import { Badge, EmptyState } from '@/components/ui';
import { cn } from '@/lib/cn';
import { requireAdmin } from '../guard';

/**
 * Tous les cours de la plateforme (P57) : liste filtrable par statut, avec
 * l'auteur (jointure en mémoire), la difficulté et les plateformes cibles.
 */

export const metadata: Metadata = {
  title: 'Admin — Cours — SallyCourse',
};

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;
const STATUSES = courseStatusSchema.options;

// Onglets de filtre : « tous » + un par statut.
const FILTERS: { id: 'all' | CourseStatus; label: string }[] = [
  { id: 'all', label: 'Tous' },
  ...STATUSES.map((s) => ({ id: s, label: s })),
];

const STATUS_BADGE: Record<CourseStatus, 'draft' | 'generating' | 'ready' | 'published' | 'failed'> = {
  draft: 'draft',
  generating: 'generating',
  'outline-review': 'generating',
  ready: 'ready',
  published: 'published',
  failed: 'failed',
};

function parseStatus(raw: string | undefined): 'all' | CourseStatus {
  if (raw && (STATUSES as readonly string[]).includes(raw)) return raw as CourseStatus;
  return 'all';
}

const numberFmt = new Intl.NumberFormat('fr-FR');
const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

interface AdminCoursesPageProps {
  searchParams: Promise<{ status?: string }>;
}

export default async function AdminCoursesPage({ searchParams }: AdminCoursesPageProps) {
  await requireAdmin();
  const { status } = await searchParams;
  const filter = parseStatus(status);

  await connectDb();

  const query: FilterQuery<ICourse> = filter === 'all' ? {} : { status: filter };

  const [courses, counts] = await Promise.all([
    Course.find(query)
      .select('title status difficulty targetPlatforms userId createdAt')
      .sort({ createdAt: -1 })
      .limit(PAGE_SIZE)
      .lean(),
    // Effectifs par statut en une agrégation ($group) — pour les badges d'onglets.
    Course.aggregate<{ _id: string; count: number }>([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  const countByStatus = new Map(counts.map((c) => [c._id, c.count]));
  const totalAll = counts.reduce((acc, c) => acc + c.count, 0);

  // Auteurs en une requête (jointure mémoire, pas de populate).
  const authorIds = [...new Set(courses.map((c) => (c.userId as Types.ObjectId).toString()))];
  const authors = await User.find({ _id: { $in: authorIds } })
    .select('email name')
    .lean();
  const authorById = new Map(
    authors.map((a) => [(a._id as Types.ObjectId).toString(), { name: a.name, email: a.email }]),
  );

  function filterCount(id: 'all' | CourseStatus): number {
    return id === 'all' ? totalAll : (countByStatus.get(id) ?? 0);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">Cours</h1>
        <p className="mt-1 text-sm text-muted">Tous les cours de la plateforme, filtrables par statut.</p>
      </div>

      <AdminNav />

      {/* Filtres par statut */}
      <nav aria-label="Filtrer par statut" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = f.id === filter;
          return (
            <Link
              key={f.id}
              href={f.id === 'all' ? '/admin/courses' : `/admin/courses?status=${f.id}`}
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
              <span className="ms-1.5 tabular-nums opacity-70">{numberFmt.format(filterCount(f.id))}</span>
            </Link>
          );
        })}
      </nav>

      {courses.length === 0 ? (
        <EmptyState
          title="Aucun cours dans ce filtre"
          description="Aucun cours ne correspond à ce statut."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface/60">
          <table className="w-full min-w-[64rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-start text-2xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 text-start font-semibold">Cours</th>
                <th className="px-4 py-3 text-start font-semibold">Auteur</th>
                <th className="px-4 py-3 text-start font-semibold">Statut</th>
                <th className="px-4 py-3 text-start font-semibold">Difficulté</th>
                <th className="px-4 py-3 text-start font-semibold">Plateformes</th>
                <th className="px-4 py-3 text-start font-semibold">Créé</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((c) => {
                const id = (c._id as Types.ObjectId).toString();
                const author = authorById.get((c.userId as Types.ObjectId).toString());
                return (
                  <tr key={id} className="border-b border-border/60 last:border-b-0 hover:bg-primary-soft/30">
                    <td className="max-w-72 px-4 py-3">
                      <span className="block truncate font-medium text-foreground" title={c.title}>
                        {c.title}
                      </span>
                      <span className="block truncate font-mono text-2xs text-muted">{id}</span>
                    </td>
                    <td className="max-w-56 px-4 py-3">
                      {author ? (
                        <span className="block truncate text-xs text-muted" title={author.email}>
                          {author.email}
                        </span>
                      ) : (
                        <span className="text-xs text-muted">Utilisateur supprimé</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_BADGE[c.status]}>{c.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">{c.difficulty}</td>
                    <td className="max-w-56 px-4 py-3">
                      {c.targetPlatforms.length > 0 ? (
                        <span className="flex flex-wrap gap-1">
                          {c.targetPlatforms.map((p) => (
                            <Badge key={p} variant="draft" hideDot className="text-2xs">
                              {p}
                            </Badge>
                          ))}
                        </span>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">
                      {dateFmt.format(c.createdAt)}
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
