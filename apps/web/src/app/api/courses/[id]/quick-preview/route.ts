import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
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
 * POST /api/courses/[id]/quick-preview — « Générer un aperçu rapide (brouillon) »
 * (Prompt 133). Ré-enqueue TOUTES les leçons vidéo du cours directement sur la
 * queue tts-generation avec mode='quick-preview' (réutilise Lesson.script déjà
 * persisté, AUCUN rappel LLM — même pattern que reactivate) : voix TTS standard
 * forcée (aucun clonage, ttsVoiceForMode) puis rendu vidéo preset='draft'
 * (veryfast/CRF21, ~5x plus rapide). Nécessite un script déjà généré (mode
 * render-only) : les leçons sans script valide sont ignorées silencieusement
 * (pas encore passées par content-generation). 404 volontaire (pas 403) pour
 * ne pas révéler les cours des autres utilisateurs.
 */
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

  await connectDb();

  const course = await CourseModel.findOne({ _id: id, userId: user.id }).select('_id').lean();
  if (!course) {
    return apiError('courseNotFound');
  }

  const courseId = String(course._id);

  const videoLessons = await LessonModel.find({ courseId, type: 'video' })
    .select('_id script')
    .lean();

  // Seules les leçons dont le script (slides + narration) est déjà valide
  // peuvent reprendre au niveau TTS sans repasser par le générateur LLM.
  const withScript = videoLessons.filter((l) => slideScriptSchema.safeParse(l.script).success);
  const eligible: VideoLessonQualityInput[] = withScript.map((l) => ({ lessonId: String(l._id) }));
  const lessonIds = selectLessonsForMode(eligible, 'quick-preview');

  if (lessonIds.length === 0) {
    return NextResponse.json(
      { error: 'Aucune leçon vidéo avec script généré — lancez la génération de contenu avant l\'aperçu.', code: 'noVideoLessonWithScript' },
      { status: 409 },
    );
  }

  try {
    const queue = getTtsQueue();
    for (const lessonId of lessonIds) {
      const jobId = makeJobId(courseId, QUEUES.tts, lessonId, 'quick-preview');
      // Purge une exécution précédente (terminée/échouée) pour autoriser un
      // vrai re-run — même garde que reactivate/regenerate-outline.
      await queue.remove(jobId).catch(() => undefined);
      await queue.add(
        'quick-preview-lesson',
        { courseId, lessonId, mode: 'quick-preview' },
        { ...defaultJobOptions, jobId },
      );
    }
    await LessonModel.updateMany(
      { _id: { $in: lessonIds } },
      { $set: { status: 'generating' } },
    );
  } catch {
    return NextResponse.json(
      { error: "Impossible de lancer l'aperçu rapide, réessayez plus tard.", code: 'cannotStartQuickPreview' },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { id: courseId, queuedLessons: lessonIds.length },
    { status: 202 },
  );
}
