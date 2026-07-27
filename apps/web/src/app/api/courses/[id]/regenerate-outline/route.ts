import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { QUEUES, defaultJobOptions, makeJobId } from '@sallycourse/shared';
import {
  connectDb,
  Course as CourseModel,
  GenerationJob as GenerationJobModel,
} from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { getOutlineQueue } from '@/lib/queues';
import { regenerateOutlinePayloadSchema } from '@/lib/outline-payload';

/**
 * POST /api/courses/[id]/regenerate-outline — relance la génération du plan
 * avec d'éventuelles instructions supplémentaires ({ extraInstructions }).
 * Autorisé pendant la revue du plan ou après un échec. 404 volontaire (pas
 * 403) pour ne pas révéler les cours des autres utilisateurs.
 */

/** Statuts depuis lesquels une régénération du plan est permise. */
const REGENERATABLE_STATUSES = new Set(['outline-review', 'failed']);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return apiError('courseNotFound');
  }

  // Corps optionnel : absence de body = régénération sans consigne.
  const body: unknown = await request.json().catch(() => ({}));
  const parsed = regenerateOutlinePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Instructions invalides.', code: 'invalidInstructions', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  await connectDb();

  const course = await CourseModel.findOne({ _id: id, userId: user.id });
  if (!course) {
    return apiError('courseNotFound');
  }

  if (!REGENERATABLE_STATUSES.has(course.status)) {
    return NextResponse.json(
      { error: `Le plan ne peut pas être régénéré (statut : ${course.status}).`, code: 'regenOutlineCannotRegenerateStatus', params: { status: course.status } },
      { status: 409 },
    );
  }

  const courseId = course._id.toString();
  const extraInstructions = parsed.data.extraInstructions || undefined;

  try {
    await GenerationJobModel.findOneAndUpdate(
      { courseId: course._id },
      { $set: { step: QUEUES.outline, progress: 0 }, $unset: { error: '' } },
      { upsert: true },
    );

    const queue = getOutlineQueue();
    const jobId = makeJobId(courseId, QUEUES.outline);
    // L'exécution initiale garde le jobId réservé : purge avant re-add.
    await queue.remove(jobId).catch(() => undefined);
    await queue.add(
      'outline',
      { courseId, extraInstructions },
      { ...defaultJobOptions, jobId },
    );
  } catch {
    return NextResponse.json(
      { error: 'Impossible de relancer la génération du plan, réessayez plus tard.', code: 'cannotRestartPlanGeneration' },
      { status: 503 },
    );
  }

  // Statut mis à jour APRÈS l'enqueue (cohérent avec approve-outline).
  course.status = 'generating';
  await course.save();

  return NextResponse.json({ id: courseId, status: course.status }, { status: 202 });
}
