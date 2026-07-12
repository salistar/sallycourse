import { NextResponse } from 'next/server';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { connectDb, Course as CourseModel, Enrollment as EnrollmentModel, Lesson as LessonModel } from '@sallycourse/db';
import type { Locale } from '@sallycourse/shared';
import { requireApiUser } from '@/lib/session';
import { extractClientIp, rateLimit } from '@/lib/rate-limit';
import { answerCourseQuestion, type ChatbotLessonInput } from '@/lib/course-chatbot';

/**
 * POST /api/lms/courses/[id]/ask — assistant de cours (Prompt 146). L'étudiant
 * inscrit pose une question en langage naturel sur le cours ; on cherche les
 * passages pertinents dans le contenu déjà généré (RAG mots-clés local) puis
 * on appelle Claude pour une réponse sourcée (sourceLessonIds). Rate-limité
 * (appel LLM coûteux) par utilisateur + IP, même schéma que more-exercises.
 */

export const dynamic = 'force-dynamic';

const ASK_USER_LIMIT = { limit: 20, windowSec: 300 };
const ASK_IP_LIMIT = { limit: 60, windowSec: 300 };

const bodySchema = z.object({
  question: z.string().trim().min(3).max(500),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id: courseId } = await params;
  if (!isValidObjectId(courseId)) {
    return NextResponse.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Question invalide (3 à 500 caractères).' }, { status: 400 });
  }

  const ip = extractClientIp(request);
  const [userLimit, ipLimit] = await Promise.all([
    rateLimit(`course-ask:user:${user.id}`, ASK_USER_LIMIT),
    rateLimit(`course-ask:ip:${ip}`, ASK_IP_LIMIT),
  ]);
  const hit = !userLimit.allowed ? userLimit : !ipLimit.allowed ? ipLimit : null;
  if (hit) {
    return NextResponse.json(
      { error: 'Trop de questions, réessayez plus tard.', code: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((hit.resetAt.getTime() - Date.now()) / 1000)) } },
    );
  }

  await connectDb();

  // Ownership pédagogique : l'étudiant doit être inscrit à CE cours.
  const enrollment = await EnrollmentModel.findOne({ studentId: user.id, courseId }).select('_id').lean();
  if (!enrollment) {
    return NextResponse.json({ error: 'Inscription requise pour utiliser l’assistant de cours.' }, { status: 403 });
  }

  const course = await CourseModel.findById(courseId).select('title locale').lean();
  if (!course) {
    return NextResponse.json({ error: 'Cours introuvable.' }, { status: 404 });
  }

  const lessons = await LessonModel.find({ courseId, status: 'ready' })
    .select('_id title type summary script assets.articleMd')
    .lean();

  const chatbotLessons: ChatbotLessonInput[] = lessons.map((l) => ({
    id: String(l._id),
    title: l.title,
    type: l.type,
    summary: l.summary,
    script: l.script,
    assets: { articleMd: l.assets?.articleMd },
  }));

  let answer;
  try {
    answer = await answerCourseQuestion({
      question: parsed.data.question,
      lessons: chatbotLessons,
      locale: (course.locale ?? 'fr') as Locale,
    });
  } catch {
    return NextResponse.json(
      { error: 'Assistant de cours indisponible pour le moment, réessayez plus tard.' },
      { status: 502 },
    );
  }

  return NextResponse.json({
    answer: answer.answer,
    sourceLessonIds: answer.sourceLessonIds,
  });
}
