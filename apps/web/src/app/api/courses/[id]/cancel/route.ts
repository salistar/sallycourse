import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { connectDb, Course as CourseModel } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

/**
 * POST /api/courses/[id]/cancel — annulation propre d'une génération en cours
 * (P73). Marque uniquement Course.status='cancelled' : le worker détecte ce
 * statut via checkCancelled(courseId) (apps/worker/src/lib/cancellation.ts)
 * entre deux étapes longues et s'arrête proprement (pas de kill forcé côté
 * web — Redis/BullMQ n'exposent pas d'annulation mi-job fiable). 404
 * volontaire (pas 403) pour ne pas révéler les cours des autres utilisateurs.
 */

/** Statuts depuis lesquels une annulation a un sens (génération réellement en cours). */
const CANCELLABLE_STATUSES = new Set(['generating', 'outline-review']);

export async function POST(
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

  const course = await CourseModel.findOne({ _id: id, userId: user.id });
  if (!course) {
    return NextResponse.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  if (!CANCELLABLE_STATUSES.has(course.status)) {
    return NextResponse.json(
      { error: `Ce cours n'est pas annulable (statut : ${course.status}).` },
      { status: 409 },
    );
  }

  course.status = 'cancelled';
  await course.save();

  return NextResponse.json({ id: course._id.toString(), status: course.status }, { status: 200 });
}
