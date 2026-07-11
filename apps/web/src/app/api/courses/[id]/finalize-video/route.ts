import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import {
  QUEUES,
  defaultJobOptions,
  makeJobId,
  selectLessonsForMode,
  slideScriptSchema,
  type VideoLessonQualityInput,
} from '@sallycourse/shared';
import { connectDb, Course as CourseModel, Lesson as LessonModel } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { getTtsQueue } from '@/lib/queues';

/**
 * POST /api/courses/[id]/finalize-video — « Générer la version finale HD »
 * (Prompt 133). Ré-enqueue UNIQUEMENT les leçons vidéo APPROUVÉES
 * (videoQualityStatus 'approved'|'final-ready', cf. isEligibleForFinal) sur la
 * queue tts-generation avec mode='final' : voix du cours (clonée ou non) + preset
 * ffmpeg 'final' (slow/CRF19). Réutilise Lesson.script déjà persisté — aucun
 * rappel LLM. 404 volontaire (pas 403) pour ne pas révéler les cours des autres
 * utilisateurs. 409 si aucune leçon n'est encore approuvée (l'utilisateur doit
 * d'abord valider l'aperçu via POST /api/lessons/[id]/approve-preview).
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

  const course = await CourseModel.findOne({ _id: id, userId: user.id }).select('_id').lean();
  if (!course) {
    return NextResponse.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  const courseId = String(course._id);

  const videoLessons = await LessonModel.find({ courseId, type: 'video' })
    .select('_id script videoQualityStatus')
    .lean();

  const withScript = videoLessons.filter((l) => slideScriptSchema.safeParse(l.script).success);
  const candidates: VideoLessonQualityInput[] = withScript.map((l) => ({
    lessonId: String(l._id),
    videoQualityStatus: l.videoQualityStatus,
  }));
  const lessonIds = selectLessonsForMode(candidates, 'final');

  if (lessonIds.length === 0) {
    return NextResponse.json(
      { error: "Aucune leçon approuvée — validez d'abord l'aperçu rapide de chaque leçon." },
      { status: 409 },
    );
  }

  try {
    const queue = getTtsQueue();
    for (const lessonId of lessonIds) {
      const jobId = makeJobId(courseId, QUEUES.tts, lessonId, 'final');
      await queue.remove(jobId).catch(() => undefined);
      await queue.add(
        'finalize-lesson',
        { courseId, lessonId, mode: 'final' },
        { ...defaultJobOptions, jobId },
      );
    }
    await LessonModel.updateMany(
      { _id: { $in: lessonIds } },
      { $set: { status: 'generating' } },
    );
  } catch {
    return NextResponse.json(
      { error: 'Impossible de lancer la version finale, réessayez plus tard.' },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { id: courseId, queuedLessons: lessonIds.length },
    { status: 202 },
  );
}
