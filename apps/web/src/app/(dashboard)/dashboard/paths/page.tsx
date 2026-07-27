import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { connectDb, LearningPath, LmsListing, LMS_CURRENCIES } from '@sallycourse/db';
import { requireUser } from '@/lib/session';
import { PathEditor, type PathEditorCourse, type PathEditorPath } from '@/components/paths';

/**
 * Dashboard → Parcours (Prompt 199) : composition d'un parcours à partir des
 * cours DÉJÀ publiés sur le LMS interne de l'auteur (ordre, prérequis, prix
 * bundle, publication, génération de la page de vente). Server Component : lit
 * les parcours et le catalogue publié de l'auteur, délègue les écritures aux
 * routes /api/paths* via <PathEditor />.
 */

export const metadata: Metadata = {
  title: 'Parcours — SallyCourse',
  description: 'Chaînez vos cours publiés en parcours d’apprentissage vendus comme un bundle.',
};

export const dynamic = 'force-dynamic';

export default async function DashboardPathsPage() {
  const user = await requireUser();
  const t = await getTranslations('paths');

  await connectDb();

  const [paths, listings] = await Promise.all([
    LearningPath.find({ userId: user.id }).sort({ updatedAt: -1 }).lean(),
    LmsListing.find({ userId: user.id, published: true })
      .select('courseId title priceCents')
      .sort({ title: 1 })
      .lean(),
  ]);

  const availableCourses: PathEditorCourse[] = listings.map((listing) => ({
    courseId: String(listing.courseId),
    title: listing.title,
    priceCents: listing.priceCents ?? 0,
  }));

  const editorPaths: PathEditorPath[] = paths.map((path) => ({
    id: String(path._id),
    title: path.title,
    slug: path.slug,
    description: path.description,
    priceCents: path.priceCents,
    currency: path.currency,
    published: path.published,
    hasSalesPage: Boolean(path.salesPage),
    courses: [...path.courses]
      .sort((a, b) => a.order - b.order)
      .map((course) => ({
        courseId: String(course.courseId),
        requiresPrevious: course.requiresPrevious,
      })),
  }));

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold text-foreground">
          {t('dashboardTitle')}
        </h1>
        <p className="max-w-2xl text-muted">{t('dashboardSubtitle')}</p>
      </header>

      <PathEditor
        paths={editorPaths}
        availableCourses={availableCourses}
        currencies={LMS_CURRENCIES}
      />
    </div>
  );
}
