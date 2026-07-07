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
import { getObjectStream, presignedGetUrl } from '@sallycourse/shared';
import { requireUser } from '@/lib/session';
import { StudentPreview } from '@/components/course/preview';
import type { PreviewCourse, PreviewLesson } from '@/components/course/preview';

/**
 * /dashboard/courses/[id]/preview — Aperçu « mode étudiant » du cours (P60).
 * Server Component : garde d'auth + OWNERSHIP (l'auteur prévisualise SON cours,
 * quel que soit le statut de publication), charge sections/leçons/quiz triés,
 * présigne les URLs vidéo et lit les articles Markdown, puis délègue au client
 * <StudentPreview /> (lecteur séquentiel, quiz, progression locale).
 */

// URLs présignées à durée de vie courte + données propriétaire : pas de cache.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Aperçu étudiant — SallyCourse',
};

/** Présigne une clé S3 (1 h) ; http(s) conservé ; échec → undefined. */
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

export default async function CoursePreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();

  const { id } = await params;
  if (!isValidObjectId(id)) notFound();

  await connectDb();

  // Ownership : 404 (et non 403) pour ne pas révéler les cours des autres.
  const course = await CourseModel.findOne({ _id: id, userId: user.id })
    .select('title locale outline')
    .lean();
  if (!course) notFound();

  // Le cours n'a pas de champ résumé propre : on dérive un sous-titre du plan
  // généré (description, à défaut sous-titre), sinon chaîne vide.
  const summary =
    (typeof course.outline?.description === 'string' && course.outline.description) ||
    (typeof course.outline?.subtitle === 'string' && course.outline.subtitle) ||
    '';

  const [sections, lessons, quizzes] = await Promise.all([
    SectionModel.find({ courseId: id }).sort({ order: 1 }).lean(),
    LessonModel.find({ courseId: id }).sort({ order: 1 }).lean(),
    QuizModel.find({ courseId: id }).lean(),
  ]);

  // Quiz indexés par leçon (une leçon 'quiz' porte ses questions).
  const quizByLesson = new Map(quizzes.map((q) => [String(q.lessonId), q.questions]));
  const sectionOrderById = new Map(sections.map((s) => [String(s._id), s.order]));

  // Vues de leçons : présignature vidéo/sous-titres + lecture article.
  const lessonViews: PreviewLesson[] = await Promise.all(
    lessons.map(async (l) => {
      const questions = quizByLesson.get(String(l._id)) ?? [];
      const [videoUrl, captionsUrl, articleMd] = await Promise.all([
        safePresign(l.assets?.videoUrl),
        safePresign(l.assets?.vttUrl),
        l.type === 'article' ? safeReadMarkdown(l.assets?.articleMd) : Promise.resolve(undefined),
      ]);
      return {
        id: String(l._id),
        sectionId: String(l.sectionId),
        title: l.title,
        type: l.type,
        durationMin: l.durationMin ?? 0,
        videoUrl,
        captionsUrl,
        articleMd,
        quiz: questions.map((q) => ({
          question: q.question,
          choices: [...q.choices],
          correctIndex: q.correctIndex,
          explanation: q.explanation ?? '',
        })),
      };
    }),
  );

  const view: PreviewCourse = {
    id,
    title: course.title,
    summary,
    locale: course.locale,
    sections: sections
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ id: String(s._id), title: s.title, order: s.order })),
    // Tri global : (ordre de section, puis l'ordre de leçon déjà appliqué par le tri DB).
    lessons: lessonViews
      .map((lesson, index) => ({ lesson, index }))
      .sort((a, b) => {
        const sa = sectionOrderById.get(a.lesson.sectionId) ?? 0;
        const sb = sectionOrderById.get(b.lesson.sectionId) ?? 0;
        if (sa !== sb) return sa - sb;
        return a.index - b.index; // Stable : conserve l'ordre DB des leçons.
      })
      .map((e) => e.lesson),
  };

  return <StudentPreview course={view} />;
}
