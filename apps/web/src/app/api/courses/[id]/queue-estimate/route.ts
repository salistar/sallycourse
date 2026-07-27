import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { connectDb, Course as CourseModel } from '@sallycourse/db';
import { QUEUE_NAMES, type QueueName } from '@sallycourse/shared';
import { requireApiUser } from '@/lib/session';
import { estimateWaitTime } from '@/lib/queue-estimate';

/**
 * GET /api/courses/[id]/queue-estimate?step=<queueName> — estimation du temps
 * d'attente avant traitement du step demandé (P73). Utilisé par l'écran de
 * génération pour afficher « ~X min avant traitement » pendant qu'un job
 * patiente dans la file. 404 volontaire (pas 403) pour ne pas révéler les
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

  const step = new URL(request.url).searchParams.get('step');
  if (!step || !(QUEUE_NAMES as readonly string[]).includes(step)) {
    return NextResponse.json({ error: 'Paramètre "step" invalide.', code: 'invalidStepParam' }, { status: 400 });
  }

  await connectDb();
  const course = await CourseModel.findOne({ _id: id, userId: user.id }).select('_id').lean();
  if (!course) {
    return apiError('courseNotFound');
  }

  const estimate = await estimateWaitTime(step as QueueName);
  return NextResponse.json(estimate, { status: 200 });
}
