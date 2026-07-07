import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { QUEUES, defaultJobOptions, makeJobId } from '@sallycourse/shared';
import { connectDb, Course as CourseModel, Lesson as LessonModel } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { getContentQueue } from '@/lib/queues';

/**
 * POST /api/lessons/[id]/apply-suggestion — applique une suggestion issue du
 * feedback étudiant (P62) : régénère la leçon en injectant l'instruction dans
 * le contexte du générateur. Réutilise le mécanisme de régénération existant
 * (queue 'content-generation', jobId déterministe), avec le champ `instruction`
 * porté par le job. 404 volontaire (pas 403) pour ne rien révéler.
 */

const bodySchema = z.object({
  instruction: z.string().trim().min(1, "L'instruction est requise.").max(2000),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: 'Leçon introuvable.' }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Instruction invalide.', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
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
    await queue.remove(jobId).catch(() => undefined);
    await queue.add(
      'regenerate-lesson',
      { courseId, lessonId, instruction: parsed.data.instruction },
      { ...defaultJobOptions, jobId },
    );
  } catch {
    return NextResponse.json(
      { error: 'Impossible de lancer la régénération, réessayez plus tard.' },
      { status: 503 },
    );
  }

  // Statut APRÈS enqueue : pas de leçon bloquée en 'generating' si Redis KO.
  lesson.status = 'generating';
  await lesson.save();

  return NextResponse.json({ id: lessonId, status: lesson.status }, { status: 202 });
}
