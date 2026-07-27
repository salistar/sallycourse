import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { connectDb, LearningPath, LMS_CURRENCIES, PathEnrollment } from '@sallycourse/db';
import { LEARNING_PATH_MAX_COURSES } from '@sallycourse/shared/learning-path';
import { requireApiUser } from '@/lib/session';
import { assertOwnedAndPublished } from '@/lib/learning-paths';

/**
 * /api/paths/[id] — édition d'un parcours (Prompt 199), réservée à son auteur.
 * PATCH : ordre des cours, verrous de prérequis, prix bundle, publication.
 *         Publier exige au moins un cours, tous encore publiés sur le LMS.
 * DELETE : supprime le parcours et ses PathEnrollment. Les Enrollment des cours
 *         (et donc la progression des apprenants) sont CONSERVÉS — un parcours
 *         n'est qu'un chaînage, sa suppression ne détruit aucun acquis.
 * Ownership → 404 (jamais 403), convention du repo.
 */

export const dynamic = 'force-dynamic';

const updatePathSchema = z
  .object({
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().max(2000),
    courses: z
      .array(
        z.object({
          courseId: z.string().min(1),
          requiresPrevious: z.boolean().default(false),
        }),
      )
      .min(1)
      .max(LEARNING_PATH_MAX_COURSES),
    priceCents: z.number().int().min(0).max(10_000_000),
    currency: z.enum(LMS_CURRENCIES),
    published: z.boolean(),
  })
  .partial();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return apiError('pathNotFound');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('invalidJson');
  }

  const parsed = updatePathSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Données invalides.', code: 'invalidData', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectDb();

  const path = await LearningPath.findOne({ _id: id, userId: user.id });
  if (!path) {
    return apiError('pathNotFound');
  }

  const { title, description, courses, priceCents, currency, published } = parsed.data;

  if (courses) {
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
    const invalid = await assertOwnedAndPublished(uniqueIds, user.id);
    if (invalid) return invalid;

    // L'ordre du parcours est celui du tableau reçu (0-based).
    path.set(
      'courses',
      courses.map((course, index) => ({
        courseId: course.courseId,
        order: index,
        requiresPrevious: course.requiresPrevious,
      })),
    );
  }

  if (title !== undefined) path.title = title;
  if (description !== undefined) path.description = description;
  if (priceCents !== undefined) path.priceCents = priceCents;
  if (currency !== undefined) path.currency = currency;

  if (published !== undefined && published !== path.published) {
    if (published) {
      if (path.courses.length === 0) {
        return NextResponse.json(
          { error: 'Ajoutez au moins un cours avant de publier le parcours.', code: 'addCourseBeforePublishPath' },
          { status: 409 },
        );
      }
      // Les cours ont pu être dé-publiés du LMS depuis la création du parcours.
      const invalid = await assertOwnedAndPublished(
        path.courses.map((course) => String(course.courseId)),
        user.id,
      );
      if (invalid) return invalid;
      path.publishedAt = new Date();
    }
    path.published = published;
  }

  await path.save();

  return NextResponse.json({
    id: String(path._id),
    slug: path.slug,
    published: path.published,
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return apiError('pathNotFound');
  }

  await connectDb();

  const path = await LearningPath.findOne({ _id: id, userId: user.id }).select('_id').lean();
  if (!path) {
    return apiError('pathNotFound');
  }

  await PathEnrollment.deleteMany({ pathId: id });
  await LearningPath.deleteOne({ _id: id, userId: user.id });

  return NextResponse.json({ ok: true });
}
