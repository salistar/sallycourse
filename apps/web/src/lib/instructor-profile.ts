import {
  connectDb,
  Course as CourseModel,
  CourseReview as CourseReviewModel,
  Deployment as DeploymentModel,
  Enrollment as EnrollmentModel,
  LmsListing as LmsListingModel,
  User as UserModel,
} from '@sallycourse/db';
import {
  aggregateInstructorStats,
  aggregateReviews,
  reviewerDisplayName,
  type InstructorBio,
  type InstructorStats,
  type ReviewAggregate,
} from '@sallycourse/shared/instructor';

/**
 * Chargement du profil PUBLIC d'un instructeur (Prompt 205) — I/O Mongo, la
 * logique d'agrégation reste pure (@sallycourse/shared/instructor).
 *
 * CONTRAT DE CONFIDENTIALITÉ : ce module ne lit et ne renvoie QUE des données
 * publiques — cours PUBLIÉS sur le LMS (LmsListing.published), déploiements
 * réellement PUBLIÉS (Deployment.status='published' + externalUrl), avis RÉELS
 * du LMS interne (CourseReview) et compteurs agrégés. Jamais d'email, jamais de
 * revenus, jamais de brouillon.
 */

/** Lien vers une plateforme externe où le cours est réellement en ligne. */
export interface InstructorCourseLink {
  platform: string;
  url: string;
}

export interface InstructorCourseCard {
  courseId: string;
  title: string;
  summary: string;
  /** Accroche marketing DÉJÀ générée pour le cours (Course.marketing.headline), si elle existe. */
  tagline?: string;
  lessonCount: number;
  durationMin: number;
  priceCents: number;
  currency: string;
  publishedAt: string | null;
  /** Liens multi-plateformes RÉELS (déploiements publiés). */
  links: InstructorCourseLink[];
  /** Inscrits sur le LMS interne. */
  studentCount: number;
}

/** Avis public affiché : note, commentaire, et « Prénom I. » (jamais l'email). */
export interface InstructorReviewCard {
  id: string;
  rating: number;
  comment: string;
  authorName: string;
  courseTitle: string;
  createdAt: string;
}

export interface InstructorPublicProfile {
  userId: string;
  name: string;
  handle: string;
  bio: (InstructorBio & { generatedAt: string }) | null;
  stats: InstructorStats;
  courses: InstructorCourseCard[];
  /** null s'il n'existe AUCUN avis réel — la section n'est alors pas affichée. */
  reviews: ReviewAggregate | null;
  /** Derniers avis commentés (vide si aucun avis commenté). */
  recentReviews: InstructorReviewCard[];
}

/** Nombre d'avis commentés affichés sur la page publique. */
const RECENT_REVIEWS_LIMIT = 6;

/** Accroche marketing du cours si le générateur en a produit une (Mixed en base). */
function marketingHeadline(marketing: unknown): string | undefined {
  if (!marketing || typeof marketing !== 'object') return undefined;
  const headline = (marketing as { headline?: unknown }).headline;
  return typeof headline === 'string' && headline.trim() ? headline.trim() : undefined;
}

/**
 * Catalogue PUBLIÉ d'un instructeur, enrichi des liens de déploiement réels et
 * du nombre d'inscrits. Retourne [] si l'instructeur n'a rien publié.
 */
export async function loadInstructorCatalogue(userId: string): Promise<InstructorCourseCard[]> {
  await connectDb();

  const listings = await LmsListingModel.find({ userId, published: true })
    .select('courseId title summary lessonCount durationMin priceCents currency publishedAt')
    .sort({ publishedAt: -1 })
    .lean();
  if (listings.length === 0) return [];

  const courseIds = listings.map((listing) => listing.courseId);

  const [deployments, enrollmentCounts, courses] = await Promise.all([
    // Uniquement les déploiements RÉELLEMENT publiés et porteurs d'une URL.
    DeploymentModel.find({
      courseId: { $in: courseIds },
      status: 'published',
      externalUrl: { $nin: [null, ''] },
    })
      .select('courseId platform externalUrl')
      .lean(),
    EnrollmentModel.aggregate<{ _id: unknown; count: number }>([
      { $match: { courseId: { $in: courseIds } } },
      { $group: { _id: '$courseId', count: { $sum: 1 } } },
    ]),
    CourseModel.find({ _id: { $in: courseIds } })
      .select('marketing')
      .lean(),
  ]);

  const linksByCourse = new Map<string, InstructorCourseLink[]>();
  for (const deployment of deployments) {
    if (!deployment.externalUrl) continue;
    const key = String(deployment.courseId);
    const links = linksByCourse.get(key) ?? [];
    // Une seule entrée par plateforme (redéploiements successifs).
    if (!links.some((link) => link.platform === deployment.platform)) {
      links.push({ platform: deployment.platform, url: deployment.externalUrl });
    }
    linksByCourse.set(key, links);
  }

  const studentsByCourse = new Map(
    enrollmentCounts.map((row) => [String(row._id), row.count] as const),
  );
  const taglineByCourse = new Map(
    courses.map((course) => [String(course._id), marketingHeadline(course.marketing)] as const),
  );

  return listings.map((listing) => {
    const courseId = String(listing.courseId);
    return {
      courseId,
      title: listing.title,
      summary: listing.summary ?? '',
      tagline: taglineByCourse.get(courseId),
      lessonCount: listing.lessonCount ?? 0,
      durationMin: listing.durationMin ?? 0,
      priceCents: listing.priceCents ?? 0,
      currency: listing.currency ?? 'MAD',
      publishedAt: listing.publishedAt ? new Date(listing.publishedAt).toISOString() : null,
      links: (linksByCourse.get(courseId) ?? []).sort((a, b) =>
        a.platform.localeCompare(b.platform),
      ),
      studentCount: studentsByCourse.get(courseId) ?? 0,
    };
  });
}

/**
 * Profil public complet par handle — null si aucun utilisateur ne porte ce
 * handle (→ 404 côté page). Un instructeur SANS cours publié conserve une page
 * (bio + handle) mais un catalogue vide : aucune donnée privée n'est exposée.
 */
export async function loadInstructorProfileByHandle(
  handle: string,
  anonymousLabel: string,
): Promise<InstructorPublicProfile | null> {
  await connectDb();

  const user = await UserModel.findOne({ handle, banned: { $ne: true } })
    .select('name handle instructorBio')
    .lean();
  if (!user?.handle) return null;

  const courses = await loadInstructorCatalogue(String(user._id));

  const stats = aggregateInstructorStats(
    courses.map((course) => ({
      courseId: course.courseId,
      lessonCount: course.lessonCount,
      durationMin: course.durationMin,
      platforms: course.links.map((link) => link.platform),
      studentCount: course.studentCount,
    })),
  );

  // Avis RÉELS du LMS interne uniquement (jamais les avis Udemy mockés du worker).
  const courseIds = courses.map((course) => course.courseId);
  const reviewDocs =
    courseIds.length > 0
      ? await CourseReviewModel.find({ courseId: { $in: courseIds } })
          .select('courseId studentId rating comment createdAt')
          .sort({ createdAt: -1 })
          .lean()
      : [];

  const reviews = aggregateReviews(reviewDocs.map((doc) => ({ rating: doc.rating })));

  const commented = reviewDocs
    .filter((doc) => (doc.comment ?? '').trim().length > 0)
    .slice(0, RECENT_REVIEWS_LIMIT);

  const authors = await UserModel.find({ _id: { $in: commented.map((doc) => doc.studentId) } })
    .select('name')
    .lean();
  const nameByAuthor = new Map(authors.map((author) => [String(author._id), author.name] as const));
  const titleByCourse = new Map(courses.map((course) => [course.courseId, course.title] as const));

  const recentReviews: InstructorReviewCard[] = commented.map((doc) => ({
    id: String(doc._id),
    rating: doc.rating,
    comment: (doc.comment ?? '').trim(),
    authorName: reviewerDisplayName(nameByAuthor.get(String(doc.studentId)) ?? '', anonymousLabel),
    courseTitle: titleByCourse.get(String(doc.courseId)) ?? '',
    createdAt: new Date(doc.createdAt).toISOString(),
  }));

  return {
    userId: String(user._id),
    name: user.name,
    handle: user.handle,
    bio: user.instructorBio
      ? {
          headline: user.instructorBio.headline,
          bio: user.instructorBio.bio,
          expertise: [...user.instructorBio.expertise],
          generatedAt: new Date(user.instructorBio.generatedAt).toISOString(),
        }
      : null,
    stats,
    courses,
    reviews,
    recentReviews,
  };
}
