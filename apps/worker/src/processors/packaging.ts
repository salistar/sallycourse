// Processor BullMQ « packaging » (Prompt 30) : construit le pack export ZIP
// d'un cours, prêt à uploader chez Udemy.
//
// Arborescence du ZIP :
//   01-nom-section/
//     01-nom-lecon.mp4          (leçon vidéo — si rendue)
//     01-nom-lecon.srt          (sous-titres — si présents)
//     02-nom-article.html       (leçon article — Markdown converti en HTML)
//     ...
//   quiz/
//     NN-nom-section.csv        (quiz de section, format Udemy bulk)
//   quiz-solutions.pdf          (solutions rendues via gabarit PDF D10)
//   marketing/
//     description.txt           (description Udemy SEO)
//     cover.png                 (image de cours)
//
// Le ZIP est assemblé par archiver dans un PassThrough puis persisté sous
// courses/{id}/exports/course-pack.zip. NB : uploadObject matérialise
// actuellement ce flux en un Buffer avant PutObject (PutObject exige une
// longueur connue ; le vrai streaming multipart nécessiterait
// @aws-sdk/lib-storage, non installé — cf. storage.ts). Le PDF réutilise le
// navigateur singleton du slide-renderer (page.pdf()). Progression publiée en continu.

import { PassThrough, type Readable } from 'node:stream';
import archiver from 'archiver';
import type { Job } from 'bullmq';
import {
  Course,
  Lesson,
  PdfTemplate,
  Quiz,
  Section,
  QUEUES,
  MASTER_ARCHIVE_FILENAMES,
  getConfig,
  getObjectStream,
  listObjectKeys,
  masterArchiveSubKey,
  mediaArchivePath,
  objectExists,
  publishProgress,
  renderPdfTemplate,
  serializeMasterArchiveFiles,
  storageKeys,
  uploadObject,
  type ILesson,
  type Locale,
  type MasterArchive,
  type MasterArchiveMediaEntry,
  type PackagingJobData,
  type QuizQuestion,
  type QuizSolutionsPdfInput,
} from '../shared.js';
import { getRedisConnection } from '../queues/connection.js';
import { logger } from '../queues/index.js';
import { getSlideBrowser } from '../media/slide-renderer.js';
import { exportCourseScorm } from '../deploy/scorm-export.js';
import {
  articleHtmlDocument,
  markdownToHtml,
  orderedName,
  quizToUdemyCsv,
  slugify,
} from '../media/pack.js';
import {
  lessonFileName,
  portableHomeHtml,
  portableLessonHtml,
  sectionDirName,
  type PortableCourseInput,
  type PortableLessonInput,
  type PortableSectionInput,
} from '../media/portable-export.js';
import {
  buildCopyBlocks,
  buildGuideHtml,
  buildReadme,
  buildVideoInventory,
  manualGuidePackFileName,
  manualPlatformFormat,
  type ManualGuideInput,
  type ManualGuideLesson,
  type ManualGuideSection,
} from '../media/manual-guide.js';
import {
  MASTER_ARCHIVE_FILENAME,
  buildMasterArchiveCourse,
  buildMasterArchiveLessons,
  buildMasterArchiveManifest,
  buildMasterArchiveQuizzes,
  buildMasterArchiveSections,
  masterArchiveReadme,
  type MasterArchiveCourseDoc,
  type MasterArchiveQuizDoc,
  type MasterArchiveSectionDoc,
} from '../media/master-archive.js';

/** Nom du fichier ZIP dans le bucket (sous storageKeys…exports). */
export const COURSE_PACK_FILENAME = 'course-pack.zip';

/** Nom du fichier ZIP du mode portable (mini-site HTML autonome, Prompt 142). */
export const PORTABLE_PACK_FILENAME = 'course-portable.zip';

export interface PackagingResult {
  courseId: string;
  /** Clé S3 du ZIP produit. */
  zipKey: string;
  /** Nombre de leçons médias (vidéo/article) incluses. */
  lessons: number;
  /** Nombre de sections comportant un quiz exporté. */
  quizzes: number;
}

/** Publie la progression du step packaging (best-effort). */
async function report(
  courseId: string,
  progress: number,
  message: string,
  level: 'info' | 'warn' | 'error' = 'info',
): Promise<void> {
  try {
    await publishProgress(getRedisConnection(), {
      courseId,
      step: QUEUES.packaging,
      progress,
      message,
      level,
      ts: Date.now(),
    });
  } catch (err) {
    logger.warn({ courseId, err }, 'publication de progression impossible');
  }
}

/** Télécharge le contenu texte d'un objet S3 (utf-8) ; null si absent. */
async function readTextObject(key: string): Promise<string | null> {
  try {
    const stream = (await getObjectStream(key)) as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks).toString('utf-8');
  } catch {
    return null;
  }
}

/** Étend l'accès `content.udemyDescription` d'un Course.marketing typé Mixed. */
function marketingDescription(marketing: unknown): string | undefined {
  const content = (marketing as { content?: { udemyDescription?: unknown } } | null | undefined)?.content;
  const description = content?.udemyDescription;
  return typeof description === 'string' && description.trim() ? description : undefined;
}

/** Étend l'accès `assets.udemyCover` (clé S3 de l'image de cours). */
function marketingCoverKey(marketing: unknown): string | undefined {
  const cover = (marketing as { assets?: { udemyCover?: unknown } } | null | undefined)?.assets?.udemyCover;
  return typeof cover === 'string' && cover ? cover : undefined;
}

/**
 * Rend les solutions de quiz en PDF via le gabarit D10 (quiz-solutions) et
 * Playwright (page.pdf()). Réutilise le navigateur singleton du slide-renderer.
 */
async function renderQuizSolutionsPdf(input: QuizSolutionsPdfInput): Promise<Buffer> {
  const html = renderPdfTemplate(PdfTemplate.QuizSolutions, input);
  const browser = await getSlideBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Convertit un quiz Mongo en questions pour le gabarit PDF (answerIndex base 0). */
function toPdfQuestions(questions: QuizQuestion[]): QuizSolutionsPdfInput['questions'] {
  return questions
    .filter((q) => q.choices.length >= 2)
    .map((q) => ({
      question: q.question,
      choices: [...q.choices],
      answerIndex: q.correctIndex,
      explanation: q.explanation ?? '',
    }));
}

/**
 * Processor de la queue packaging (un job = un cours). Construit et streame le
 * ZIP, puis le persiste sous courses/{id}/exports/course-pack.zip. `mode:
 * 'portable'` (Prompt 142) délègue à buildPortablePack (mini-site HTML
 * autonome) après avoir chargé les mêmes données cours/sections/leçons/quiz.
 */
export async function processPackaging(job: Job<PackagingJobData>): Promise<PackagingResult> {
  const { courseId, mode = 'zip' } = job.data;

  await report(courseId, 3, 'Chargement du cours pour le packaging');
  const course = await Course.findById(courseId);
  if (!course) throw new Error(`cours introuvable : ${courseId}`);

  const [sections, lessons, quizzes] = await Promise.all([
    Section.find({ courseId: course._id }).sort({ order: 1 }),
    Lesson.find({ courseId: course._id }).sort({ order: 1 }),
    Quiz.find({ courseId: course._id }),
  ]);

  if (mode === 'portable') {
    return buildPortablePack(courseId, course, sections, lessons, quizzes);
  }

  if (mode === 'manual-guide') {
    return buildManualGuidePack(
      courseId,
      course,
      sections,
      lessons,
      quizzes,
      job.data.platform ?? 'udemy',
      job.data.resume,
    );
  }

  if (mode === 'archive') {
    return buildMasterArchive(courseId, course, sections, lessons, quizzes);
  }

  if (mode === 'scorm') {
    // Paquet SCORM 1.2 importable dans un LMS tiers (Prompt 42). Le runner
    // recharge ses propres données ; on mappe items/assets sur lessons/quizzes
    // du PackagingResult (compteurs).
    await report(courseId, 40, 'Construction du paquet SCORM');
    const scorm = await exportCourseScorm(courseId);
    return { courseId, zipKey: scorm.zipKey, lessons: scorm.items, quizzes: scorm.assets };
  }

  const locale: Locale = course.locale;
  const zipKey = storageKeys.course(courseId).exportFile(COURSE_PACK_FILENAME);

  // Regroupe les leçons par section (ordre déjà trié).
  const lessonsBySection = new Map<string, ILesson[]>();
  for (const lesson of lessons) {
    const sid = lesson.sectionId.toString();
    const bucket = lessonsBySection.get(sid) ?? [];
    bucket.push(lesson);
    lessonsBySection.set(sid, bucket);
  }
  const quizBySection = new Map<string, QuizQuestion[]>();
  for (const quiz of quizzes) {
    const sid = quiz.sectionId.toString();
    const bucket = quizBySection.get(sid) ?? [];
    bucket.push(...quiz.questions);
    quizBySection.set(sid, bucket);
  }

  // ── Archive streamée vers le stockage ────────────────────────────
  const archive = archiver('zip', { zlib: { level: 9 } });
  const passthrough = new PassThrough();
  archive.on('warning', (err) => logger.warn({ courseId, err }, 'avertissement archiver'));
  // L'erreur d'archive rejette le pipeline d'upload via destroy du flux.
  archive.on('error', (err) => passthrough.destroy(err));
  archive.pipe(passthrough);

  // Upload lancé en parallèle : consomme le flux au fil de l'écriture.
  const uploadPromise = uploadObject(zipKey, passthrough, 'application/zip');

  let mediaLessons = 0;
  let quizCount = 0;
  const allQuizQuestions: QuizQuestion[] = [];

  try {
    await report(courseId, 15, 'Ajout des leçons au pack');

    for (const section of sections) {
      const sid = section._id.toString();
      const sectionDir = orderedName(section.order, section.title);
      const sectionLessons = lessonsBySection.get(sid) ?? [];

      for (const lesson of sectionLessons) {
        const base = orderedName(lesson.order, lesson.title);
        const keys = storageKeys.course(courseId).lesson(section.order, lesson.order);

        if (lesson.type === 'video') {
          const videoKey = keys.video();
          if (await objectExists(videoKey)) {
            archive.append((await getObjectStream(videoKey)) as Readable, {
              name: `${sectionDir}/${base}.mp4`,
            });
            mediaLessons += 1;
            // Sous-titres associés (si générés).
            const srtKey = keys.captionsSrt();
            if (await objectExists(srtKey)) {
              archive.append((await getObjectStream(srtKey)) as Readable, {
                name: `${sectionDir}/${base}.srt`,
              });
            }
          }
        } else if (lesson.type === 'article') {
          // Markdown stocké soit inline (assets.articleMd = clé S3), soit via clé leçon.
          const mdKey = lesson.assets?.articleMd ?? keys.article();
          const markdown = await readTextObject(mdKey);
          if (markdown) {
            const bodyHtml = markdownToHtml(markdown);
            const doc = articleHtmlDocument(lesson.title, bodyHtml, locale);
            archive.append(doc, { name: `${sectionDir}/${base}.html` });
            mediaLessons += 1;
          }
        }
      }

      // Quiz de la section → CSV Udemy bulk.
      const sectionQuiz = quizBySection.get(sid) ?? [];
      if (sectionQuiz.length > 0) {
        archive.append(quizToUdemyCsv(sectionQuiz), {
          name: `quiz/${orderedName(section.order, section.title)}.csv`,
        });
        quizCount += 1;
        allQuizQuestions.push(...sectionQuiz);
      }
    }

    // ── PDF des solutions de quiz (tous les quiz du cours) ──────────
    if (allQuizQuestions.length > 0) {
      await report(courseId, 55, 'Rendu du PDF des solutions de quiz');
      try {
        const pdf = await renderQuizSolutionsPdf({
          lang: locale,
          direction: locale === 'ar' ? 'rtl' : 'ltr',
          courseTitle: course.title,
          docTitle: 'Solutions des quiz',
          questions: toPdfQuestions(allQuizQuestions),
        });
        archive.append(pdf, { name: 'quiz-solutions.pdf' });
      } catch (err) {
        // Le PDF est un bonus : son échec ne fait pas tomber le pack.
        logger.warn({ courseId, err }, 'rendu du PDF des solutions impossible — omis du pack');
        await report(courseId, 55, 'PDF des solutions ignoré (rendu impossible)', 'warn');
      }
    }

    // ── Dossier marketing (description + image de cours) ────────────
    await report(courseId, 75, 'Ajout des éléments marketing');
    const description = marketingDescription(course.marketing);
    if (description) {
      archive.append(description, { name: 'marketing/description.txt' });
    }
    const coverKey = marketingCoverKey(course.marketing) ?? course.coverImageUrl;
    if (coverKey && !/^https?:\/\//i.test(coverKey) && (await objectExists(coverKey))) {
      archive.append((await getObjectStream(coverKey)) as Readable, {
        name: `marketing/cover-${slugify(course.title)}.png`,
      });
    }

    await report(courseId, 90, 'Finalisation de l’archive');
    await archive.finalize();
    await uploadPromise;

    await report(courseId, 100, `Pack prêt : ${mediaLessons} leçon(s), ${quizCount} quiz`);
    logger.info({ courseId, zipKey, lessons: mediaLessons, quizzes: quizCount }, 'pack export construit');
    return { courseId, zipKey, lessons: mediaLessons, quizzes: quizCount };
  } catch (err) {
    // Abandonne l'archive et le flux pour ne pas laisser l'upload pendant.
    archive.abort();
    passthrough.destroy();
    await uploadPromise.catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ courseId, err }, 'échec du packaging');
    await report(courseId, 0, `Échec du packaging : ${message}`, 'error').catch(() => undefined);
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Mode portable (Prompt 142) : mini-site HTML/CSS/JS autonome          */
/* ------------------------------------------------------------------ */

/** Vue Mongo minimale requise pour le pack portable (structurel — évite d'importer plus de types). */
interface PortableCourseDoc {
  _id: { toString(): string };
  title: string;
  locale: Locale;
  marketing?: unknown;
}
interface PortableSectionDoc {
  _id: { toString(): string };
  order: number;
  title: string;
}

/**
 * Construit le site HTML statique autonome (page d'accueil + une page par
 * leçon) puis l'empaquette en ZIP avec tous les assets copiés localement
 * (vidéos/sous-titres réels — pas de presigned URL qui expire). Utilisable
 * depuis file:// (clé USB) : aucun fetch(), quiz en JS pur, progression en
 * localStorage. Réutilise archiver comme le pack ZIP historique (assemblé dans
 * un PassThrough ; uploadObject bufferise le flux avant PutObject, cf. storage.ts).
 */
async function buildPortablePack(
  courseId: string,
  course: PortableCourseDoc,
  sections: readonly PortableSectionDoc[],
  lessons: readonly ILesson[],
  quizzes: readonly { sectionId: { toString(): string }; questions: QuizQuestion[] }[],
): Promise<PackagingResult> {
  const locale: Locale = course.locale;
  const zipKey = storageKeys.course(courseId).exportFile(PORTABLE_PACK_FILENAME);
  const description = marketingDescription(course.marketing);

  const lessonsBySection = new Map<string, ILesson[]>();
  for (const lesson of lessons) {
    const sid = lesson.sectionId.toString();
    const bucket = lessonsBySection.get(sid) ?? [];
    bucket.push(lesson);
    lessonsBySection.set(sid, bucket);
  }
  const quizBySection = new Map<string, QuizQuestion[]>();
  for (const quiz of quizzes) {
    const sid = quiz.sectionId.toString();
    const bucket = quizBySection.get(sid) ?? [];
    bucket.push(...quiz.questions);
    quizBySection.set(sid, bucket);
  }

  const archive = archiver('zip', { zlib: { level: 9 } });
  const passthrough = new PassThrough();
  archive.on('warning', (err) => logger.warn({ courseId, err }, 'avertissement archiver (portable)'));
  archive.on('error', (err) => passthrough.destroy(err));
  archive.pipe(passthrough);
  const uploadPromise = uploadObject(zipKey, passthrough, 'application/zip');

  let mediaLessons = 0;

  try {
    await report(courseId, 15, 'Construction du site portable — collecte des leçons');

    // Vue structurée section → leçons (pour la page d'accueil ET les pages leçon).
    const portableSections: PortableSectionInput[] = [];

    for (const section of sections) {
      const sid = section._id.toString();
      const sectionDir = sectionDirName(section);
      const sectionLessons = lessonsBySection.get(sid) ?? [];
      const sectionQuiz = quizBySection.get(sid) ?? [];
      const portableLessons: PortableLessonInput[] = [];

      for (const lesson of sectionLessons) {
        const keys = storageKeys.course(courseId).lesson(section.order, lesson.order);
        // Quiz de section rattaché à la première leçon vidéo/article de la section
        // (le quiz Udemy est par section, pas par leçon) — évite la duplication
        // du quiz sur chaque leçon de la section.
        const isFirstLessonOfSection = portableLessons.length === 0;
        const quizForLesson = isFirstLessonOfSection && sectionQuiz.length > 0 ? sectionQuiz : undefined;

        if (lesson.type === 'video') {
          const videoKey = keys.video();
          if (await objectExists(videoKey)) {
            const videoFileName = 'video.mp4';
            const lessonEntry: PortableLessonInput = {
              order: lesson.order,
              title: lesson.title,
              type: 'video',
              videoFileName,
              durationMin: lesson.durationMin,
              summary: lesson.summary,
              quiz: quizForLesson,
            };
            const srtKey = keys.captionsSrt();
            // Sous-titres embarqués au format WebVTT (natif <track>, pas de SRT dans <video>).
            const vttKey = keys.captionsVtt();
            if (await objectExists(vttKey)) {
              lessonEntry.captionsFileName = 'captions.vtt';
              archive.append((await getObjectStream(vttKey)) as Readable, {
                name: `${sectionDir}/captions.vtt`,
              });
            } else if (await objectExists(srtKey)) {
              // Repli SRT si aucun VTT n'a été généré (moins standard mais lu par certains navigateurs).
              lessonEntry.captionsFileName = 'captions.srt';
              archive.append((await getObjectStream(srtKey)) as Readable, {
                name: `${sectionDir}/captions.srt`,
              });
            }
            archive.append((await getObjectStream(videoKey)) as Readable, {
              name: `${sectionDir}/${videoFileName}`,
            });
            portableLessons.push(lessonEntry);
            mediaLessons += 1;
          }
        } else if (lesson.type === 'article') {
          const mdKey = lesson.assets?.articleMd ?? keys.article();
          const markdown = await readTextObject(mdKey);
          if (markdown) {
            portableLessons.push({
              order: lesson.order,
              title: lesson.title,
              type: 'article',
              articleMarkdown: markdown,
              durationMin: lesson.durationMin,
              summary: lesson.summary,
              quiz: quizForLesson,
            });
            mediaLessons += 1;
          }
        }
      }

      if (portableLessons.length > 0) {
        portableSections.push({ order: section.order, title: section.title, lessons: portableLessons });
      }
    }

    await report(courseId, 60, 'Rendu des pages HTML du site portable');
    const portableCourse: PortableCourseInput = {
      courseId,
      title: course.title,
      description,
      locale,
      sections: portableSections,
    };

    archive.append(portableHomeHtml(portableCourse), { name: 'index.html' });
    for (const section of portableSections) {
      const sectionDir = sectionDirName(section);
      for (const lesson of section.lessons) {
        const html = portableLessonHtml({ course: portableCourse, section, lesson });
        archive.append(html, { name: `${sectionDir}/${lessonFileName(lesson)}` });
      }
    }

    await report(courseId, 90, 'Finalisation de l’archive portable');
    await archive.finalize();
    await uploadPromise;

    await report(courseId, 100, `Site portable prêt : ${mediaLessons} leçon(s)`);
    logger.info({ courseId, zipKey, lessons: mediaLessons }, 'pack portable construit');
    return { courseId, zipKey, lessons: mediaLessons, quizzes: quizBySection.size };
  } catch (err) {
    archive.abort();
    passthrough.destroy();
    await uploadPromise.catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ courseId, err }, 'échec du packaging portable');
    await report(courseId, 0, `Échec du site portable : ${message}`, 'error').catch(() => undefined);
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Mode manual-guide (Prompt 176) : pack d'aide au téléversement manuel */
/* ------------------------------------------------------------------ */

/** Extrait les blocs marketing/plan à copier-coller depuis un Course (Mixed). */
function manualMarketing(course: {
  outline?: unknown;
  marketing?: unknown;
}): ManualGuideInput['marketing'] {
  const outline = (course.outline ?? null) as
    | {
        subtitle?: unknown;
        description?: unknown;
        learningObjectives?: unknown;
        prerequisites?: unknown;
        targetAudience?: unknown;
      }
    | null;
  const content = (course.marketing as { content?: Record<string, unknown> } | null | undefined)?.content;

  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v : undefined;
  const strArr = (v: unknown): string[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const items = v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    return items.length > 0 ? items : undefined;
  };
  const titleIdeas = Array.isArray(content?.titleIdeas)
    ? (content!.titleIdeas as unknown[])
        .map((t) => (t as { title?: unknown })?.title)
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    : undefined;

  return {
    subtitle: str(outline?.subtitle),
    description: str(outline?.description),
    udemyDescription: str(content?.udemyDescription),
    welcomeMessage: str(content?.welcomeMessage),
    congratsMessage: str(content?.congratsMessage),
    promoText: str(content?.promoText),
    learningObjectives: strArr(outline?.learningObjectives),
    prerequisites: strArr(outline?.prerequisites),
    targetAudience: strArr(outline?.targetAudience),
    titleIdeas: titleIdeas && titleIdeas.length > 0 ? titleIdeas : undefined,
  };
}

/** Rend le guide HTML (variante impression) en PDF ; PDF minimal en mode mock. */
async function renderManualGuidePdf(html: string, courseTitle: string): Promise<Buffer> {
  if (getConfig().MOCK_PROVIDERS) {
    return Buffer.from(`%PDF-1.4\n% [mock] guide manuel\n% ${courseTitle}\n%%EOF\n`, 'utf-8');
  }
  const browser = await getSlideBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Construit le pack « guide manuel » pour une plateforme donnée : guide.html
 * interactif (checklist + boutons copier), guide.pdf (même contenu figé),
 * README, blocs de texte à copier (textes-a-copier/), articles en HTML
 * (content/articles/), quiz au format CSV (content/quiz/) et un inventaire des
 * vidéos à téléverser (content/inventaire.txt). Les vidéos elles-mêmes ne sont
 * PAS embarquées (volumineuses — disponibles dans le pack standard). ZIP streamé
 * vers courses/{id}/exports/course-manual-guide-{platform}.zip.
 */
async function buildManualGuidePack(
  courseId: string,
  course: PortableCourseDoc & { outline?: unknown; marketing?: unknown },
  sections: readonly PortableSectionDoc[],
  lessons: readonly ILesson[],
  quizzes: readonly { sectionId: { toString(): string }; questions: QuizQuestion[] }[],
  platform: string,
  resume?: { lessonIndex: number; step: string },
): Promise<PackagingResult> {
  const locale: Locale = course.locale;
  const fmt = manualPlatformFormat(platform);
  // Guide de reprise (P179) : nom de fichier distinct pour ne pas écraser le
  // guide complet (P176) éventuellement déjà produit pour cette plateforme.
  const zipKey = storageKeys.course(courseId).exportFile(manualGuidePackFileName(platform, Boolean(resume)));

  const lessonsBySection = new Map<string, ILesson[]>();
  for (const lesson of lessons) {
    const sid = lesson.sectionId.toString();
    const bucket = lessonsBySection.get(sid) ?? [];
    bucket.push(lesson);
    lessonsBySection.set(sid, bucket);
  }
  const quizBySection = new Map<string, QuizQuestion[]>();
  for (const quiz of quizzes) {
    const sid = quiz.sectionId.toString();
    const bucket = quizBySection.get(sid) ?? [];
    bucket.push(...quiz.questions);
    quizBySection.set(sid, bucket);
  }

  const archive = archiver('zip', { zlib: { level: 9 } });
  const passthrough = new PassThrough();
  archive.on('warning', (err) => logger.warn({ courseId, err }, 'avertissement archiver (manual-guide)'));
  archive.on('error', (err) => passthrough.destroy(err));
  archive.pipe(passthrough);
  const uploadPromise = uploadObject(zipKey, passthrough, 'application/zip');

  let articleCount = 0;
  let quizCount = 0;

  try {
    await report(courseId, 15, `Construction du guide manuel — ${fmt.label}`);

    // ── Contenu (articles HTML + quiz CSV) + descripteur de structure ──
    const guideSections: ManualGuideSection[] = [];

    for (const section of sections) {
      const sid = section._id.toString();
      const sectionDir = sectionDirName(section);
      const sectionLessons = lessonsBySection.get(sid) ?? [];
      const guideLessons: ManualGuideLesson[] = [];

      for (const lesson of sectionLessons) {
        const base = orderedName(lesson.order, lesson.title);
        const keys = storageKeys.course(courseId).lesson(section.order, lesson.order);

        if (lesson.type === 'video') {
          guideLessons.push({
            order: lesson.order,
            title: lesson.title,
            type: 'video',
            durationMin: lesson.durationMin,
            videoRef: `${sectionDir}/${base}.mp4`,
          });
        } else if (lesson.type === 'article') {
          const mdKey = lesson.assets?.articleMd ?? keys.article();
          const markdown = await readTextObject(mdKey);
          if (markdown) {
            const fileName = `${base}.html`;
            const doc = articleHtmlDocument(lesson.title, markdownToHtml(markdown), locale);
            archive.append(doc, { name: `content/articles/${fileName}` });
            articleCount += 1;
            guideLessons.push({
              order: lesson.order,
              title: lesson.title,
              type: 'article',
              durationMin: lesson.durationMin,
              articleFile: fileName,
            });
          }
        }
      }

      const sectionQuiz = quizBySection.get(sid) ?? [];
      let quizCsvFile: string | undefined;
      if (sectionQuiz.length > 0) {
        quizCsvFile = `${orderedName(section.order, section.title)}.csv`;
        archive.append(quizToUdemyCsv(sectionQuiz), { name: `content/quiz/${quizCsvFile}` });
        quizCount += 1;
      }

      guideSections.push({
        order: section.order,
        title: section.title,
        lessons: guideLessons,
        quizCsvFile,
      });
    }

    // ── Assemble l'input pur du guide ────────────────────────────────
    const guideInput: ManualGuideInput = {
      platform: fmt.platform,
      courseTitle: course.title,
      courseId,
      locale,
      sections: guideSections,
      marketing: manualMarketing(course),
      // Reprise (P179) : n'énumère que les étapes restantes à partir du checkpoint.
      resume: resume ? { checkpoint: resume } : undefined,
    };

    await report(courseId, 55, 'Rendu du guide (HTML + PDF)');
    const interactiveHtml = buildGuideHtml(guideInput, { interactive: true });
    archive.append(interactiveHtml, { name: 'guide.html' });

    // PDF : variante d'impression (script/boutons retirés) — best-effort.
    try {
      const printHtml = buildGuideHtml(guideInput, { interactive: false });
      const pdf = await renderManualGuidePdf(printHtml, course.title);
      archive.append(pdf, { name: 'guide.pdf' });
    } catch (err) {
      logger.warn({ courseId, err }, 'rendu du guide PDF impossible — omis du pack');
      await report(courseId, 55, 'Guide PDF ignoré (rendu impossible)', 'warn');
    }

    // ── Blocs de texte à copier (fichiers .txt) + README + inventaire ─
    await report(courseId, 80, 'Ajout des blocs de texte et du README');
    for (const block of buildCopyBlocks(guideInput)) {
      archive.append(block.text, { name: `textes-a-copier/${block.id}.txt` });
    }
    archive.append(buildVideoInventory(guideInput), { name: 'content/inventaire.txt' });
    archive.append(buildReadme(guideInput), { name: 'README.txt' });

    await report(courseId, 90, 'Finalisation du guide manuel');
    await archive.finalize();
    await uploadPromise;

    await report(
      courseId,
      100,
      `Guide manuel prêt (${fmt.label}) : ${articleCount} article(s), ${quizCount} quiz`,
    );
    logger.info(
      { courseId, zipKey, platform: fmt.platform, articles: articleCount, quizzes: quizCount },
      'pack guide manuel construit',
    );
    return { courseId, zipKey, lessons: articleCount, quizzes: quizCount };
  } catch (err) {
    archive.abort();
    passthrough.destroy();
    await uploadPromise.catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ courseId, err }, 'échec du packaging guide manuel');
    await report(courseId, 0, `Échec du guide manuel : ${message}`, 'error').catch(() => undefined);
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Mode archive (Prompt 182) : archive « maître » anti-lock-in         */
/* ------------------------------------------------------------------ */

/**
 * Construit l'archive maître RE-IMPORTABLE d'un cours : toutes les sources JSON
 * (course/sections/lessons AVEC le champ script/quizzes) + un manifeste + un
 * README documenté + TOUS les médias sous media/. Les médias sont énumérés via
 * listObjectKeys(courses/{id}/) (en excluant le sous-dossier exports/ pour ne
 * jamais empaqueter les exports précédents, dont cette archive elle-même) puis
 * lus depuis S3 (getObjectStream) et poussés dans l'archive. NB : uploadObject
 * matérialise le ZIP final en Buffer avant PutObject (pas de streaming multipart
 * sans @aws-sdk/lib-storage, cf. storage.ts). La sérialisation JSON est celle du
 * schéma zod partagé (serializeMasterArchiveFiles),
 * source unique avec le re-import côté web (lib/import-archive.ts).
 */
async function buildMasterArchive(
  courseId: string,
  course: MasterArchiveCourseDoc,
  sections: readonly MasterArchiveSectionDoc[],
  lessons: readonly (ILesson & { _id: { toString(): string } })[],
  quizzes: readonly MasterArchiveQuizDoc[],
): Promise<PackagingResult> {
  const zipKey = storageKeys.course(courseId).exportFile(MASTER_ARCHIVE_FILENAME);
  const exportedAt = new Date().toISOString();

  const sectionOrderById = new Map(sections.map((s) => [s._id.toString(), s.order]));
  const lessonOrderById = new Map(lessons.map((l) => [l._id.toString(), l.order]));

  const archiveCourse = buildMasterArchiveCourse(course);
  const archiveSections = buildMasterArchiveSections(sections);
  const archiveLessons = buildMasterArchiveLessons(lessons, sectionOrderById);
  const archiveQuizzes = buildMasterArchiveQuizzes(quizzes, sectionOrderById, lessonOrderById);

  const archive = archiver('zip', { zlib: { level: 9 } });
  const passthrough = new PassThrough();
  archive.on('warning', (err) => logger.warn({ courseId, err }, 'avertissement archiver (archive)'));
  archive.on('error', (err) => passthrough.destroy(err));
  archive.pipe(passthrough);
  const uploadPromise = uploadObject(zipKey, passthrough, 'application/zip');

  const media: MasterArchiveMediaEntry[] = [];

  try {
    await report(courseId, 10, 'Archive maître — inventaire des médias');

    // Tous les objets du cours SAUF le sous-dossier des exports (évite de
    // ré-empaqueter les packs/exports antérieurs, dont cette archive).
    const coursePrefix = storageKeys.course(courseId).prefix;
    const exportsPrefix = `${coursePrefix}/exports/`;
    const allKeys = await listObjectKeys(`${coursePrefix}/`);
    const mediaKeys = allKeys.filter((key) => !key.startsWith(exportsPrefix));

    await report(courseId, 25, `Ajout des médias (${mediaKeys.length})`);
    for (const key of mediaKeys) {
      const subKey = masterArchiveSubKey(key, courseId);
      if (!subKey) continue;
      const path = mediaArchivePath(subKey);
      archive.append((await getObjectStream(key)) as Readable, { name: path });
      media.push({ subKey, path });
    }

    await report(courseId, 75, 'Écriture des sources JSON et du manifeste');
    const manifest = buildMasterArchiveManifest({
      courseId,
      exportedAt,
      sections: archiveSections,
      lessons: archiveLessons,
      quizzes: archiveQuizzes,
      media,
    });
    const archiveObject: MasterArchive = {
      manifest,
      course: archiveCourse,
      sections: archiveSections,
      lessons: archiveLessons,
      quizzes: archiveQuizzes,
    };

    const files = serializeMasterArchiveFiles(archiveObject);
    for (const [name, content] of Object.entries(files)) {
      archive.append(content, { name });
    }
    archive.append(masterArchiveReadme(archiveObject), { name: MASTER_ARCHIVE_FILENAMES.readme });

    await report(courseId, 90, 'Finalisation de l’archive maître');
    await archive.finalize();
    await uploadPromise;

    await report(
      courseId,
      100,
      `Archive maître prête : ${archiveLessons.length} leçon(s), ${media.length} média(s)`,
    );
    logger.info(
      { courseId, zipKey, lessons: archiveLessons.length, media: media.length },
      'archive maître construite',
    );
    return { courseId, zipKey, lessons: archiveLessons.length, quizzes: archiveQuizzes.length };
  } catch (err) {
    archive.abort();
    passthrough.destroy();
    await uploadPromise.catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ courseId, err }, 'échec de l’archive maître');
    await report(courseId, 0, `Échec de l’archive maître : ${message}`, 'error').catch(() => undefined);
    throw err;
  }
}
