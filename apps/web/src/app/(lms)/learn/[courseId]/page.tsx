import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isValidObjectId } from 'mongoose';
import {
  connectDb,
  Course as CourseModel,
  Enrollment as EnrollmentModel,
  Lesson as LessonModel,
  LmsListing as LmsListingModel,
  Quiz as QuizModel,
  Section as SectionModel,
} from '@sallycourse/db';
import { getObjectStream, presignedGetUrl } from '@sallycourse/shared';
import { auth } from '@/lib/auth';
import { LearnCourseExperience } from '@/components/learn';
import type { LearnCourseView, LearnLessonView } from '@/components/learn';

/**
 * /learn/[courseId] — page cours du LMS interne. Server Component : vérifie que
 * le cours est publié, charge sections/leçons/quiz triés, présigne les URLs
 * vidéo et lit les articles Markdown depuis le stockage, puis délègue au client
 * <LearnCourseExperience /> (player, articles, quiz, progression, certificat).
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ courseId: string }>;
}): Promise<Metadata> {
  const { courseId } = await params;
  if (!isValidObjectId(courseId)) return { title: 'Cours — SallyCourse Academy' };
  await connectDb();
  const listing = await LmsListingModel.findOne({ courseId, published: true })
    .select('title summary')
    .lean();
  return {
    title: listing ? `${listing.title} — SallyCourse Academy` : 'Cours — SallyCourse Academy',
    description: listing?.summary ?? undefined,
  };
}

/** Présigne une clé S3 vidéo/asset (1 h) ; http(s) conservé ; échec → undefined. */
async function safePresign(key: string | undefined): Promise<string | undefined> {
  if (!key) return undefined;
  if (/^https?:\/\//i.test(key)) return key;
  try {
    return await presignedGetUrl(key);
  } catch {
    return undefined;
  }
}

/** Télécharge le Markdown d'un article depuis sa clé S3 ; échec → undefined. */
async function safeReadMarkdown(key: string | undefined): Promise<string | undefined> {
  if (!key) return undefined;
  try {
    const stream = await getObjectStream(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf-8');
  } catch {
    return undefined;
  }
}

export default async function LearnCoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  if (!isValidObjectId(courseId)) notFound();

  await connectDb();

  const listing = await LmsListingModel.findOne({ courseId, published: true }).lean();
  if (!listing) notFound();

  const course = await CourseModel.findById(courseId).select('title locale').lean();
  if (!course) notFound();

  const [sections, lessons] = await Promise.all([
    SectionModel.find({ courseId }).sort({ order: 1 }).lean(),
    LessonModel.find({ courseId }).sort({ order: 1 }).lean(),
  ]);

  // Quiz indexés par leçon (une leçon 'quiz' porte ses questions).
  const quizzes = await QuizModel.find({ courseId }).lean();
  const quizByLesson = new Map(quizzes.map((q) => [String(q.lessonId), q.questions]));
  const sectionOrderById = new Map(sections.map((s) => [String(s._id), s.order]));

  // Construit les vues de leçons : présignature vidéo + lecture article.
  const lessonViews: LearnLessonView[] = await Promise.all(
    lessons.map(async (l) => {
      const questions = quizByLesson.get(String(l._id)) ?? [];
      return {
        id: String(l._id),
        sectionId: String(l.sectionId),
        title: l.title,
        type: l.type,
        durationMin: l.durationMin ?? 0,
        videoUrl: await safePresign(l.assets?.videoUrl),
        captionsUrl: await safePresign(l.assets?.vttUrl),
        articleMd: l.type === 'article' ? await safeReadMarkdown(l.assets?.articleMd) : undefined,
        quiz: questions.map((q) => ({
          question: q.question,
          choices: [...q.choices],
          correctIndex: q.correctIndex,
          explanation: q.explanation ?? '',
        })),
      };
    }),
  );

  // Progression apprenant (si connecté ET inscrit).
  const session = await auth();
  const studentId = session?.user?.id;
  let enrolled = false;
  let completedLessons: string[] = [];
  let completedAt: string | null = null;
  if (studentId) {
    const enrollment = await EnrollmentModel.findOne({ studentId, courseId })
      .select('completedLessons completedAt')
      .lean();
    if (enrollment) {
      enrolled = true;
      completedLessons = enrollment.completedLessons.map((id) => String(id));
      completedAt = enrollment.completedAt ? new Date(enrollment.completedAt).toISOString() : null;
    }
  }

  const view: LearnCourseView = {
    id: courseId,
    title: course.title,
    summary: listing.summary,
    sections: sections
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ id: String(s._id), title: s.title, order: s.order })),
    lessons: lessonViews.sort((a, b) => {
      const sa = sectionOrderById.get(a.sectionId) ?? 0;
      const sb = sectionOrderById.get(b.sectionId) ?? 0;
      return sa - sb;
    }),
    priceCents: listing.priceCents ?? 0,
    currency: listing.currency ?? 'MAD',
  };

  return (
    <LearnCourseExperience
      course={view}
      isAuthenticated={Boolean(studentId)}
      enrolled={enrolled}
      completedLessons={completedLessons}
      completedAt={completedAt}
    />
  );
}
