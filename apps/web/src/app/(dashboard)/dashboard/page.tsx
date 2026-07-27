import type { Types } from 'mongoose';
import { getFormatter, getTranslations } from 'next-intl/server';
import { connectDb, Course, GenerationJob, Lesson, Section } from '@sallycourse/db';
import { presignedGetUrl, type CourseStatus } from '@sallycourse/shared';
import { requireUser } from '@/lib/session';
import {
  AssistantPanel,
  CourseGrid,
  GenerationPanel,
  GreetingHeader,
  parseCourseFilter,
  type DashboardCourse,
  type DashboardStat,
  type PlatformId,
} from '@/components/dashboard';

/**
 * Dashboard « mission control » — câblé au réel (P9) : cours de l'utilisateur
 * depuis Mongo, stats agrégées, panneau de génération branché sur le flux SSE
 * du cours en cours, filtres par statut pilotés par ?status=.
 */

// Données par utilisateur + searchParams : toujours rendu à la requête.
export const dynamic = 'force-dynamic';

/* ------------------------------------------------------------------ */
/* Formatage                                                            */
/* ------------------------------------------------------------------ */

type DashboardTranslator = Awaited<ReturnType<typeof getTranslations>>;
type DashboardFormatter = Awaited<ReturnType<typeof getFormatter>>;

/** Clés i18n des étapes du pipeline (match par fragment de nom). */
const STEP_LABELS: readonly [key: string, labelKey: string][] = [
  ['outline', 'stepOutline'],
  ['content', 'stepContent'],
  ['tts', 'stepTts'],
  ['screenshot', 'stepScreenshot'],
  ['video', 'stepVideo'],
  ['subtitle', 'stepSubtitle'],
  ['packaging', 'stepPackaging'],
  ['deploy', 'stepDeploy'],
];

function stepLabel(step: string | undefined, t: DashboardTranslator): string | null {
  if (!step) return null;
  const match = STEP_LABELS.find(([key]) => step.includes(key));
  return match ? t(match[1]) : step;
}

/** Fraîcheur relative localisée (« il y a 3 jours », « hier »…). */
function relativeLabel(date: Date, t: DashboardTranslator, format: DashboardFormatter): string {
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return t('relativeJustNow');
  if (minutes < 60) return t('relativeMinutes', { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('relativeHours', { hours });
  const days = Math.floor(hours / 24);
  if (days === 1) return t('relativeYesterday');
  if (days < 30) return t('relativeDays', { days });
  return t('relativeOnDate', {
    date: format.dateTime(date, { day: 'numeric', month: 'long', year: 'numeric' }),
  });
}

/** Ligne de fraîcheur contextualisée par le statut du cours. */
function freshnessLabel(
  status: CourseStatus,
  updatedAt: Date,
  t: DashboardTranslator,
  format: DashboardFormatter,
  jobStep?: string,
): string {
  const rel = relativeLabel(updatedAt, t, format);
  const step = stepLabel(jobStep, t);
  switch (status) {
    case 'draft':
      return t('freshnessDraft', { rel });
    case 'generating':
      return step ? t('freshnessGeneratingStep', { step }) : t('freshnessGeneratingStarted', { rel });
    case 'outline-review':
      return t('freshnessOutlineReview', { rel });
    case 'ready':
      return t('freshnessReady', { rel });
    case 'published':
      return t('freshnessPublished', { rel });
    case 'failed':
      return step ? t('freshnessFailedStep', { step }) : t('freshnessFailed', { rel });
    case 'cancelled':
      return t('freshnessCancelled', { rel });
  }
}

/** Progression affichée sur la carte selon le statut et le dernier job. */
function progressFor(status: CourseStatus, jobProgress: number | undefined): number {
  if (status === 'ready' || status === 'published') return 100;
  if (status === 'draft') return 0;
  return Math.min(100, Math.max(0, Math.round(jobProgress ?? 0)));
}

const PLATFORM_IDS: readonly PlatformId[] = ['udemy', 'youtube', 'site'];

function toPlatformIds(targetPlatforms: string[]): PlatformId[] {
  return targetPlatforms.filter((p): p is PlatformId => (PLATFORM_IDS as readonly string[]).includes(p));
}

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

interface DashboardPageProps {
  searchParams: Promise<{ status?: string | string[] }>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const [user, params] = await Promise.all([requireUser(), searchParams]);
  const activeFilter = parseCourseFilter(typeof params.status === 'string' ? params.status : undefined);

  await connectDb();

  const t = await getTranslations('dashboard');
  const format = await getFormatter();

  // Cours de l'utilisateur, du plus récent au plus ancien.
  const courseDocs = await Course.find({ userId: user.id }).sort({ createdAt: -1 }).lean();
  const courseIds = courseDocs.map((c) => c._id);

  // Agrégats par cours : sections, leçons (+ durée) et dernier job de génération.
  const [sectionAgg, lessonAgg, jobAgg] = await Promise.all([
    Section.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { courseId: { $in: courseIds } } },
      { $group: { _id: '$courseId', count: { $sum: 1 } } },
    ]),
    Lesson.aggregate<{ _id: Types.ObjectId; count: number; durationMin: number }>([
      { $match: { courseId: { $in: courseIds } } },
      {
        $group: {
          _id: '$courseId',
          count: { $sum: 1 },
          durationMin: { $sum: { $ifNull: ['$durationMin', 0] } },
        },
      },
    ]),
    GenerationJob.aggregate<{ _id: Types.ObjectId; step: string; progress: number }>([
      { $match: { courseId: { $in: courseIds } } },
      { $sort: { updatedAt: -1 } },
      { $group: { _id: '$courseId', step: { $first: '$step' }, progress: { $first: '$progress' } } },
    ]),
  ]);

  const sectionsByCourse = new Map(sectionAgg.map((s) => [String(s._id), s.count]));
  const lessonsByCourse = new Map(lessonAgg.map((l) => [String(l._id), l]));
  const jobByCourse = new Map(jobAgg.map((j) => [String(j._id), j]));

  // Couvertures réelles (hero SDXL/Z-Image ou upload) présignées en parallèle —
  // affichées sur les cartes ; repli sur la miniature générée si absente/échec.
  const coverUrls = await Promise.all(
    courseDocs.map((doc) => {
      const key = (doc as { coverImageUrl?: unknown }).coverImageUrl;
      return typeof key === 'string' && key ? presignedGetUrl(key).catch(() => undefined) : Promise.resolve(undefined);
    }),
  );
  const coverByCourse = new Map(courseDocs.map((doc, i) => [String(doc._id), coverUrls[i]]));

  // Mapping documents → props des composants existants du dashboard.
  const courses: DashboardCourse[] = courseDocs.map((doc) => {
    const id = String(doc._id);
    const lessons = lessonsByCourse.get(id);
    const job = jobByCourse.get(id);
    return {
      id,
      title: doc.title,
      status: doc.status,
      difficulty: doc.difficulty,
      progress: progressFor(doc.status, job?.progress),
      sectionsCount: sectionsByCourse.get(id) ?? 0,
      lessonsCount: lessons?.count ?? 0,
      durationMin: Math.round(lessons?.durationMin ?? 0),
      platforms: toPlatformIds(doc.targetPlatforms ?? []),
      updatedAtLabel: freshnessLabel(doc.status, new Date(doc.updatedAt), t, format, job?.step),
      // Rétention P79 : les cours archivés étaient invisibles/irrécupérables
      // via l'UI avant l'audit connectivité 2026-07-17.
      archived: (doc as { archived?: boolean }).archived === true,
      coverUrl: coverByCourse.get(id),
    };
  });

  // Statistiques réelles du header.
  const now = new Date();
  const createdThisMonth = courseDocs.filter(
    (c) =>
      new Date(c.createdAt).getFullYear() === now.getFullYear() &&
      new Date(c.createdAt).getMonth() === now.getMonth(),
  ).length;
  const publishedCount = courses.filter((c) => c.status === 'published').length;
  const generatingCount = courses.filter((c) => c.status === 'generating').length;
  const totalMinutes = courses.reduce((sum, c) => sum + c.durationMin, 0);

  const stats: DashboardStat[] = [
    {
      id: 'courses',
      label: t('statCoursesCreated'),
      value: courses.length,
      trend: createdThisMonth > 0 ? t('trendThisMonth', { count: createdThisMonth }) : undefined,
    },
    { id: 'published', label: t('statCoursesPublished'), value: publishedCount },
    {
      id: 'generating',
      label: t('statGenerating'),
      value: generatingCount,
      trend: generatingCount > 0 ? t('trendPipelineActive') : undefined,
    },
    {
      id: 'video',
      label: t('statVideoMinutes'),
      value: totalMinutes,
      trend: totalMinutes >= 60 ? t('trendVideoContent', { hours: Math.round(totalMinutes / 60) }) : undefined,
    },
  ];

  // Cours actuellement en génération — alimente le panneau live (SSE).
  const generating = courses.find((course) => course.status === 'generating');
  const generatingJob = generating ? jobByCourse.get(generating.id) : undefined;

  const firstName =
    (user.name ?? '').trim().split(/\s+/)[0] || user.email?.split('@')[0] || t('defaultUser');

  return (
    <div className="flex flex-col gap-10">
      <GreetingHeader firstName={firstName} stats={stats} />

      {/* Assistant conversationnel (P210) — résout une intention, exécute après confirmation. */}
      <AssistantPanel />

      {generating && (
        <GenerationPanel
          courseId={generating.id}
          courseTitle={generating.title}
          initialStep={generatingJob?.step ?? null}
          initialProgress={generatingJob?.progress ?? 0}
        />
      )}

      <CourseGrid courses={courses} activeFilter={activeFilter} />
    </div>
  );
}
