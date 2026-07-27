import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { connectDb, Course as CourseModel, GenerationJob } from '@sallycourse/db';
import { QUEUES } from '@sallycourse/shared';
import { requireApiUser } from '@/lib/session';
import { estimatePipelineDuration, computeReadyAt, formatReadyAtLabel } from '@/lib/pipeline-estimate';
import { estimateWaitTime } from '@/lib/queue-estimate';

/**
 * GET /api/courses/[id]/pipeline-estimate — estimation du temps total AVANT
 * lancement de la génération (P134) : somme des étapes du pipeline (outline +
 * content/tts/screenshot/video/subtitle × N leçons + packaging) à partir de
 * l'historique GenerationJob, plus la position actuelle dans la file
 * outline (jobs en attente devant celui de ce cours) et un libellé
 * « prêt vers HH:mm ». 404 volontaire (pas 403) pour ne pas révéler les
 * cours des autres utilisateurs.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return apiError('courseNotFound');
  }

  await connectDb();
  const course = await CourseModel.findOne({ _id: id, userId: user.id }).select('_id').lean();
  if (!course) {
    return apiError('courseNotFound');
  }

  const [pipeline, outlineQueueWait, currentJob] = await Promise.all([
    estimatePipelineDuration(id),
    estimateWaitTime(QUEUES.outline),
    GenerationJob.findOne({ courseId: id }).sort({ createdAt: -1 }).select('step progress').lean(),
  ]);

  // Temps total = attente en file (position) + somme des étapes du pipeline.
  const totalWithQueueMs = outlineQueueWait.estimatedWaitMs + pipeline.totalMs;
  const readyAt = computeReadyAt(new Date(), totalWithQueueMs);

  return NextResponse.json(
    {
      lessonCount: pipeline.lessonCount,
      steps: pipeline.steps,
      pipelineTotalMs: pipeline.totalMs,
      queuePosition: outlineQueueWait.waitingCount,
      queueWaitMs: outlineQueueWait.estimatedWaitMs,
      totalEstimatedMs: totalWithQueueMs,
      readyAt: readyAt.toISOString(),
      readyAtLabel: formatReadyAtLabel(readyAt),
      currentStep: currentJob?.step ?? null,
      currentProgress: currentJob?.progress ?? null,
    },
    { status: 200 },
  );
}
