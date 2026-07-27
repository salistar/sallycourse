import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ArrowRight, ExternalLink, Star } from 'lucide-react';
import {
  instructorCoursesJsonLd,
  instructorPath,
  instructorPersonJsonLd,
  parseHandleParam,
  type InstructorJsonLdInput,
} from '@sallycourse/shared/instructor';
import { Badge, Card, CardContent, buttonVariants } from '@/components/ui';
import { cn } from '@/lib/cn';
import { jsonLdHtml } from '@/lib/json-ld';
import {
  loadInstructorProfileByHandle,
  type InstructorPublicProfile,
} from '@/lib/instructor-profile';

/**
 * /@handle — page instructeur publique (portfolio, Prompt 205). Server
 * Component : bio générée, catalogue des cours PUBLIÉS avec leurs liens
 * multi-plateformes réels, statistiques agrégées, avis RÉELS du LMS interne, et
 * JSON-LD schema.org (Person + ItemList).
 *
 * ROUTAGE : segment dynamique racine `[handle]`, mais le segment DOIT valoir
 * « @xxx » (parseHandleParam) — tout le reste est un 404. Les segments statiques
 * existants (/blog, /pricing, /login, /learn…) restent prioritaires côté App
 * Router : aucune route existante n'est capturée. Un dossier « @instructeur »
 * serait interprété comme un SLOT de route parallèle : c'est pourquoi le « @ »
 * fait partie de la VALEUR du segment, jamais de son nom.
 *
 * CONFIDENTIALITÉ : aucune donnée privée (email, revenus, brouillons) — le
 * chargement passe par loadInstructorProfileByHandle, qui ne lit que du public.
 */

export const dynamic = 'force-dynamic';

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

/** Profil public si le segment est un handle valide ET attribué, sinon null. */
async function loadFromParam(segment: string, anonymousLabel: string) {
  const handle = parseHandleParam(segment);
  if (!handle) return null;
  return loadInstructorProfileByHandle(handle, anonymousLabel);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const t = await getTranslations('instructor');
  const profile = await loadFromParam(handle, t('anonymousLabel'));
  if (!profile) return { title: 'SallyCourse' };

  const description =
    profile.bio?.headline ??
    t('metaDescription', { name: profile.name, count: profile.stats.courseCount });
  const url = `${APP_URL.replace(/\/+$/, '')}${instructorPath(profile.handle)}`;

  return {
    title: `${profile.name} — SallyCourse`,
    description,
    alternates: { canonical: url },
    openGraph: { type: 'profile', title: profile.name, description, url },
  };
}

/** Étoiles pleines/vides pour une note sur 5 (rendu serveur, purement visuel). */
function Stars({ rating, label }: { rating: number; label: string }) {
  return (
    <span className="flex items-center gap-0.5" role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((index) => (
        <Star
          key={index}
          aria-hidden="true"
          className={cn(
            'size-4',
            index <= Math.round(rating)
              ? 'fill-accent-400 text-accent-400'
              : 'text-border',
          )}
        />
      ))}
    </span>
  );
}

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-surface-subtle p-4">
      <span className="font-display text-2xl font-semibold text-foreground">{value}</span>
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
    </div>
  );
}

export default async function InstructorPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const t = await getTranslations('instructor');
  const profile = await loadFromParam(handle, t('anonymousLabel'));
  if (!profile) notFound();

  const jsonLdInput: InstructorJsonLdInput = {
    name: profile.name,
    handle: profile.handle,
    headline: profile.bio?.headline,
    bio: profile.bio?.bio,
    expertise: profile.bio?.expertise,
    siteUrl: APP_URL,
    courses: profile.courses.map((course) => ({
      title: course.title,
      summary: course.summary,
      url: `${APP_URL.replace(/\/+$/, '')}/learn/${course.courseId}`,
    })),
    reviews: profile.reviews,
  };
  const personLd = instructorPersonJsonLd(jsonLdInput);
  const coursesLd = instructorCoursesJsonLd(jsonLdInput);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-16">
      <script
        type="application/ld+json"
        // Le nom d'instructeur et les titres de cours sont saisis librement :
        // jsonLdHtml échappe < > & pour qu'un « </script> » ne referme pas la
        // balise (stored XSS servi à tout visiteur de la page publique).
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(personLd) }}
      />
      {coursesLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdHtml(coursesLd) }}
        />
      )}

      <InstructorHeader profile={profile} t={t} />
      <InstructorStatsGrid profile={profile} t={t} />
      <InstructorCatalogue profile={profile} t={t} />
      <InstructorReviews profile={profile} t={t} />
    </main>
  );
}

type Translator = Awaited<ReturnType<typeof getTranslations<'instructor'>>>;

function InstructorHeader({ profile, t }: { profile: InstructorPublicProfile; t: Translator }) {
  return (
    <header className="flex flex-col gap-4">
      <span className="text-sm font-medium text-muted">@{profile.handle}</span>
      <h1 className="font-display text-4xl font-semibold text-foreground">{profile.name}</h1>
      {profile.bio && (
        <>
          <p className="text-lg text-muted">{profile.bio.headline}</p>
          <div className="flex flex-col gap-3 text-base text-foreground/90">
            {profile.bio.bio.split('\n\n').map((paragraph) => (
              <p key={paragraph.slice(0, 40)}>{paragraph}</p>
            ))}
          </div>
          {profile.bio.expertise.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-2xs font-semibold uppercase tracking-wide text-muted">
                {t('expertise')}
              </span>
              <div className="flex flex-wrap gap-2">
                {profile.bio.expertise.map((item) => (
                  <Badge key={item} variant="draft">
                    {item}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {/* Transparence : la bio est générée par IA à partir du catalogue publié. */}
          <p className="text-xs text-muted">{t('bioDisclosure')}</p>
        </>
      )}
    </header>
  );
}

function InstructorStatsGrid({ profile, t }: { profile: InstructorPublicProfile; t: Translator }) {
  const { stats } = profile;
  if (stats.courseCount === 0) return null;

  return (
    <section className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatTile value={String(stats.courseCount)} label={t('stats.courses')} />
      <StatTile value={String(stats.lessonCount)} label={t('stats.lessons')} />
      <StatTile value={String(stats.totalHours)} label={t('stats.hours')} />
      <StatTile value={String(stats.studentCount)} label={t('stats.students')} />
    </section>
  );
}

function InstructorCatalogue({ profile, t }: { profile: InstructorPublicProfile; t: Translator }) {
  return (
    <section className="mt-14">
      <h2 className="mb-5 font-display text-2xl font-semibold text-foreground">
        {t('coursesTitle')}
      </h2>

      {profile.courses.length === 0 ? (
        <p className="text-sm text-muted">{t('coursesEmpty')}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {profile.courses.map((course) => (
            <Card key={course.courseId}>
              <CardContent className="flex h-full flex-col gap-3 p-6">
                <h3 className="font-display text-lg font-semibold text-foreground">
                  {course.title}
                </h3>
                <p className="text-sm text-muted">{course.tagline ?? course.summary}</p>

                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span>{t('lessons', { count: course.lessonCount })}</span>
                  <span aria-hidden="true">·</span>
                  <span>{t('duration', { minutes: course.durationMin })}</span>
                  {course.priceCents === 0 && (
                    <Badge variant="ready" className="ms-1">
                      {t('free')}
                    </Badge>
                  )}
                </div>

                {course.links.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-2xs font-semibold uppercase tracking-wide text-muted">
                      {t('alsoOn')}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {course.links.map((link) => (
                        <a
                          key={`${course.courseId}-${link.platform}`}
                          href={link.url}
                          target="_blank"
                          rel="noreferrer nofollow"
                          className={cn(
                            buttonVariants({ variant: 'secondary', size: 'sm' }),
                            'capitalize',
                          )}
                        >
                          {link.platform}
                          <ExternalLink aria-hidden="true" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                <Link
                  href={`/learn/${course.courseId}`}
                  className={cn(
                    buttonVariants({ variant: 'primary', size: 'sm' }),
                    'mt-auto self-start',
                  )}
                >
                  {t('viewCourse')}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Avis — UNIQUEMENT les avis RÉELS du LMS interne (CourseReview). Aucun avis
 * Udemy (ceux du worker sont MOCKÉS). Aucun avis réel → aucune section.
 */
function InstructorReviews({ profile, t }: { profile: InstructorPublicProfile; t: Translator }) {
  const { reviews, recentReviews } = profile;
  if (!reviews) return null;

  return (
    <section className="mt-14">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h2 className="font-display text-2xl font-semibold text-foreground">
          {t('reviewsTitle')}
        </h2>
        <Stars
          rating={reviews.average}
          label={t('reviewsSummary', { average: reviews.average, count: reviews.count })}
        />
        <span className="text-sm text-muted">
          {t('reviewsSummary', { average: reviews.average, count: reviews.count })}
        </span>
      </div>

      {recentReviews.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {recentReviews.map((review) => (
            <Card key={review.id}>
              <CardContent className="flex flex-col gap-2 p-5">
                <Stars
                  rating={review.rating}
                  label={t('reviewsSummary', { average: review.rating, count: 1 })}
                />
                <p className="text-sm text-foreground/90">{review.comment}</p>
                <p className="text-xs text-muted">
                  {review.authorName} · {review.courseTitle}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-muted">{t('reviewsNote')}</p>
    </section>
  );
}
