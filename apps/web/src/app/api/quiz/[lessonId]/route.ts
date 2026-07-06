import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { quizQuestionSchema } from '@sallycourse/shared';
import {
  connectDb,
  Course as CourseModel,
  Lesson as LessonModel,
  Quiz as QuizModel,
} from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';

/**
 * PATCH /api/quiz/[lessonId] — remplace les questions du quiz d'une leçon
 * depuis l'éditeur. Ownership via le cours parent, validation stricte contre
 * quizQuestionSchema (4 choix, index valide). Upsert du document Quiz :
 * n'affecte QUE cette leçon. 404 (et non 403) hors ownership.
 */

const patchQuizSchema = z.object({
  questions: z.array(quizQuestionSchema).min(1),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ lessonId: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { lessonId } = await params;
  if (!isValidObjectId(lessonId)) {
    return NextResponse.json({ error: 'Leçon introuvable.' }, { status: 404 });
  }

  const parsed = patchQuizSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Questions invalides.' },
      { status: 400 },
    );
  }

  await connectDb();

  const lesson = await LessonModel.findById(lessonId).select('_id courseId sectionId').lean();
  if (!lesson) {
    return NextResponse.json({ error: 'Leçon introuvable.' }, { status: 404 });
  }

  // Ownership via le cours parent.
  const course = await CourseModel.findOne({ _id: lesson.courseId, userId: user.id })
    .select('_id')
    .lean();
  if (!course) {
    return NextResponse.json({ error: 'Leçon introuvable.' }, { status: 404 });
  }

  // Upsert : crée le quiz s'il n'existait pas, sinon remplace ses questions.
  await QuizModel.updateOne(
    { lessonId: lesson._id },
    {
      $set: { questions: parsed.data.questions },
      $setOnInsert: { courseId: lesson.courseId, sectionId: lesson.sectionId },
    },
    { upsert: true },
  );

  return NextResponse.json({ lessonId: lessonId, count: parsed.data.questions.length });
}
