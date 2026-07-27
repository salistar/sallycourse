import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { QUEUES, defaultJobOptions, makeJobId } from '@sallycourse/shared';
import {
  connectDb,
  Course as CourseModel,
  Lesson as LessonModel,
  Section as SectionModel,
} from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { getContentQueue, getScreenshotQueue, getTtsQueue } from '@/lib/queues';

/**
 * POST /api/courses/[id]/continue-generation — mode « validation étape par
 * étape » (generationMode='validated') : l'auteur a relu la dernière leçon
 * générée et VALIDE — on enfile la PROCHAINE leçon 'pending' dans l'ordre
 * global du cours (section.order puis lesson.order, même convention que le
 * chaînage worker). Job nommé 'lesson-content' : côté worker, la chaîne
 * s'arrêtera à nouveau après cette leçon (re-validation), sauf mode 'auto'.
 * 404 volontaire (pas 403) pour ne pas révéler les cours des autres.
 */

/** Même stride que le worker (processors/outline-generation) — ordre global. */
const ORDER_STRIDE = 1000;

export async function POST(
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
    .select('_id status generationMode')
    .lean();
  if (!course) {
    return apiError('courseNotFound');
  }
  if (course.status !== 'generating') {
    return NextResponse.json(
      { error: 'La génération de ce cours n’est pas en cours.', code: 'courseGenerationNotRunning' },
      { status: 409 },
    );
  }

  // Une leçon est déjà en cours de génération : la validation n'a pas encore
  // de cible — on refuse proprement (le bouton UI est masqué dans ce cas).
  const inFlight = await LessonModel.countDocuments({ courseId: id, status: 'generating' });
  if (inFlight > 0) {
    return NextResponse.json(
      { error: 'Une leçon est déjà en cours de génération — attendez sa fin.', code: 'lessonAlreadyGenerating' },
      { status: 409 },
    );
  }

  // P170 — points de validation « après les scripts » (vidéo) et « après le
  // brouillon » (TP) : d'abord relancer le MÉDIA des leçons dont le texte a été
  // relu (status 'ready' mais média pas encore produit). En mode normal, aucune
  // leçon n'est dans cet état → bloc ignoré.
  const [readyVideos, readyTps] = await Promise.all([
    LessonModel.find({ courseId: id, type: 'video', status: 'ready' }).select('_id assets').lean(),
    LessonModel.find({ courseId: id, type: 'tp', status: 'ready' }).select('_id assets').lean(),
  ]);
  const pendingVideos = readyVideos.filter((l) => !(l.assets as { videoUrl?: string } | undefined)?.videoUrl);
  const pendingTps = readyTps.filter(
    (l) => ((l.assets as { screenshots?: unknown[] } | undefined)?.screenshots?.length ?? 0) === 0,
  );
  if (pendingVideos.length > 0 || pendingTps.length > 0) {
    try {
      const ttsQueue = getTtsQueue();
      for (const l of pendingVideos) {
        const jobId = makeJobId(id, QUEUES.tts, String(l._id));
        await ttsQueue.remove(jobId).catch(() => undefined);
        await ttsQueue.add(QUEUES.tts, { courseId: id, lessonId: String(l._id) }, { ...defaultJobOptions, jobId });
      }
      const screenshotQueue = getScreenshotQueue();
      for (const l of pendingTps) {
        const jobId = makeJobId(id, QUEUES.screenshot, String(l._id));
        await screenshotQueue.remove(jobId).catch(() => undefined);
        await screenshotQueue.add(QUEUES.screenshot, { courseId: id, lessonId: String(l._id) }, { ...defaultJobOptions, jobId });
      }
    } catch {
      return NextResponse.json({ error: 'Impossible de lancer le média, réessayez plus tard.', code: 'mediaStartFailed' }, { status: 503 });
    }
    return NextResponse.json({ resumedMedia: pendingVideos.length + pendingTps.length }, { status: 202 });
  }

  const sections = await SectionModel.find({ courseId: id }).select('_id order').lean();
  const sectionOrder = new Map(sections.map((s) => [String(s._id), s.order]));
  const pending = await LessonModel.find({ courseId: id, status: 'pending' })
    .select('_id sectionId order')
    .lean();

  const next = pending
    .map((l) => ({
      id: String(l._id),
      g: (sectionOrder.get(String(l.sectionId)) ?? 0) * ORDER_STRIDE + l.order,
    }))
    .sort((a, b) => a.g - b.g)[0];

  if (!next) {
    return NextResponse.json(
      { done: true, message: 'Toutes les leçons sont générées — finalisation en cours.' },
      { status: 200 },
    );
  }

  try {
    const queue = getContentQueue();
    const jobId = makeJobId(id, QUEUES.content, next.id);
    await queue.remove(jobId).catch(() => undefined);
    await queue.add('lesson-content', { courseId: id, lessonId: next.id }, { ...defaultJobOptions, jobId });
  } catch {
    return NextResponse.json(
      { error: 'Impossible de lancer la leçon suivante, réessayez plus tard.', code: 'nextLessonStartFailed' },
      { status: 503 },
    );
  }

  return NextResponse.json({ nextLessonId: next.id }, { status: 202 });
}
