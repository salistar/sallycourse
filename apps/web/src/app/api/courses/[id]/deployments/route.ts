import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import {
  Course as CourseModel,
  Deployment,
  Lesson as LessonModel,
  connectDb,
} from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

/**
 * GET /api/courses/[id]/deployments — état courant de chaque déploiement du
 * cours (une entrée par plateforme). Alimente le tableau de bord temps réel :
 * statut, étape/leçon (checkpoint), URL publiée, logs dépliables. La progression
 * fine passe par le flux SSE /progress ; ce point sert de snapshot au montage et
 * après un retry.
 */

// Données par utilisateur : jamais de cache.
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return apiError('courseNotFound');
  }

  await connectDb();

  const course = await CourseModel.findOne({ _id: id, userId: user.id })
    .select('_id')
    .lean();
  if (!course) {
    return apiError('courseNotFound');
  }

  const [deployments, lessonCount] = await Promise.all([
    Deployment.find({ courseId: id }).sort({ updatedAt: -1 }).lean(),
    LessonModel.countDocuments({ courseId: id }),
  ]);

  return NextResponse.json({
    lessonCount,
    deployments: deployments.map((d) => ({
      id: String(d._id),
      platform: d.platform,
      status: d.status,
      mode: d.mode,
      externalUrl: d.externalUrl ?? null,
      // Suivi de publication manuelle (P178) : checklist + horodatage de bascule.
      checklist: (d.checklist ?? []).map((c) => ({
        key: c.key,
        label: c.label,
        done: Boolean(c.done),
      })),
      publishedManuallyAt: d.publishedManuallyAt
        ? new Date(d.publishedManuallyAt).getTime()
        : null,
      checkpoint: {
        lessonIndex: d.checkpoint?.lessonIndex ?? 0,
        step: d.checkpoint?.step ?? '',
      },
      logs: (d.logs ?? []).map((l) => ({
        ts: new Date(l.ts).getTime(),
        level: l.level,
        msg: l.msg,
      })),
      updatedAt: new Date(d.updatedAt).getTime(),
    })),
  });
}
