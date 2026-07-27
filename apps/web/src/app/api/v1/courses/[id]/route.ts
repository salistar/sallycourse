import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import {
  connectDb,
  Course as CourseModel,
  Deployment,
  GenerationJob as GenerationJobModel,
} from '@sallycourse/db';
import { requireApiKeyUser } from '@/lib/api-auth';

/**
 * GET /api/v1/courses/[id] — statut d'un cours (génération + déploiements) pour
 * le porteur de la clé API. Renvoie le statut du cours, la progression du job de
 * génération courant et l'état de chaque déploiement.
 */

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiKeyUser(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return apiError('courseNotFound');
  }

  await connectDb();

  const course = await CourseModel.findOne({ _id: id, userId: auth.userId })
    .select('title status difficulty locale targetPlatforms createdAt updatedAt')
    .lean();
  if (!course) {
    return apiError('courseNotFound');
  }

  const [job, deployments] = await Promise.all([
    GenerationJobModel.findOne({ courseId: id })
      .select('step progress')
      .sort({ updatedAt: -1 })
      .lean(),
    Deployment.find({ courseId: id })
      .select('platform status mode externalUrl')
      .lean(),
  ]);

  return NextResponse.json({
    id: String(course._id),
    title: course.title,
    status: course.status,
    difficulty: course.difficulty,
    locale: course.locale,
    platforms: course.targetPlatforms,
    generation: job ? { step: job.step, progress: job.progress } : null,
    deployments: deployments.map((d) => ({
      platform: d.platform,
      status: d.status,
      mode: d.mode,
      externalUrl: d.externalUrl ?? null,
    })),
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
  });
}
