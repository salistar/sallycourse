import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { Course as CourseModel, DeploymentSchedule, connectDb } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

/**
 * POST /api/courses/[id]/deploy-schedule/[action] — pilote un plan drip (P181) :
 *  - `pause`  : suspend les passages (status → paused) sans perdre l'avancement ;
 *  - `resume` : reprend (status → active) ; les échéances passées se déclenchent
 *               au prochain cron ;
 *  - `cancel` : supprime définitivement le plan.
 * Ownership → 404 (convention repo).
 */

export const dynamic = 'force-dynamic';

const ACTIONS = ['pause', 'resume', 'cancel'] as const;
type ScheduleAction = (typeof ACTIONS)[number];

function isAction(v: string): v is ScheduleAction {
  return (ACTIONS as readonly string[]).includes(v);
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id, action } = await params;
  if (!isValidObjectId(id)) {
    return apiError('courseNotFound');
  }
  if (!isAction(action)) {
    return NextResponse.json({ error: 'Action inconnue.', code: 'unknownAction' }, { status: 400 });
  }

  await connectDb();

  // Ownership → 404 (convention repo).
  const course = await CourseModel.findOne({ _id: id, userId: user.id }).select('_id').lean();
  if (!course) {
    return apiError('courseNotFound');
  }

  const schedule = await DeploymentSchedule.findOne({ courseId: id });
  if (!schedule) {
    return NextResponse.json({ error: 'Aucun plan de publication programmé.', code: 'noScheduledPublicationPlan' }, { status: 404 });
  }

  if (action === 'cancel') {
    await schedule.deleteOne();
    return NextResponse.json({ status: 'cancelled' });
  }

  // pause/resume : on ne réactive pas un plan déjà terminé (rien à reprendre).
  if (action === 'resume' && schedule.status === 'completed') {
    return NextResponse.json({ error: 'Plan déjà terminé.', code: 'planAlreadyCompleted' }, { status: 409 });
  }
  schedule.status = action === 'pause' ? 'paused' : 'active';
  await schedule.save();

  return NextResponse.json({ status: schedule.status });
}
