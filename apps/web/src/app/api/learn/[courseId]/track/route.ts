import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { connectDb, Enrollment, Lesson, LessonProgress } from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

/**
 * POST /api/learn/[courseId]/track — événements granulaires du player LMS
 * (Prompt 144) : leçon commencée / temps passé approximatif / score de quiz.
 * Complète /progress (qui ne gère que la liste "complétée" côté Enrollment)
 * en alimentant LessonProgress, source de la heatmap d'abandon et de l'export
 * xAPI. Idempotent par (studentId, lessonId) : upsert, jamais de doublon.
 * Best-effort côté client — un échec ici ne bloque jamais la lecture.
 */

export const dynamic = 'force-dynamic';

/** Question ratée transmise avec l'événement "completed" d'un quiz (P145). */
const wrongAnswerSchema = z.object({
  question: z.string().min(1),
  theme: z.string().min(1),
  pickedIndex: z.number().int().min(0),
  correctIndex: z.number().int().min(0),
});

const bodySchema = z.object({
  lessonId: z.string().min(1),
  event: z.enum(['started', 'completed', 'heartbeat']),
  /** Secondes écoulées depuis le dernier événement (ajoutées au cumul). */
  deltaSeconds: z.number().min(0).max(3600).optional(),
  /** Score du quiz (0-100), transmis avec l'événement "completed" d'une leçon quiz. */
  quizScore: z.number().min(0).max(100).optional(),
  /** Questions ratées à cette tentative (P145) — alimente le générateur d'exercices ciblés. */
  wrongAnswers: z.array(wrongAnswerSchema).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { courseId } = await params;
  if (!isValidObjectId(courseId)) {
    return NextResponse.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 });
  }
  const { lessonId, event, deltaSeconds, quizScore, wrongAnswers } = parsed.data;
  if (!isValidObjectId(lessonId)) {
    return NextResponse.json({ error: 'Leçon introuvable.' }, { status: 404 });
  }

  await connectDb();

  const enrollment = await Enrollment.findOne({ studentId: user.id, courseId }).select('_id').lean();
  if (!enrollment) {
    return NextResponse.json({ error: 'Inscription requise.' }, { status: 403 });
  }

  const lesson = await Lesson.findOne({ _id: lessonId, courseId }).select('_id').lean();
  if (!lesson) {
    return NextResponse.json({ error: 'Leçon introuvable.' }, { status: 404 });
  }

  const now = new Date();
  const update: Record<string, unknown> = {
    $setOnInsert: {
      enrollmentId: enrollment._id,
      courseId,
      lessonId,
      studentId: user.id,
    },
    $inc: { timeSpentSeconds: deltaSeconds ?? 0 },
  };
  const set: Record<string, unknown> = {};
  if (event === 'started') set.startedAt = now;
  if (event === 'completed') {
    set.completedAt = now;
    if (typeof quizScore === 'number') set.quizScore = quizScore;
    // P145 : dernière tentative seulement (remplace, ne s'accumule pas).
    if (wrongAnswers) set.wrongAnswers = wrongAnswers;
  }
  if (Object.keys(set).length > 0) update.$set = set;

  await LessonProgress.updateOne({ studentId: user.id, lessonId }, update, { upsert: true });

  return NextResponse.json({ ok: true });
}
