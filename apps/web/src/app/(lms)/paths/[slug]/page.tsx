import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { BadgeCheck, BookOpen, CheckCircle2, Lock } from 'lucide-react';
import { connectDb, LearningPath, LmsListing, PathEnrollment } from '@sallycourse/db';
import { bundleSavings, resolveUnlockedCourses } from '@sallycourse/shared/learning-path';
import { marketplacePriceLabel } from '@sallycourse/shared/marketplace';
import { auth } from '@/lib/auth';
import { derivePathProgress, orderedPathCourses } from '@/lib/learning-paths';
import { PathEnrollPanel } from '@/components/paths';
import { Badge, Card, CardContent } from '@/components/ui';

/**
 * /paths/[slug] — page PUBLIQUE d'un parcours (Prompt 199) : page de vente
 * générée (si elle existe) + vue apprenant (cours ordonnés, verrous de
 * prérequis, progression globale, prix bundle et économie réalisée).
 * La progression est DÉRIVÉE des Enrollment existants — aucun second système.
 */

export const dynamic = 'force-dynamic';

interface PathPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PathPageProps): Promise<Metadata> {
  const { slug } = await params;
  await connectDb();
  const path = await LearningPath.findOne({ slug, published: true })
    .select('title description')
    .lean();
  const t = await getTranslations('paths');
  return {
    title: path ? t('path.metaTitle', { title: path.title }) : t('path.metaTitleFallback'),
    description: path?.description || undefined,
  };
}

export default async function PathSalesPage({ params }: PathPageProps) {
  const { slug } = await params;
  const t = await getTranslations('paths');

  await connectDb();

  const path = await LearningPath.findOne({ slug, published: true }).lean();
  if (!path) notFound();

  const ordered = orderedPathCourses(path);
  const listings = await LmsListing.find({
    courseId: { $in: ordered.map((course) => course.courseId) },
    published: true,
  })
    .select('courseId title summary priceCents lessonCount')
    .lean();
  const listingByCourse = new Map(listings.map((listing) => [String(listing.courseId), listing]));

  const savings = bundleSavings(
    ordered.map((course) => listingByCourse.get(course.courseId)?.priceCents ?? 0),
    path.priceCents,
  );

  // Progression apprenant : dérivée des Enrollment (si connecté ET inscrit).
  const session = await auth();
  const studentId = session?.user?.id;
  const [enrollment, derived] = await Promise.all([
    studentId
      ? PathEnrollment.findOne({ studentId, pathId: path._id }).select('_id').lean()
      : Promise.resolve(null),
    studentId
      ? derivePathProgress(path, studentId)
      : Promise.resolve({
          progress: { completedCourses: 0, totalCourses: ordered.length, percent: 0, completed: false },
          completedIds: [] as string[],
        }),
  ]);
  const enrolled = Boolean(enrollment);

  const resolved = resolveUnlockedCourses(ordered, derived.completedIds);
  const salesPage = path.salesPage ?? null;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <Badge variant="ready" className="w-fit">
          {t('courseCount', { count: ordered.length })}
        </Badge>
        <h1 className="font-display text-3xl font-semibold text-foreground sm:text-4xl">
          {salesPage?.headline ?? path.title}
        </h1>
        <p className="max-w-3xl text-lg text-muted">{salesPage?.subheadline ?? path.description}</p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-8">
          {salesPage && (
            <>
              <section className="flex flex-col gap-3">
                <h2 className="font-display text-xl font-semibold text-foreground">
                  {t('outcomes')}
                </h2>
                <ul className="flex list-none flex-col gap-2 p-0">
                  {salesPage.outcomes.map((outcome) => (
                    <li key={outcome} className="flex items-start gap-2 text-sm text-foreground">
                      <BadgeCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                      {outcome}
                    </li>
                  ))}
                </ul>
              </section>

              <section className="flex flex-col gap-3">
                <h2 className="font-display text-xl font-semibold text-foreground">
                  {t('audience')}
                </h2>
                <ul className="flex list-none flex-col gap-2 p-0">
                  {salesPage.audience.map((who) => (
                    <li key={who} className="text-sm text-muted">
                      • {who}
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}

          <section className="flex flex-col gap-3">
            <h2 className="font-display text-xl font-semibold text-foreground">{t('program')}</h2>
            <ol className="flex list-none flex-col gap-3 p-0">
              {resolved.map((course, index) => {
                const listing = listingByCourse.get(course.courseId);
                // Appariement par IDENTITÉ (le teaser porte son courseId) — un
                // réordonnancement/retrait de cours après génération ne peut plus
                // coller le mauvais pitch. Repli position pour les pages de vente
                // générées avant ce rattachement (courseId absent).
                const teaser =
                  salesPage?.courseTeasers.find((x) => x.courseId === course.courseId)?.pitch ??
                  (salesPage?.courseTeasers.some((x) => x.courseId)
                    ? undefined
                    : salesPage?.courseTeasers[index]?.pitch);
                const openable = enrolled && course.unlocked;

                const body = (
                  <Card className={course.unlocked ? undefined : 'opacity-70'}>
                    <CardContent className="flex flex-col gap-2 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-muted">{index + 1}.</span>
                        <span className="flex-1 font-medium text-foreground">
                          {listing?.title ?? ''}
                        </span>
                        {course.completed ? (
                          <Badge variant="published">
                            <CheckCircle2 className="size-3" aria-hidden="true" /> {t('completed')}
                          </Badge>
                        ) : !course.unlocked ? (
                          <Badge variant="ready">
                            <Lock className="size-3" aria-hidden="true" /> {t('locked')}
                          </Badge>
                        ) : null}
                      </div>

                      {(teaser || listing?.summary) && (
                        <p className="text-sm text-muted">{teaser ?? listing?.summary}</p>
                      )}

                      <div className="flex items-center gap-4 text-2xs text-muted">
                        <span className="flex items-center gap-1">
                          <BookOpen className="size-3.5" aria-hidden="true" />
                          {listing?.lessonCount ?? 0}
                        </span>
                        <span>
                          {marketplacePriceLabel(listing?.priceCents ?? 0, path.currency)}
                        </span>
                        {openable && <span className="text-primary">{t('openCourse')}</span>}
                      </div>
                    </CardContent>
                  </Card>
                );

                return (
                  <li key={course.courseId}>
                    {openable ? (
                      <Link href={`/learn/${course.courseId}`} className="block">
                        {body}
                      </Link>
                    ) : (
                      body
                    )}
                  </li>
                );
              })}
            </ol>
          </section>

          {salesPage && (
            <section className="flex flex-col gap-3">
              <h2 className="font-display text-xl font-semibold text-foreground">{t('faq')}</h2>
              <dl className="flex flex-col gap-4">
                {salesPage.faq.map((item) => (
                  <div key={item.question} className="flex flex-col gap-1">
                    <dt className="text-sm font-semibold text-foreground">{item.question}</dt>
                    <dd className="text-sm text-muted">{item.answer}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>

        <aside className="lg:sticky lg:top-24 lg:h-fit">
          <PathEnrollPanel
            pathId={String(path._id)}
            isAuthenticated={Boolean(studentId)}
            enrolled={enrolled}
            completed={derived.progress.completed}
            percent={derived.progress.percent}
            completedCourses={derived.progress.completedCourses}
            totalCourses={derived.progress.totalCourses}
            priceLabel={marketplacePriceLabel(path.priceCents, path.currency)}
            separateTotalLabel={
              savings.savingsCents > 0
                ? t('separateTotal', {
                    amount: marketplacePriceLabel(savings.coursesTotalCents, path.currency),
                  })
                : undefined
            }
            savingsLabel={
              savings.savingsCents > 0
                ? t('savings', {
                    amount: marketplacePriceLabel(savings.savingsCents, path.currency),
                  })
                : undefined
            }
          />
        </aside>
      </div>
    </div>
  );
}
