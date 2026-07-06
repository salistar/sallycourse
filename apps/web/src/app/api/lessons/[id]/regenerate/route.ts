import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { QUEUES, defaultJobOptions, makeJobId } from '@sallycourse/shared';
import { connectDb, Course as CourseModel, Lesson as LessonModel } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { getContentQueue } from '@/lib/queues';

/**
 * POST /api/lessons/[id]/regenerate — relance la génération de contenu d'une
 * leçon : vérifie l'ownership via le cours parent, enfile un job
 * 'content-generation' (jobId déterministe) puis repasse la leçon en
 * 'generating'. 404 volontaire (pas 403) pour ne pas révéler l'existence
 * d'une leçon d'un autre utilisateur.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: 'Leçon introuvable.' }, { status: 404 });
  }

  await connectDb();

  const lesson = await LessonModel.findById(id);
  if (!lesson) {
    return NextResponse.json({ error: 'Leçon introuvable.' }, { status: 404 });
  }

  // Ownership : la leçon doit appartenir à un cours de l'utilisateur.
  const course = await CourseModel.findOne({ _id: lesson.courseId, userId: user.id })
    .select('_id')
    .lean();
  if (!course) {
    return NextResponse.json({ error: 'Leçon introuvable.' }, { status: 404 });
  }

  const courseId = lesson.courseId.toString();
  const lessonId = lesson._id.toString();
  const jobId = makeJobId(courseId, QUEUES.content, lessonId);

  try {
    const queue = getContentQueue();
    // Une exécution précédente (terminée ou échouée) garderait le jobId
    // réservé : on la purge pour autoriser un vrai re-run.
    await queue.remove(jobId).catch(() => undefined);
    await queue.add('regenerate-lesson', { courseId, lessonId }, { ...defaultJobOptions, jobId });
  } catch {
    return NextResponse.json(
      { error: 'Impossible de lancer la régénération, réessayez plus tard.' },
      { status: 503 },
    );
  }

  // Statut mis à jour APRÈS l'enqueue : pas de leçon bloquée en 'generating'
  // si Redis est indisponible.
  lesson.status = 'generating';
  await lesson.save();

  return NextResponse.json({ id: lessonId, status: lesson.status }, { status: 202 });
}
