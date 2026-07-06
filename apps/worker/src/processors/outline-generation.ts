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
  outlineSchema,
  publishProgress,
  type Outline,
  type OutlineJobData,
} from '../shared.js';
import { getRedisConnection } from '../queues/connection.js';
import { logger } from '../queues/index.js';
import { callClaudeJson } from '../lib/claude.js';
import { outlineSystemPrompt, outlineUserPrompt } from '../prompts/outline.js';

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

/** Processor de la queue outline-generation. */
export async function processOutlineGeneration(job: Job<OutlineJobData>): Promise<OutlineResult> {
  const { courseId } = job.data;

  try {
    await report(courseId, 5, 'Chargement du cours');
    const course = await Course.findById(courseId);
    if (!course) throw new Error(`cours introuvable : ${courseId}`);

    course.status = 'generating';
    await course.save();

    const baseUser = outlineUserPrompt({
      title: course.title,
      difficulty: course.difficulty,
      locale: course.locale,
    });
    const system = outlineSystemPrompt();

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
