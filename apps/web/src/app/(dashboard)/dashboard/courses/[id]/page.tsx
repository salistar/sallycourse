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
import { CourseDetail } from '@/components/course';
import type {
  CourseDetailView,
  CourseResourcesView,
  LessonView,
  QaReportView,
  QualityScoreView,
  ReviewFeedbackView,
  SectionView,
  SlideView,
} from '@/components/course';
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

/**
 * Résout le Markdown d'un article : `Lesson.assets.articleMd` stocke une clé
 * S3 (l'objet uploadé par le worker), on télécharge son contenu pour l'afficher
 * et l'éditer. Un échec (S3 indisponible) masque simplement l'article.
 */
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

/** Extrait les slides éditables de lesson.script (structure SlideScript). */
function extractSlides(script: unknown): SlideView[] | undefined {
  if (!script || typeof script !== 'object') return undefined;
  const raw = (script as { slides?: unknown }).slides;
  if (!Array.isArray(raw)) return undefined;
  return raw.map((entry) => {
    const slide = (entry ?? {}) as Record<string, unknown>;
    const { template, title, bullets, narration, ...rest } = slide;
    return {
      template: typeof template === 'string' ? template : 'content',
      title: typeof title === 'string' ? title : '',
      bullets: Array.isArray(bullets) ? bullets.filter((b): b is string => typeof b === 'string') : [],
      narration: typeof narration === 'string' ? narration : '',
      rest,
    };
  });
}

/**
 * Normalise le `Course.qaReport` (champ Mixed) en DTO sérialisable pour le
 * client. Toute structure inattendue renvoie null (aucun rapport affiché).
 */
function toQaReportView(raw: unknown): QaReportView | null {
  if (!raw || typeof raw !== 'object') return null;
  const report = raw as { passed?: unknown; ranAt?: unknown; checks?: unknown };
  if (typeof report.passed !== 'boolean' || !Array.isArray(report.checks)) return null;
  const checks = report.checks
    .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === 'object')
    .map((c) => ({
      code: typeof c.code === 'string' ? c.code : 'unknown',
      ok: c.ok === true,
      detail: typeof c.detail === 'string' ? c.detail : '',
    }));
  return {
    passed: report.passed,
    ranAt: typeof report.ranAt === 'string' ? report.ranAt : new Date().toISOString(),
    checks,
  };
}

/**
 * Normalise `Course.qualityScore` (champ Mixed, P94) en DTO sérialisable pour
 * le client. Toute structure inattendue renvoie null (aucun panneau affiché).
 */
function toQualityScoreView(raw: unknown): QualityScoreView | null {
  if (!raw || typeof raw !== 'object') return null;
  const q = raw as { score?: unknown; rubric?: unknown; feedback?: unknown; evaluatedAt?: unknown };
  if (typeof q.score !== 'number' || !q.rubric || typeof q.rubric !== 'object') return null;
  const rubric = q.rubric as Record<string, unknown>;
  const numOr0 = (v: unknown) => (typeof v === 'number' ? v : 0);
  return {
    score: q.score,
    rubric: {
      clarity: numOr0(rubric.clarity),
      progression: numOr0(rubric.progression),
      examples: numOr0(rubric.examples),
      engagement: numOr0(rubric.engagement),
    },
    feedback: Array.isArray(q.feedback) ? q.feedback.filter((f): f is string => typeof f === 'string') : [],
    evaluatedAt: typeof q.evaluatedAt === 'string' ? q.evaluatedAt : new Date().toISOString(),
  };
}

/**
 * Normalise `Course.improvementSuggestions` (champ Mixed, P62) en DTO
 * sérialisable pour le client, en résolvant chaque `lessonRef` (titre exact
 * de leçon produit par l'analyse) vers son `lessonId` réel — nécessaire pour
 * que le bouton « appliquer » régénère la bonne leçon. Toute structure
 * inattendue renvoie null (aucune section affichée).
 */
function toFeedbackView(
  raw: unknown,
  lessonTitleToId: Map<string, string>,
): ReviewFeedbackView | null {
  if (!raw || typeof raw !== 'object') return null;
  const analysis = raw as {
    themes?: unknown;
    suggestions?: unknown;
    reviewCount?: unknown;
    averageRating?: unknown;
    generatedAt?: unknown;
  };
  if (!Array.isArray(analysis.themes) || !Array.isArray(analysis.suggestions)) return null;

  const themes: ReviewFeedbackView['themes'] = analysis.themes
    .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === 'object')
    .map((t) => {
      const sentiment: ReviewFeedbackView['themes'][number]['sentiment'] =
        t.sentiment === 'positive' || t.sentiment === 'negative' ? t.sentiment : 'neutral';
      return {
        label: typeof t.label === 'string' ? t.label : '',
        sentiment,
        count: typeof t.count === 'number' ? t.count : 0,
        quotes: Array.isArray(t.quotes) ? t.quotes.filter((q): q is string => typeof q === 'string') : [],
      };
    });

  const suggestions = analysis.suggestions
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
    .map((s) => {
      const lessonRef = typeof s.lessonRef === 'string' ? s.lessonRef : null;
      return {
        lessonRef,
        lessonId: lessonRef ? (lessonTitleToId.get(lessonRef) ?? null) : null,
        action: typeof s.action === 'string' ? s.action : '',
        rationale: typeof s.rationale === 'string' ? s.rationale : '',
      };
    });

  return {
    themes,
    suggestions,
    reviewCount: typeof analysis.reviewCount === 'number' ? analysis.reviewCount : 0,
    averageRating: typeof analysis.averageRating === 'number' ? analysis.averageRating : 0,
    generatedAt: typeof analysis.generatedAt === 'string' ? analysis.generatedAt : new Date().toISOString(),
  };
}

/**
 * Normalise `Course.resources` (champ Mixed, P65) en DTO sérialisable pour le
 * client, en présignant les clés S3 des PDF (cheat sheet + workbook). Toute
 * structure inattendue ou génération non aboutie renvoie null (section masquée).
 */
async function toResourcesView(raw: unknown): Promise<CourseResourcesView | null> {
  if (!raw || typeof raw !== 'object') return null;
  const resources = raw as {
    status?: unknown;
    content?: { glossary?: unknown; furtherResources?: unknown };
    files?: { cheatsheetKey?: unknown; workbookKey?: unknown };
    generatedAt?: unknown;
  };
  if (resources.status !== 'ready' || !resources.content) return null;

  const glossary = Array.isArray(resources.content.glossary)
    ? resources.content.glossary
        .filter((g): g is Record<string, unknown> => Boolean(g) && typeof g === 'object')
        .map((g) => ({
          term: typeof g.term === 'string' ? g.term : '',
          definition: typeof g.definition === 'string' ? g.definition : '',
        }))
    : [];

  const furtherResources = Array.isArray(resources.content.furtherResources)
    ? resources.content.furtherResources
        .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object')
        .map((r) => ({
          title: typeof r.title === 'string' ? r.title : '',
          kind: typeof r.kind === 'string' ? r.kind : '',
          description: typeof r.description === 'string' ? r.description : '',
          ...(typeof r.url === 'string' && r.url ? { url: r.url } : {}),
        }))
    : [];

  const cheatsheetKey =
    typeof resources.files?.cheatsheetKey === 'string' ? resources.files.cheatsheetKey : undefined;
  const workbookKey =
    typeof resources.files?.workbookKey === 'string' ? resources.files.workbookKey : undefined;
  const [cheatsheetUrl, workbookUrl] = await Promise.all([safePresign(cheatsheetKey), safePresign(workbookKey)]);

  return {
    glossary,
    furtherResources,
    cheatsheetUrl,
    workbookUrl,
    generatedAt: typeof resources.generatedAt === 'string' ? resources.generatedAt : new Date().toISOString(),
  };
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

          // Présignature/résolution parallèle des assets de la leçon.
          const [videoUrl, vttUrl, screenshots, articleMd] = await Promise.all([
            safePresign(lesson.assets?.videoUrl),
            safePresign(lesson.assets?.vttUrl),
            Promise.all((lesson.assets?.screenshots ?? []).map((key) => safePresign(key))),
            safeReadMarkdown(lesson.assets?.articleMd),
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
              articleMd,
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
            scriptSlides: extractSlides(lesson.script),
          };
        }),
      );

      return { id: sectionId, title: section.title, order: section.order, lessons: lessonsView };
    }),
  );

  // Map titre → id de leçon (dernière leçon gagne en cas de doublon) : sert à
  // résoudre les `lessonRef` de l'analyse de feedback (P62) vers un lessonId.
  const lessonTitleToId = new Map(lessons.map((lesson) => [lesson.title, lesson._id.toString()]));

  const resourcesView = await toResourcesView(course.resources);
  const dubbedVersionsView = (course.dubbedVersions ?? []).map((v) => ({
    locale: v.locale,
    status: v.status,
    lessonsWithSubtitles: v.srtKeys?.length ?? 0,
    lessonsWithVideo: v.videoKeys?.length ?? 0,
    updatedAt: (v.updatedAt ?? new Date()).toISOString(),
  }));

  const courseView: CourseDetailView = {
    id: course._id.toString(),
    title: course.title,
    status: course.status,
    difficulty: course.difficulty,
    locale: course.locale,
    createdAt: course.createdAt.toISOString(),
    sections: sectionsView,
    qaReport: toQaReportView(course.qaReport),
    qualityScore: toQualityScoreView(course.qualityScore),
    feedback: toFeedbackView(course.improvementSuggestions, lessonTitleToId),
    resources: resourcesView,
    dubbedVersions: dubbedVersionsView,
  };

  return <CourseDetail course={courseView} />;
}
