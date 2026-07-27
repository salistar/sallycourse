import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { connectDb, Course as CourseModel, LearningPath, LmsListing } from '@sallycourse/db';
import { bundleSavings } from '@sallycourse/shared/learning-path';
import { requireApiUser } from '@/lib/session';
import { orderedPathCourses } from '@/lib/learning-paths';
import { generatePathSalesPage } from '@/lib/path-sales-page';
import { logger } from '@/lib/logger';

/**
 * POST /api/paths/[id]/sales-page — génère la page de vente du parcours (P199)
 * et la persiste sur LearningPath.salesPage. Réservé à l'auteur (404 sinon).
 * Appel LLM synchrone depuis le web (patron exercise-generator, pas de queue) :
 * MOCK_PROVIDERS/clé absente → fixture déterministe ; échec réel → 502.
 */

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return apiError('pathNotFound');
  }

  await connectDb();

  const path = await LearningPath.findOne({ _id: id, userId: user.id });
  if (!path) {
    return apiError('pathNotFound');
  }
  if (path.courses.length === 0) {
    return NextResponse.json(
      { error: 'Ajoutez au moins un cours avant de générer la page de vente.', code: 'addCourseBeforeSalesPage' },
      { status: 409 },
    );
  }

  const ordered = orderedPathCourses(path);
  const listings = await LmsListing.find({
    courseId: { $in: ordered.map((course) => course.courseId) },
  })
    .select('courseId title summary priceCents')
    .lean();
  const listingByCourse = new Map(listings.map((listing) => [String(listing.courseId), listing]));

  // Langue du parcours : celle du premier cours (les cours d'un parcours
  // partagent la langue de l'école) — défaut fr.
  const firstCourse = await CourseModel.findById(ordered[0]!.courseId).select('locale').lean();

  const courses = ordered.map((course) => ({
    courseId: course.courseId,
    title: listingByCourse.get(course.courseId)?.title ?? '',
    summary: listingByCourse.get(course.courseId)?.summary ?? '',
  }));
  const savings = bundleSavings(
    ordered.map((course) => listingByCourse.get(course.courseId)?.priceCents ?? 0),
    path.priceCents,
  );

  try {
    const salesPage = await generatePathSalesPage({
      pathTitle: path.title,
      pathDescription: path.description,
      locale: firstCourse?.locale ?? 'fr',
      courses,
      bundlePriceCents: savings.bundlePriceCents,
      coursesTotalCents: savings.coursesTotalCents,
      currency: path.currency,
    });

    path.salesPage = salesPage;
    await path.save();

    return NextResponse.json({ salesPage });
  } catch (error) {
    logger.warn({ err: error, pathId: id }, 'Génération de page de vente en échec');
    return NextResponse.json(
      { error: 'La génération de la page de vente a échoué. Réessayez dans un instant.', code: 'salesPageGenerationFailed' },
      { status: 502 },
    );
  }
}
