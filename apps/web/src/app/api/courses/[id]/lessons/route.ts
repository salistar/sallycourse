import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { QUEUES, defaultJobOptions, lessonTypeSchema, makeJobId, outlineSchema } from '@sallycourse/shared';
import { connectDb, Course as CourseModel, Lesson as LessonModel, Section as SectionModel } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { getContentQueue } from '@/lib/queues';

/**
 * POST /api/courses/[id]/lessons — AJOUTE une leçon (video/article/tp/quiz) à
 * un cours, y compris DÉJÀ GÉNÉRÉ (ready/published) — demande produit
 * 2026-07-26. La leçon est créée en fin de section cible puis générée par le
 * pipeline existant via un job 'regenerate-lesson' (génération UNITAIRE : ne
 * chaîne pas les leçons voisines, enfile son propre pipeline média, et
 * finalizeCourseIfComplete reste un no-op sur un cours déjà ready — le reste
 * du cours n'est jamais touché).
 *
 * Rate-limité implicitement par la génération (une leçon à la fois par jobId
 * déterministe). Aucun crédit de quota consommé : le quota est par COURS.
 * 404 volontaire (jamais 403) pour ne pas révéler les cours d'autrui.
 */

const bodySchema = z.object({
  sectionId: z.string().min(1),
  type: lessonTypeSchema,
  title: z.string().trim().min(3).max(160),
  /** Brief optionnel injecté dans le prompt de génération (mêmes limites que P171). */
  summary: z.string().trim().min(1).max(1000).optional(),
  durationMin: z.number().min(1).max(60).optional(),
});

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

  const parsedBody = bodySchema.safeParse(await request.json().catch(() => undefined));
  if (!parsedBody.success) {
    return apiError('invalidData');
  }
  const { sectionId, type, title, summary, durationMin } = parsedBody.data;
  if (!isValidObjectId(sectionId)) {
    return apiError('sectionNotFound');
  }

  await connectDb();

  const course = await CourseModel.findOne({ _id: id, userId: user.id });
  if (!course) {
    return apiError('courseNotFound');
  }
  // On n'ajoute pas de leçon à un cours en cours de génération initiale : la
  // chaîne séquentielle croirait à une leçon « pending » de son propre plan et
  // la génèrerait dans le désordre. Tous les autres statuts sont acceptés.
  if (course.status === 'generating' || course.status === 'outline-review') {
    return apiError('courseStillGenerating');
  }

  const section = await SectionModel.findOne({ _id: sectionId, courseId: id });
  if (!section) {
    return apiError('sectionNotFound');
  }

  // Append en fin de section : order = max + 1 (pas d'unicité sur lesson.order).
  const last = await LessonModel.findOne({ sectionId }).sort({ order: -1 }).select('order').lean();
  const order = (last?.order ?? -1) + 1;

  const lesson = await LessonModel.create({
    courseId: course._id,
    sectionId: section._id,
    order,
    title,
    type,
    status: 'pending',
    ...(summary ? { summary } : {}),
    ...(durationMin ? { durationMin } : {}),
  });
  const lessonId = lesson._id.toString();

  // Synchronise l'outline dénormalisé (marketing/derive/translate le lisent) —
  // best-effort : une divergence d'outline ne doit pas bloquer l'ajout.
  try {
    const parsedOutline = outlineSchema.safeParse(course.outline);
    if (parsedOutline.success) {
      const target = parsedOutline.data.sections[section.order];
      if (target) {
        target.lessons.push({
          title,
          type,
          durationMin: durationMin ?? 5,
          summary: summary ?? '',
        });
        course.outline = parsedOutline.data;
        course.markModified('outline');
        await course.save();
      }
    }
  } catch {
    /* outline stale acceptable — les vues lisent les collections */
  }

  const jobId = makeJobId(String(course._id), QUEUES.content, lessonId);
  try {
    const queue = getContentQueue();
    await queue.remove(jobId).catch(() => undefined);
    await queue.add(
      'regenerate-lesson',
      {
        courseId: String(course._id),
        lessonId,
        // Le brief de l'auteur guide la rédaction de la nouvelle leçon.
        ...(summary ? { instruction: summary } : {}),
      },
      { ...defaultJobOptions, jobId },
    );
  } catch {
    // Rollback : sans job, une leçon 'pending' resterait orpheline à l'écran.
    await LessonModel.deleteOne({ _id: lesson._id }).catch(() => undefined);
    return NextResponse.json(
      { error: 'Impossible de lancer la génération de la leçon, réessayez plus tard.', code: 'cannotGenerateLesson' },
      { status: 503 },
    );
  }

  lesson.status = 'generating';
  await lesson.save();

  return NextResponse.json(
    { id: lessonId, sectionId: String(section._id), order, type, status: lesson.status },
    { status: 201 },
  );
}
