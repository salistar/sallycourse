import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { isValidObjectId } from 'mongoose';
import {
  connectDb,
  Course as CourseModel,
  Lesson as LessonModel,
  LessonProgress as LessonProgressModel,
  PersonalizedExercise as PersonalizedExerciseModel,
} from '@sallycourse/db';
import type { Locale } from '@sallycourse/shared';
import { requireApiUser } from '@/lib/session';
import { extractClientIp, rateLimit } from '@/lib/rate-limit';
import {
  exerciseCountForThemes,
  generatePersonalizedExercises,
  selectWeakThemes,
  type WrongAnswerInput,
} from '@/lib/exercise-generator';

/**
 * POST /api/lms/lessons/[id]/more-exercises — bouton étudiant « Plus
 * d'exercices » (Prompt 145). Analyse LessonProgress.wrongAnswers de
 * l'étudiant connecté sur cette leçon (dernière tentative de quiz), en
 * dérive les thèmes faibles, puis génère 3-5 questions ciblées via Claude
 * (callClaudeJson-like côté web, mock-friendly). Stocke le résultat dans
 * PersonalizedExercise (séparé du Quiz officiel). Rate-limité par utilisateur
 * + IP pour éviter l'abus (réutilise lib/rate-limit.ts existant).
 */

export const dynamic = 'force-dynamic';

/** Limites : génération coûteuse (appel LLM) — plus strict qu'un simple fetch. */
const EXERCISES_USER_LIMIT = { limit: 5, windowSec: 300 };
const EXERCISES_IP_LIMIT = { limit: 15, windowSec: 300 };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id: lessonId } = await params;
  if (!isValidObjectId(lessonId)) {
    return apiError('lessonNotFound');
  }

  const ip = extractClientIp(request);
  const [userLimit, ipLimit] = await Promise.all([
    rateLimit(`more-exercises:user:${user.id}`, EXERCISES_USER_LIMIT),
    rateLimit(`more-exercises:ip:${ip}`, EXERCISES_IP_LIMIT),
  ]);
  const hit = !userLimit.allowed ? userLimit : !ipLimit.allowed ? ipLimit : null;
  if (hit) {
    return NextResponse.json(
      { error: 'Trop de générations d’exercices, réessayez plus tard.', code: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((hit.resetAt.getTime() - Date.now()) / 1000)) } },
    );
  }

  await connectDb();

  const lesson = await LessonModel.findById(lessonId).select('_id courseId title type').lean();
  if (!lesson) {
    return apiError('lessonNotFound');
  }
  if (lesson.type !== 'quiz') {
    return NextResponse.json(
      { error: 'Les exercices personnalisés ne sont disponibles que pour les leçons de type quiz.', code: 'customExercisesQuizOnly' },
      { status: 409 },
    );
  }

  const progress = await LessonProgressModel.findOne({ studentId: user.id, lessonId })
    .select('wrongAnswers courseId')
    .lean();

  const wrongAnswers: WrongAnswerInput[] = (progress?.wrongAnswers ?? []).map((wa) => ({
    question: wa.question,
    theme: wa.theme,
    pickedIndex: wa.pickedIndex,
    correctIndex: wa.correctIndex,
  }));

  if (wrongAnswers.length === 0) {
    return NextResponse.json(
      {
        error: 'Aucune réponse erronée enregistrée sur cette leçon — passez le quiz au moins une fois pour obtenir des exercices ciblés.', code: 'noWrongAnswersForTargetedExercises',
      },
      { status: 400 },
    );
  }

  const weakThemes = selectWeakThemes(wrongAnswers);
  const questionCount = exerciseCountForThemes(weakThemes.length);

  // Cours parent : titre + locale pour un prompt contextualisé.
  const courseId = String(lesson.courseId);
  const course = await CourseModel.findById(courseId).select('title locale').lean();

  let questions;
  try {
    questions = await generatePersonalizedExercises({
      courseTitle: course?.title ?? 'Cours',
      lessonTitle: lesson.title,
      locale: (course?.locale ?? 'fr') as Locale,
      weakThemes,
      wrongAnswers,
      questionCount,
    });
  } catch {
    return NextResponse.json(
      { error: 'Génération des exercices indisponible pour le moment, réessayez plus tard.', code: 'exerciseGenerationUnavailable' },
      { status: 502 },
    );
  }

  const exercise = await PersonalizedExerciseModel.create({
    studentId: user.id,
    lessonId,
    courseId,
    targetedThemes: weakThemes,
    questions,
  });

  return NextResponse.json({
    id: String(exercise._id),
    targetedThemes: weakThemes,
    questions: questions.map((q) => ({
      question: q.question,
      choices: [...q.choices],
      correctIndex: q.correctIndex,
      explanation: q.explanation,
    })),
  });
}
