import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isValidObjectId } from 'mongoose';
import {
  connectDb,
  Course as CourseModel,
  Lesson as LessonModel,
  Quiz as QuizModel,
  Section as SectionModel,
} from '@sallycourse/db';
import { presignedGetUrl } from '@sallycourse/shared';
import { requireUser } from '@/lib/session';
import { CourseDetail } from '@/components/course';
import type { CourseDetailView, LessonView, SectionView } from '@/components/course';
import { OutlineReview } from '@/components/outline';
import type { OutlineReviewCourse } from '@/components/outline';

/**
 * Page détail d'un cours — Server Component : garde d'auth + ownership,
 * chargement sections/leçons/quiz triés par ordre, présignature des URLs
 * d'assets S3 côté serveur, puis délégation au client <CourseDetail />.
 */

// Données personnelles + URLs présignées à durée de vie courte : jamais de cache.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Détail du cours — SallyCourse',
};

/**
 * Présigne une clé S3 (1 h). Les valeurs déjà absolues (http/https) sont
 * conservées telles quelles ; un échec de présignature (S3 indisponible)
 * masque simplement l'asset au lieu de faire tomber la page.
 */
async function safePresign(key: string | undefined): Promise<string | undefined> {
  if (!key) return undefined;
  if (/^https?:\/\//i.test(key)) return key;
  try {
    return await presignedGetUrl(key);
  } catch {
    return undefined;
  }
}

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();

  const { id } = await params;
  if (!isValidObjectId(id)) notFound();

  await connectDb();

  // Ownership : 404 (et non 403) pour ne pas révéler les cours des autres.
  const course = await CourseModel.findOne({ _id: id, userId: user.id }).lean();
  if (!course) notFound();

  // Plan en attente de validation : éditeur drag-and-drop à la place de
  // l'arborescence (pas de quiz ni de présignature d'assets à ce stade).
  if (course.status === 'outline-review') {
    const [sections, lessons] = await Promise.all([
      SectionModel.find({ courseId: course._id }).sort({ order: 1 }).lean(),
      LessonModel.find({ courseId: course._id }).sort({ order: 1 }).lean(),
    ]);

    const outlineCourse: OutlineReviewCourse = {
      id: course._id.toString(),
      title: course.title,
      difficulty: course.difficulty,
      locale: course.locale,
      createdAt: course.createdAt.toISOString(),
      sections: sections.map((section) => {
        const sectionId = section._id.toString();
        return {
          id: sectionId,
          title: section.title,
          lessons: lessons
            .filter((lesson) => lesson.sectionId.toString() === sectionId)
            .map((lesson) => ({
              id: lesson._id.toString(),
              title: lesson.title,
              type: lesson.type,
              durationMin: lesson.durationMin,
              summary: lesson.summary,
            })),
        };
      }),
    };

    return <OutlineReview course={outlineCourse} />;
  }

  const [sections, lessons, quizzes] = await Promise.all([
    SectionModel.find({ courseId: course._id }).sort({ order: 1 }).lean(),
    LessonModel.find({ courseId: course._id }).sort({ order: 1 }).lean(),
    QuizModel.find({ courseId: course._id }).lean(),
  ]);

  const quizByLesson = new Map(quizzes.map((quiz) => [quiz.lessonId.toString(), quiz]));

  const sectionsView: SectionView[] = await Promise.all(
    sections.map(async (section) => {
      const sectionId = section._id.toString();
      const sectionLessons = lessons.filter((lesson) => lesson.sectionId.toString() === sectionId);

      const lessonsView: LessonView[] = await Promise.all(
        sectionLessons.map(async (lesson) => {
          const lessonId = lesson._id.toString();
          const quiz = quizByLesson.get(lessonId);

          // Présignature parallèle des assets de la leçon.
          const [videoUrl, vttUrl, screenshots] = await Promise.all([
            safePresign(lesson.assets?.videoUrl),
            safePresign(lesson.assets?.vttUrl),
            Promise.all((lesson.assets?.screenshots ?? []).map((key) => safePresign(key))),
          ]);

          return {
            id: lessonId,
            title: lesson.title,
            type: lesson.type,
            status: lesson.status,
            order: lesson.order,
            durationMin: lesson.durationMin,
            summary: lesson.summary,
            assets: {
              videoUrl,
              vttUrl,
              articleMd: lesson.assets?.articleMd,
              screenshots: screenshots.filter((url): url is string => Boolean(url)),
            },
            quiz: quiz
              ? quiz.questions.map((question) => ({
                  question: question.question,
                  choices: [...question.choices],
                  correctIndex: question.correctIndex,
                  explanation: question.explanation ?? '',
                }))
              : null,
          };
        }),
      );

      return { id: sectionId, title: section.title, order: section.order, lessons: lessonsView };
    }),
  );

  const courseView: CourseDetailView = {
    id: course._id.toString(),
    title: course.title,
    status: course.status,
    difficulty: course.difficulty,
    locale: course.locale,
    createdAt: course.createdAt.toISOString(),
    sections: sectionsView,
  };

  return <CourseDetail course={courseView} />;
}
