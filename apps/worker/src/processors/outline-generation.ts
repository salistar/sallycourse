// Processor BullMQ « outline-generation » : génère le plan de cours via Claude,
// applique les validations métier Udemy, puis persiste Course/Section/Lesson
// (transaction si le déploiement Mongo la supporte, séquentiel sinon).
import type { Job } from 'bullmq';
import mongoose from 'mongoose';
import {
  Course,
  GenerationJob,
  Lesson,
  QUEUES,
  Section,
  UDEMY,
  buildSourceMaterialContext,
  chunkText,
  defaultJobOptions,
  getObjectStream,
  makeJobId,
  outlineSchema,
  publishProgress,
  type Difficulty,
  type Locale,
  type Outline,
  type OutlineJobData,
  type SourceMaterialFile,
} from '../shared.js';
import { extractSourceMaterialText } from '../lib/rag-extract.js';
import { getRedisConnection } from '../queues/connection.js';
import { createQueue, logger } from '../queues/index.js';
import { priorityForPlan } from '../queues/priority.js';
import { planForCourse } from '../queues/plan-lookup.js';
import { callClaudeJson } from '../lib/claude.js';
import { getActivePrompt } from '../lib/prompt-registry.js';
import { outlineSystemPrompt, outlineUserPrompt } from '../prompts/outline.js';
import { LESSON_CONTENT_JOB } from './content-generation.js';
import {
  derivedCourseTitle,
  planDerivation,
  translateOutlineSystemPrompt,
  translateOutlineUserPrompt,
  validateTranslationStructure,
} from '../lib/derive.js';

/** Tentatives de génération quand les validations MÉTIER échouent (schéma OK). */
const MAX_BUSINESS_ATTEMPTS = 3;
/** Le plan complet est volumineux : budget de sortie large mais non-streaming. */
const OUTLINE_MAX_TOKENS = 8192;

export interface OutlineResult {
  courseId: string;
  sections: number;
  lessons: number;
}

/**
 * Validations métier au-delà du schéma Zod : nombre de sections, minutes de
 * vidéo, un quiz en fin de chaque section, longueurs Udemy. Retourne la liste
 * des problèmes (vide si conforme) — réinjectée au LLM en cas d'échec.
 */
export function validateOutlineBusiness(outline: Outline): string[] {
  const problems: string[] = [];

  if (outline.sections.length < UDEMY.MIN_SECTIONS) {
    problems.push(
      `Le plan compte ${outline.sections.length} sections — il en faut au moins ${UDEMY.MIN_SECTIONS}.`,
    );
  }

  const videoMinutes = outline.sections
    .flatMap((s) => s.lessons)
    .filter((l) => l.type === 'video')
    .reduce((acc, l) => acc + l.durationMin, 0);
  if (videoMinutes < UDEMY.MIN_TOTAL_VIDEO_MINUTES) {
    problems.push(
      `Le total vidéo est de ${videoMinutes} min — il faut au moins ${UDEMY.MIN_TOTAL_VIDEO_MINUTES} min.`,
    );
  }

  outline.sections.forEach((section, index) => {
    const quizzes = section.lessons.filter((l) => l.type === 'quiz');
    const last = section.lessons[section.lessons.length - 1];
    if (quizzes.length !== 1) {
      problems.push(
        `La section ${index + 1} (« ${section.title} ») contient ${quizzes.length} quiz — il en faut exactement 1.`,
      );
    } else if (last?.type !== 'quiz') {
      problems.push(
        `Le quiz de la section ${index + 1} (« ${section.title} ») doit être la DERNIÈRE leçon de la section.`,
      );
    }
  });

  if (outline.title.length > UDEMY.TITLE_MAX_CHARS) {
    problems.push(`Le titre dépasse ${UDEMY.TITLE_MAX_CHARS} caractères (${outline.title.length}).`);
  }
  if (outline.subtitle.length > UDEMY.SUBTITLE_MAX_CHARS) {
    problems.push(`Le sous-titre dépasse ${UDEMY.SUBTITLE_MAX_CHARS} caractères (${outline.subtitle.length}).`);
  }

  return problems;
}

/** Publie la progression (Redis pub/sub) + met à jour le GenerationJob (upsert). */
async function report(
  courseId: string,
  progress: number,
  message: string,
  level: 'info' | 'warn' | 'error' = 'info',
): Promise<void> {
  try {
    await publishProgress(getRedisConnection(), {
      courseId,
      step: QUEUES.outline,
      progress,
      message,
      level,
      ts: Date.now(),
    });
  } catch (err) {
    logger.warn({ courseId, err }, 'publication de progression impossible');
  }
  try {
    await GenerationJob.updateOne(
      { courseId, step: QUEUES.outline },
      {
        $set: { progress },
        $push: { logs: { ts: new Date(), level, msg: message } },
        ...(level === 'error' ? {} : { $unset: { error: '' } }),
      },
      { upsert: true },
    );
  } catch (err) {
    logger.warn({ courseId, err }, 'mise à jour GenerationJob impossible');
  }
}

/**
 * Écrit le résultat : Course.outline + status 'outline-review', purge puis
 * recréation des Section/Lesson (idempotent en cas de retry BullMQ).
 * Transaction Mongo si disponible (replica set), séquentiel sinon.
 */
async function persistOutline(courseId: string, outline: Outline): Promise<{ sections: number; lessons: number }> {
  const writes = async (session?: mongoose.ClientSession): Promise<{ sections: number; lessons: number }> => {
    const opts = session ? { session } : {};

    await Course.updateOne(
      { _id: courseId },
      { $set: { outline, status: 'outline-review' } },
      opts,
    );

    // Idempotence : un retry ne doit pas dupliquer sections/leçons.
    await Lesson.deleteMany({ courseId }, opts);
    await Section.deleteMany({ courseId }, opts);

    let lessonCount = 0;
    for (const [sectionOrder, section] of outline.sections.entries()) {
      const [created] = await Section.create([{ courseId, order: sectionOrder, title: section.title }], opts);
      if (!created) throw new Error(`création de la section ${sectionOrder} échouée`);
      await Lesson.create(
        section.lessons.map((lesson, lessonOrder) => ({
          sectionId: created._id,
          courseId,
          order: lessonOrder,
          title: lesson.title,
          type: lesson.type,
          durationMin: lesson.durationMin,
          summary: lesson.summary,
          status: 'pending',
        })),
        opts,
      );
      lessonCount += section.lessons.length;
    }
    return { sections: outline.sections.length, lessons: lessonCount };
  };

  const session = await mongoose.startSession();
  try {
    let result: { sections: number; lessons: number } | undefined;
    await session.withTransaction(async () => {
      result = await writes(session);
    });
    if (!result) throw new Error('transaction outline sans résultat');
    return result;
  } catch (err) {
    // Mongo standalone (dev local) : transactions indisponibles → écriture séquentielle.
    const message = err instanceof Error ? err.message : String(err);
    if (/Transaction numbers|replica set|IllegalOperation/i.test(message)) {
      logger.warn({ courseId }, 'transactions Mongo indisponibles — écriture séquentielle');
      return writes();
    }
    throw err;
  } finally {
    await session.endSession();
  }
}

/** Tentatives de traduction quand la structure de l'outline traduit diverge. */
const MAX_TRANSLATION_ATTEMPTS = 3;

/**
 * Dérivation (P64) : réutilise l'outline du cours source, le traduit si la
 * langue change (avec vérification de fidélité structurelle et retry), sinon
 * le recopie tel quel (simple changement de niveau — le contenu sera régénéré
 * au niveau cible par le pipeline de contenu habituel).
 */
async function buildDerivedOutline(params: {
  courseId: string;
  sourceCourseId: string;
  targetLocale: Locale;
  targetDifficulty: Difficulty;
  userId: string;
}): Promise<Outline> {
  const source = await Course.findById(params.sourceCourseId).lean();
  if (!source) throw new Error(`cours source introuvable : ${params.sourceCourseId}`);

  const sourceOutline = outlineSchema.safeParse(source.outline);
  if (!sourceOutline.success) {
    throw new Error(`le cours source n'a pas d'outline valide : ${params.sourceCourseId}`);
  }

  const plan = planDerivation({
    sourceLocale: source.locale,
    sourceDifficulty: source.difficulty,
    targetLocale: params.targetLocale,
    targetDifficulty: params.targetDifficulty,
  });
  if (!plan.ok) {
    // Ne devrait pas arriver (la route API l'a déjà vérifié) — garde défensive.
    return sourceOutline.data;
  }

  if (!plan.spec.translate) {
    return sourceOutline.data;
  }

  // ── Traduction avec retry sur fidélité structurelle ──
  const system = translateOutlineSystemPrompt();
  const baseUser = translateOutlineUserPrompt(sourceOutline.data, plan.spec.targetLocale);
  let feedback: string[] = [];
  for (let attempt = 1; attempt <= MAX_TRANSLATION_ATTEMPTS; attempt++) {
    await report(
      params.courseId,
      10 + attempt * 10,
      attempt === 1 ? 'Traduction du plan source' : `Correction de la traduction (tentative ${attempt})`,
      attempt === 1 ? 'info' : 'warn',
    );

    const user =
      feedback.length === 0
        ? baseUser
        : `${baseUser}\n\nTa précédente traduction a modifié la structure — corrige impérativement :\n${feedback
            .map((p) => `- ${p}`)
            .join('\n')}`;

    const candidate = await callClaudeJson({
      schema: outlineSchema,
      system,
      user,
      maxTokens: OUTLINE_MAX_TOKENS,
      cost: { courseId: params.courseId, userId: params.userId },
    });

    feedback = validateTranslationStructure(sourceOutline.data, candidate);
    if (feedback.length === 0) return candidate;
    logger.warn({ courseId: params.courseId, attempt, problems: feedback }, 'traduction non fidèle à la structure source');
  }

  throw new Error(
    `traduction non conforme après ${MAX_TRANSLATION_ATTEMPTS} tentatives :\n${feedback.join('\n')}`,
  );
}

/**
 * Après une dérivation, on saute la revue manuelle du plan (déjà validé sur le
 * cours source) : le cours passe directement en génération et le job de la
 * première leçon est enfilé, comme le fait approve-outline pour un cours normal.
 */
async function enqueueFirstLessonAfterDerive(courseId: string): Promise<void> {
  const firstSection = await Section.findOne({ courseId }).sort({ order: 1 }).lean();
  if (!firstSection) return;
  const firstLesson = await Lesson.findOne({ courseId, sectionId: firstSection._id })
    .sort({ order: 1 })
    .lean();
  if (!firstLesson) return;

  await GenerationJob.findOneAndUpdate(
    { courseId },
    { $set: { step: QUEUES.content, progress: 0 }, $unset: { error: '' } },
    { upsert: true },
  );

  const queue = createQueue(QUEUES.content);
  const lessonId = firstLesson._id.toString();
  const jobId = makeJobId(courseId, QUEUES.content, lessonId);
  await queue.remove(jobId).catch(() => undefined);
  // Priorité (P73) selon le plan du propriétaire du cours dérivé.
  const priority = priorityForPlan(await planForCourse(courseId));
  await queue.add(LESSON_CONTENT_JOB, { courseId, lessonId }, { ...defaultJobOptions, jobId, priority });

  await Course.updateOne({ _id: courseId }, { $set: { status: 'generating' } });
}

/** Nombre max d'octets lus par fichier source pour l'extraction (garde-fou mémoire). */
const SOURCE_MATERIAL_MAX_BYTES = 25 * 1024 * 1024;

/** Concatène les chunks de tous les buffers d'un flux Node lisible en un Buffer unique. */
async function readStreamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > SOURCE_MATERIAL_MAX_BYTES) break;
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/**
 * Import de contenu existant (Prompt 90, RAG simple) : si le cours a du
 * matériel source (Course.sourceMaterialFiles, uploadé via
 * /api/courses/[id]/import-material), télécharge chaque fichier depuis S3,
 * extrait son texte (PDF/PPTX/Markdown, avec repli dégradé si les libs
 * d'extraction riches sont absentes) puis chunke et assemble le contexte à
 * injecter dans le prompt système. Best-effort : une erreur sur un fichier
 * n'interrompt pas la génération (log + fichier ignoré).
 */
async function loadSourceMaterialContext(courseId: string, files: SourceMaterialFile[]): Promise<string> {
  const allChunks: string[] = [];
  for (const file of files) {
    try {
      const stream = await getObjectStream(file.key);
      const buffer = await readStreamToBuffer(stream);
      const { text, mode, warning } = await extractSourceMaterialText(buffer, file.kind);
      if (warning) logger.warn({ courseId, file: file.fileName, mode }, warning);
      allChunks.push(...chunkText(text));
    } catch (err) {
      logger.warn({ courseId, file: file.fileName, err }, 'rag: extraction du support source impossible — ignoré');
    }
  }
  return buildSourceMaterialContext(allChunks);
}

/** Processor de la queue outline-generation. */
export async function processOutlineGeneration(job: Job<OutlineJobData>): Promise<OutlineResult> {
  const { courseId, derive } = job.data;

  try {
    await report(courseId, 5, 'Chargement du cours');
    const course = await Course.findById(courseId);
    if (!course) throw new Error(`cours introuvable : ${courseId}`);

    course.status = 'generating';
    await course.save();

    // ── Dérivation (P64) : réutilise/traduit l'outline source, saute la revue ──
    if (derive) {
      const source = await Course.findById(derive.sourceCourseId).select('locale difficulty').lean();
      if (!source) throw new Error(`cours source introuvable : ${derive.sourceCourseId}`);

      const outline = await buildDerivedOutline({
        courseId,
        sourceCourseId: derive.sourceCourseId,
        targetLocale: course.locale,
        targetDifficulty: course.difficulty,
        userId: String(course.userId),
      });

      const derivedTitle = derivedCourseTitle(course.title, {
        sourceLocale: source.locale,
        targetLocale: course.locale,
        sourceDifficulty: source.difficulty,
        targetDifficulty: course.difficulty,
        translate: source.locale !== course.locale,
      }, outline);
      if (derivedTitle !== course.title) {
        await Course.updateOne({ _id: courseId }, { $set: { title: derivedTitle } });
      }

      await report(courseId, 70, 'Plan dérivé — écriture des sections et leçons');
      const { sections, lessons } = await persistOutline(courseId, outline);

      await enqueueFirstLessonAfterDerive(courseId);

      await report(courseId, 100, `Plan dérivé : ${sections} sections, ${lessons} leçons`);
      return { courseId, sections, lessons };
    }

    // Import de contenu existant (P90) : contexte issu des supports source
    // uploadés (best-effort, chaîne vide si aucun fichier ou échec total).
    let sourceMaterialExcerpt = '';
    if (course.sourceMaterial && Array.isArray(course.sourceMaterialFiles) && course.sourceMaterialFiles.length > 0) {
      await report(courseId, 8, 'Lecture du matériel source fourni');
      sourceMaterialExcerpt = await loadSourceMaterialContext(
        courseId,
        course.sourceMaterialFiles as SourceMaterialFile[],
      );
    }

    const baseUser = outlineUserPrompt({
      title: course.title,
      difficulty: course.difficulty,
      locale: course.locale,
    });
    // Prompt 93 — playground admin : surcharge en base si une version est
    // active pour "outline.system", sinon comportement inchangé (fallback).
    const system = await getActivePrompt('outline.system', outlineSystemPrompt(sourceMaterialExcerpt || undefined));

    // Boucle métier : le schéma est garanti par callClaudeJson, mais les règles
    // Udemy (sections, minutes vidéo, quiz/section) peuvent nécessiter un retry
    // avec feedback explicite.
    let outline: Outline | null = null;
    let feedback: string[] = [];
    for (let attempt = 1; attempt <= MAX_BUSINESS_ATTEMPTS; attempt++) {
      await report(
        courseId,
        10 + attempt * 10,
        attempt === 1 ? 'Génération du plan par le LLM' : `Correction du plan (tentative ${attempt})`,
        attempt === 1 ? 'info' : 'warn',
      );

      const user =
        feedback.length === 0
          ? baseUser
          : `${baseUser}\n\nTa précédente proposition violait ces règles — corrige-les impérativement :\n${feedback
              .map((p) => `- ${p}`)
              .join('\n')}`;

      const candidate = await callClaudeJson({
        schema: outlineSchema,
        system,
        user,
        maxTokens: OUTLINE_MAX_TOKENS,
        cost: { courseId, userId: String(course.userId) },
      });

      feedback = validateOutlineBusiness(candidate);
      if (feedback.length === 0) {
        outline = candidate;
        break;
      }
      logger.warn({ courseId, attempt, problems: feedback }, 'plan non conforme aux règles métier');
    }

    if (!outline) {
      throw new Error(
        `plan non conforme après ${MAX_BUSINESS_ATTEMPTS} tentatives :\n${feedback.join('\n')}`,
      );
    }

    await report(courseId, 70, 'Plan validé — écriture des sections et leçons');
    const { sections, lessons } = await persistOutline(courseId, outline);

    await report(courseId, 100, `Plan généré : ${sections} sections, ${lessons} leçons`);
    return { courseId, sections, lessons };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ courseId, err }, 'échec de la génération du plan');
    // Best-effort : marque le cours et le job en échec sans masquer l'erreur d'origine.
    await Course.updateOne({ _id: courseId }, { $set: { status: 'failed' } }).catch(() => undefined);
    await GenerationJob.updateOne(
      { courseId, step: QUEUES.outline },
      {
        $set: { error: message },
        $push: { logs: { ts: new Date(), level: 'error', msg: message } },
        $inc: { attempts: 1 },
      },
      { upsert: true },
    ).catch(() => undefined);
    await report(courseId, 0, `Échec : ${message}`, 'error').catch(() => undefined);
    throw err;
  }
}
