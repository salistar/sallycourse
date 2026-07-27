import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { isValidObjectId } from 'mongoose';
import {
  connectDb,
  BlogPost as BlogPostModel,
  Course as CourseModel,
  Lesson as LessonModel,
  LmsListing as LmsListingModel,
  Quiz as QuizModel,
  Section as SectionModel,
  Workspace as WorkspaceModel,
} from '@sallycourse/db';
import { getObjectStream, objectExists, presignedGetUrl, storageKeys } from '@sallycourse/shared';
import { requireUser } from '@/lib/session';
import { loadCourseAccess } from '@/lib/workspace-access';
import { CourseDetail, DmcaKitPanel } from '@/components/course';
import type {
  CourseBlogView,
  CourseDetailView,
  CourseResourcesView,
  MarketingKitView,
  RepurposingView,
  LessonView,
  QaReportView,
  QualityScoreView,
  ReviewFeedbackView,
  SectionView,
  SlideView,
  TpContentView,
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('course.detail');
  return { title: t('metaTitle') };
}

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

/** Extrait le contenu structuré d'un TP de lesson.script (structure TpContent, Lot 5, plan 2026-07-20). */
function extractTp(script: unknown): TpContentView | undefined {
  if (!script || typeof script !== 'object') return undefined;
  const raw = script as Record<string, unknown>;
  const steps = raw.steps;
  if (!Array.isArray(steps) || typeof raw.objective !== 'string') return undefined;
  return {
    objective: raw.objective,
    environment: Array.isArray(raw.environment)
      ? raw.environment.filter((e): e is string => typeof e === 'string')
      : [],
    steps: steps.map((entry) => {
      const step = (entry ?? {}) as Record<string, unknown>;
      const { instruction, command, expectedResult, ...rest } = step;
      return {
        instruction: typeof instruction === 'string' ? instruction : '',
        command: typeof command === 'string' ? command : undefined,
        expectedResult: typeof expectedResult === 'string' ? expectedResult : '',
        rest,
      };
    }),
    validation: Array.isArray(raw.validation)
      ? raw.validation.filter((v): v is string => typeof v === 'string')
      : [],
    troubleshooting: Array.isArray(raw.troubleshooting)
      ? raw.troubleshooting.filter((t): t is string => typeof t === 'string')
      : [],
  };
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

/**
 * Normalise `Course.repurposing` (P197/201/202/203) en DTO présigné : flashcards
 * (JSON + Anki), podcast (RSS), ebook (EPUB/PDF), trailer. Section masquée si rien.
 */
async function toRepurposingView(
  raw: unknown,
  courseId: string,
  sections: { order: number; title: string }[],
): Promise<RepurposingView | null> {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as {
    flashcards?: { count?: unknown; jsonKey?: unknown; ankiKey?: unknown };
    podcast?: { episodes?: unknown; feedKey?: unknown };
    ebook?: { epubKey?: unknown; pdfKey?: unknown };
    trailer?: { videoKey?: unknown };
  };
  const view: RepurposingView = {};

  if (r.flashcards && typeof r.flashcards.count === 'number') {
    const [jsonUrl, ankiUrl] = await Promise.all([
      safePresign(typeof r.flashcards.jsonKey === 'string' ? r.flashcards.jsonKey : undefined),
      safePresign(typeof r.flashcards.ankiKey === 'string' ? r.flashcards.ankiKey : undefined),
    ]);
    view.flashcards = { count: r.flashcards.count, jsonUrl, ankiUrl };
  }
  if (r.podcast && typeof r.podcast.episodes === 'number') {
    // Le modèle ne stocke que le nombre d'épisodes ; les MP3 vivent à des clés
    // déterministes par section (podcastEpisode). On énumère les sections et on
    // présigne celles dont l'épisode existe réellement, pour un vrai lecteur.
    const episodes: { title: string; url: string }[] = [];
    for (const section of sections) {
      const key = storageKeys.course(courseId).podcastEpisode(section.order);
      if (await objectExists(key)) {
        const url = await safePresign(key);
        if (url) episodes.push({ title: section.title, url });
      }
    }
    view.podcast = {
      count: r.podcast.episodes,
      feedUrl: await safePresign(typeof r.podcast.feedKey === 'string' ? r.podcast.feedKey : undefined),
      episodes: episodes.length > 0 ? episodes : undefined,
    };
  }
  if (r.ebook) {
    const [epubUrl, pdfUrl] = await Promise.all([
      safePresign(typeof r.ebook.epubKey === 'string' ? r.ebook.epubKey : undefined),
      safePresign(typeof r.ebook.pdfKey === 'string' ? r.ebook.pdfKey : undefined),
    ]);
    if (epubUrl || pdfUrl) view.ebook = { epubUrl, pdfUrl };
  }
  if (r.trailer && typeof r.trailer.videoKey === 'string') {
    view.trailer = { videoUrl: await safePresign(r.trailer.videoKey) };
  }
  return Object.keys(view).length > 0 ? view : null;
}

/**
 * Normalise `Course.marketing` (Prompt 28) en DTO présigné : textes (description
 * Udemy, promo, messages, idées de titres scorées) + visuels (cover Udemy 750×422,
 * miniature YouTube 1280×720, hero SDXL). Renvoie null si non généré/incomplet.
 */
async function toMarketingView(raw: unknown): Promise<MarketingKitView | null> {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as {
    status?: unknown;
    content?: {
      udemyDescription?: unknown;
      promoText?: unknown;
      welcomeMessage?: unknown;
      congratsMessage?: unknown;
      titleIdeas?: unknown;
    };
    assets?: { udemyCover?: unknown; youtubeThumbnail?: unknown; heroCover?: unknown };
  };
  const c = m.content;
  if (!c || typeof c.udemyDescription !== 'string') return null;

  const titleIdeas = Array.isArray(c.titleIdeas)
    ? c.titleIdeas
        .filter((t): t is { title: string; score: number; reason: string } =>
          Boolean(t && typeof t === 'object' && typeof (t as { title?: unknown }).title === 'string'),
        )
        .map((t) => ({ title: t.title, score: Number(t.score) || 0, reason: String(t.reason ?? '') }))
    : [];

  const [udemyCoverUrl, youtubeThumbnailUrl, heroCoverUrl] = await Promise.all([
    safePresign(typeof m.assets?.udemyCover === 'string' ? m.assets.udemyCover : undefined),
    safePresign(typeof m.assets?.youtubeThumbnail === 'string' ? m.assets.youtubeThumbnail : undefined),
    safePresign(typeof m.assets?.heroCover === 'string' ? m.assets.heroCover : undefined),
  ]);

  return {
    udemyDescription: c.udemyDescription,
    promoText: typeof c.promoText === 'string' ? c.promoText : '',
    welcomeMessage: typeof c.welcomeMessage === 'string' ? c.welcomeMessage : '',
    congratsMessage: typeof c.congratsMessage === 'string' ? c.congratsMessage : '',
    titleIdeas,
    udemyCoverUrl,
    youtubeThumbnailUrl,
    heroCoverUrl,
  };
}

/**
 * Blog SEO du cours (P204) : articles générés à la publication sur le LMS,
 * dans l'ordre du plan éditorial. `publishedOnLms` pilote l'affichage de la
 * section (sans publication, aucun blog n'est généré).
 */
async function loadBlogView(courseId: string): Promise<CourseBlogView> {
  const [listing, posts] = await Promise.all([
    LmsListingModel.findOne({ courseId, published: true }).select('_id').lean(),
    BlogPostModel.find({ courseId }).select('slug title keyword status scheduledFor publishedAt').sort({ order: 1 }).lean(),
  ]);

  return {
    publishedOnLms: Boolean(listing),
    posts: posts.map((post) => ({
      slug: post.slug,
      title: post.title,
      keyword: post.keyword,
      status: post.status,
      scheduledFor: post.scheduledFor.toISOString(),
      publishedAt: post.publishedAt ? post.publishedAt.toISOString() : null,
    })),
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

  // Ownership : owner solo OU membre du Workspace du cours (P138) — 404 (et
  // non 403) pour ne pas révéler les cours des autres.
  const access = await loadCourseAccess(id, user.id);
  if (!access) notFound();
  const course = await CourseModel.findById(id).lean();
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
          const [videoUrl, vttUrl, videoVerticalUrl, screenshots, articleMd] = await Promise.all([
            safePresign(lesson.assets?.videoUrl),
            safePresign(lesson.assets?.vttUrl),
            // Export vertical 9:16 (P167) — rendu par le worker mais jamais
            // exposé dans l'UI avant l'audit connectivité 2026-07-17.
            safePresign((lesson.assets as { videoVerticalUrl?: string } | undefined)?.videoVerticalUrl),
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
              videoVerticalUrl,
              articleMd,
              // Lot 5 (plan 2026-07-20) : PRÉSERVE l'alignement par index avec
              // tp.steps[i] (une chaîne vide = pas encore de capture pour cette
              // étape) — un .filter() ici compacterait le tableau et
              // désaligner readait screenshots[i] de steps[i] dès qu'une
              // capture manque ou est supprimée manuellement.
              screenshots: screenshots.map((url) => url ?? ''),
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
            tpContent: extractTp(lesson.script),
            videoQualityStatus: lesson.videoQualityStatus,
          };
        }),
      );

      return { id: sectionId, title: section.title, order: section.order, lessons: lessonsView };
    }),
  );

  // Map titre → id de leçon (dernière leçon gagne en cas de doublon) : sert à
  // résoudre les `lessonRef` de l'analyse de feedback (P62) vers un lessonId.
  const lessonTitleToId = new Map(lessons.map((lesson) => [lesson.title, lesson._id.toString()]));

  // Contexte Workspace (P138) : résolu une seule fois pour piloter le bandeau
  // d'approbation et l'affichage des commentaires d'équipe. Absent = cours solo.
  let workspaceView: CourseDetailView['workspace'] = null;
  if (course.workspaceId) {
    const workspaceDoc = await WorkspaceModel.findById(course.workspaceId).lean();
    if (workspaceDoc) {
      const hasReviewer = workspaceDoc.members.some((m) => m.role === 'reviewer');
      workspaceView = {
        id: workspaceDoc._id.toString(),
        role: access.role,
        hasReviewer,
      };
    }
  }

  // Vues indépendantes construites EN PARALLÈLE (audit optimisations
  // 2026-07-26, item #5 : présignations/agrégations distinctes, aucune
  // dépendance mutuelle) — latence de la page détail réduite.
  const [resourcesView, repurposingView, marketingView, blogView] = await Promise.all([
    toResourcesView(course.resources),
    toRepurposingView(
      course.repurposing,
      course._id.toString(),
      sectionsView.map((s) => ({ order: s.order, title: s.title })),
    ),
    toMarketingView(course.marketing),
    loadBlogView(course._id.toString()),
  ]);
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
    generationMode: course.generationMode ?? 'auto',
    // Thème visuel (catalogue 2026-07-26) — absent = « salistar » (défaut).
    ...(course.themeId ? { themeId: course.themeId } : {}),
    // Dernier rapport de révision automatique (2026-07-26).
    reviewReport: (course.reviewReport as CourseDetailView['reviewReport']) ?? null,
    sections: sectionsView,
    qaReport: toQaReportView(course.qaReport),
    qualityScore: toQualityScoreView(course.qualityScore),
    feedback: toFeedbackView(course.improvementSuggestions, lessonTitleToId),
    resources: resourcesView,
    repurposing: repurposingView,
    marketing: marketingView,
    archived: Boolean(course.archived),
    blog: blogView,
    dubbedVersions: dubbedVersionsView,
    workspace: workspaceView,
    approvedBy: course.approvedBy ? course.approvedBy.toString() : null,
    approvedAt: course.approvedAt ? course.approvedAt.toISOString() : null,
    providerMix: course.providerMix,
  };

  return (
    <>
      <CourseDetail course={courseView} />
      {/* Kit anti-piratage DMCA (P206) — utile quand le cours est diffusé (LMS) :
          l'auteur génère la notification de retrait + checklist, sans envoi auto. */}
      {blogView.publishedOnLms && (
        // Aligné sur la largeur de CourseDetail (conteneur du layout) : pas de
        // max-w/padding propres, qui désalignaient le panneau et ses gouttières.
        <div className="pb-12">
          <DmcaKitPanel courseId={course._id.toString()} />
        </div>
      )}
    </>
  );
}
