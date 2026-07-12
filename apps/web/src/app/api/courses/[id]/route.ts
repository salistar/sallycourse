import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { deleteCoursePrefix } from '@sallycourse/shared';
import {
  Course as CourseModel,
  CourseAnalytics,
  Deployment,
  GenerationJob,
  Lesson,
  LmsListing,
  Quiz,
  Section,
  connectDb,
  recordAudit,
} from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { extractClientIp } from '@/lib/rate-limit';

/**
 * DELETE /api/courses/[id] — suppression définitive d'un cours (P149, point
 * sensible audité). 404 (pas 403) si le cours n'appartient pas à
 * l'utilisateur, pour ne pas divulguer son existence. Purge le contenu
 * dérivé (sections/leçons/quiz/jobs/déploiements/listings/analytics) puis les
 * médias S3/MinIO (best-effort — une erreur de stockage ne bloque pas la
 * suppression des données), enfin le document Course lui-même. Même
 * périmètre de purge que /api/account/delete, mais pour UN SEUL cours.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  await connectDb();

  const course = await CourseModel.findOne({ _id: id, userId: user.id }).select('_id title').lean();
  if (!course) {
    return NextResponse.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  await Promise.all([
    Section.deleteMany({ courseId: id }),
    Lesson.deleteMany({ courseId: id }),
    Quiz.deleteMany({ courseId: id }),
    GenerationJob.deleteMany({ courseId: id }),
    Deployment.deleteMany({ courseId: id }),
    LmsListing.deleteMany({ courseId: id }),
    CourseAnalytics.deleteMany({ courseId: id }),
  ]);

  // Médias S3/MinIO : best-effort, ne bloque jamais la suppression des données.
  await deleteCoursePrefix(id).catch(() => undefined);

  await CourseModel.deleteOne({ _id: id, userId: user.id });

  // Journal d'audit (P149) : suppression de cours, un des points sensibles explicitement demandés.
  void recordAudit({
    action: 'course.deleted',
    userId: user.id,
    targetType: 'course',
    targetId: id,
    ip: extractClientIp(request),
    userAgent: request.headers.get('user-agent') ?? undefined,
    metadata: { title: course.title },
  });

  return NextResponse.json({ ok: true });
}
