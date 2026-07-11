import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { QUEUES, defaultJobOptions, makeJobId, slideScriptSchema } from '@sallycourse/shared';
import {
  connectDb,
  Course as CourseModel,
  Lesson as LessonModel,
} from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { getTtsQueue } from '@/lib/queues';

/**
 * POST /api/courses/[id]/reactivate — réactive un cours archivé (P79) :
 * bascule Course.archived=false + status='generating', puis RÉ-ENQUEUE la
 * génération de chaque leçon vidéo directement sur la queue tts-generation,
 * en réutilisant Lesson.script déjà persisté en base — AUCUN rappel au LLM
 * (pas de re-facturation). Les leçons non-vidéo (article/quiz/tp) n'ont pas
 * de pipeline de rendu à rejouer : leur contenu déjà généré reste servi tel
 * quel. 404 volontaire (pas 403) pour ne pas révéler les cours des autres
 * utilisateurs.
 */
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

  if (!course.archived) {
    return NextResponse.json(
      { error: "Ce cours n'est pas archivé." },
      { status: 409 },
    );
  }

  const courseId = course._id.toString();

  // Leçons vidéo dont le script (slides + narration) est déjà valide en base :
  // seules celles-là peuvent reprendre au niveau TTS sans repasser par le LLM.
  const videoLessons = await LessonModel.find({ courseId, type: 'video' })
    .select('_id script')
    .lean();

  const resumable = videoLessons.filter((l) => slideScriptSchema.safeParse(l.script).success);

  try {
    const queue = getTtsQueue();
    for (const lesson of resumable) {
      const lessonId = String(lesson._id);
      const jobId = makeJobId(courseId, QUEUES.tts, lessonId);
      // Purge le jobId d'une exécution précédente (terminée/échouée) pour
      // autoriser un vrai re-run — même garde que regenerate-outline.
      await queue.remove(jobId).catch(() => undefined);
      await queue.add(
        'reactivate-lesson',
        { courseId, lessonId },
        { ...defaultJobOptions, jobId },
      );
    }
    await LessonModel.updateMany(
      { courseId, type: 'video' },
      { $set: { status: 'generating' } },
    );
  } catch {
    return NextResponse.json(
      { error: 'Impossible de relancer la génération, réessayez plus tard.' },
      { status: 503 },
    );
  }

  // Statut mis à jour APRÈS l'enqueue (cohérent avec regenerate-outline).
  course.archived = false;
  course.archivedAt = null;
  course.status = 'generating';
  await course.save();

  return NextResponse.json(
    { id: courseId, status: course.status, resumedLessons: resumable.length },
    { status: 202 },
  );
}
