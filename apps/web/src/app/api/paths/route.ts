import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { connectDb, LearningPath, LmsListing, LMS_CURRENCIES } from '@sallycourse/db';
import {
  LEARNING_PATH_MAX_COURSES,
  bundleSavings,
} from '@sallycourse/shared/learning-path';
import { requireApiUser } from '@/lib/session';
import { assertOwnedAndPublished, createPathWithUniqueSlug } from '@/lib/learning-paths';

/**
 * /api/paths — parcours d'apprentissage (Prompt 199).
 * GET  : catalogue PUBLIC des parcours publiés (aucune authentification).
 * POST : crée un parcours — { title, description?, courses: [{ courseId,
 *        requiresPrevious? }], priceCents?, currency? }. L'ordre des cours est
 *        celui du tableau. Chaque cours doit appartenir à l'utilisateur (404
 *        sinon) ET être publié sur le LMS interne : un parcours ne chaîne que
 *        des cours réellement suivables par un apprenant.
 */

export const dynamic = 'force-dynamic';

const pathCourseSchema = z.object({
  courseId: z.string().min(1),
  requiresPrevious: z.boolean().default(false),
});

const createPathSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(2000).default(''),
  courses: z.array(pathCourseSchema).min(1).max(LEARNING_PATH_MAX_COURSES),
  priceCents: z.number().int().min(0).max(10_000_000).default(0),
  currency: z.enum(LMS_CURRENCIES).default('MAD'),
});

/** GET — catalogue public des parcours publiés (titres des cours joints). */
export async function GET() {
  await connectDb();

  const paths = await LearningPath.find({ published: true })
    .sort({ publishedAt: -1 })
    .limit(60)
    .lean();

  const courseIds = paths.flatMap((path) => path.courses.map((course) => course.courseId));
  const listings = await LmsListing.find({ courseId: { $in: courseIds }, published: true })
    .select('courseId title priceCents')
    .lean();
  const listingByCourse = new Map(listings.map((listing) => [String(listing.courseId), listing]));

  return NextResponse.json({
    paths: paths.map((path) => {
      const ordered = [...path.courses].sort((a, b) => a.order - b.order);
      const prices = ordered.map(
        (course) => listingByCourse.get(String(course.courseId))?.priceCents ?? 0,
      );
      return {
        id: String(path._id),
        title: path.title,
        slug: path.slug,
        description: path.description,
        courseCount: ordered.length,
        courseTitles: ordered.map(
          (course) => listingByCourse.get(String(course.courseId))?.title ?? '',
        ),
        priceCents: path.priceCents,
        currency: path.currency,
        savings: bundleSavings(prices, path.priceCents),
        publishedAt: path.publishedAt ?? null,
      };
    }),
  });
}

/** POST — crée un parcours à partir de cours possédés ET publiés sur le LMS. */
export async function POST(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('invalidJson');
  }

  const parsed = createPathSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Données invalides.', code: 'invalidData', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { title, description, courses, priceCents, currency } = parsed.data;

  const uniqueIds = [...new Set(courses.map((course) => course.courseId))];
  if (uniqueIds.length !== courses.length) {
    return NextResponse.json(
      { error: 'Un même cours ne peut pas figurer deux fois dans un parcours.', code: 'duplicateCourseInPath' },
      { status: 400 },
    );
  }
  if (courses.some((course) => !isValidObjectId(course.courseId))) {
    return apiError('courseNotFound');
  }

  await connectDb();

  const invalid = await assertOwnedAndPublished(uniqueIds, user.id);
  if (invalid) return invalid;

  const path = await createPathWithUniqueSlug({
    userId: user.id,
    title,
    description,
    courses: courses.map((course, index) => ({
      courseId: course.courseId,
      order: index,
      requiresPrevious: course.requiresPrevious,
    })),
    priceCents,
    currency,
  });

  return NextResponse.json({ id: String(path._id), slug: path.slug }, { status: 201 });
}
