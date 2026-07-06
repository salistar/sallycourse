// Dispatcher BullMQ « content-generation » : route chaque leçon vers son
// générateur selon lesson.type, publie la progression et gère les statuts
// Lesson (generating → ready | failed). Chaque prompt de génération ajoute
// sa branche au switch ci-dessous. Quand la DERNIÈRE leçon passe 'ready',
// le dispatcher génère la landing marketing puis bascule Course.status='ready'.
import type { Job } from 'bullmq';
import { Course, Lesson, QUEUES, publishProgress, type ContentJobData } from '../shared.js';
import { getRedisConnection } from '../queues/connection.js';
import { logger } from '../queues/index.js';
import { generateVideoScript } from '../generators/video-script.js';
import { generateArticle } from '../generators/article.js';
import { generateQuiz } from '../generators/quiz.js';
import { generateTp } from '../generators/tp.js';
import { generateCourseMarketing } from '../generators/marketing.js';

export interface ContentGenerationResult {
  courseId: string;
  lessonId: string;
  type: string;
}

/** Publie la progression du step content-generation (best-effort). */
async function report(
  courseId: string,
  progress: number,
  message: string,
  level: 'info' | 'warn' | 'error' = 'info',
): Promise<void> {
  try {
    await publishProgress(getRedisConnection(), {
      courseId,
      step: QUEUES.content,
      progress,
      message,
      level,
      ts: Date.now(),
    });
  } catch (err) {
    logger.warn({ courseId, err }, 'publication de progression impossible');
  }
}

/**
 * Étape finale du pipeline de contenu : si toutes les leçons du cours sont
 * 'ready', génère la landing marketing (Prompt 28) PUIS passe le cours à
 * 'ready'. Le claim atomique sur Course.marketing garantit qu'un seul job
 * (concurrency > 1) exécute l'étape, même si plusieurs leçons finissent en
 * même temps. Ne jette jamais : un échec marketing marque le cours 'failed'
 * et libère le claim, sans invalider la leçon qui vient d'aboutir.
 */
async function finalizeCourseIfComplete(courseId: string): Promise<void> {
  const remaining = await Lesson.countDocuments({ courseId, status: { $ne: 'ready' } });
  if (remaining > 0) return;

  // Claim atomique : { marketing: null } matche aussi le champ absent.
  const claimed = await Course.findOneAndUpdate(
    { _id: courseId, status: { $nin: ['ready', 'published'] }, marketing: null },
    { $set: { marketing: { status: 'generating', startedAt: new Date() } } },
  );
  if (!claimed) return;

  try {
    await report(courseId, 95, 'Toutes les leçons sont prêtes — génération de la landing marketing');
    const marketing = await generateCourseMarketing({ courseId });
    await Course.updateOne({ _id: courseId }, { $set: { status: 'ready' } });
    await report(
      courseId,
      100,
      `Cours prêt : contenu complet + marketing (${marketing.titleIdeas} idées de titres, cover + miniature uploadées)`,
    );
    logger.info({ ...marketing }, 'cours finalisé : marketing généré, status=ready');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ courseId, err }, 'échec de la finalisation marketing du cours');
    // Libère le claim (une relance pourra retenter) et marque le cours en échec.
    await Course.updateOne(
      { _id: courseId },
      { $set: { status: 'failed', marketing: null } },
    ).catch(() => undefined);
    await report(courseId, 0, `Échec de la landing marketing : ${message}`, 'error').catch(() => undefined);
  }
}

/** Processor de la queue content-generation (un job = une leçon). */
export async function processContentGeneration(job: Job<ContentJobData>): Promise<ContentGenerationResult> {
  const { courseId, lessonId } = job.data;

  const lesson = await Lesson.findById(lessonId);
  if (!lesson) throw new Error(`leçon introuvable : ${lessonId}`);

  try {
    await Lesson.updateOne({ _id: lessonId }, { $set: { status: 'generating' } });
    await report(courseId, 10, `Génération du contenu « ${lesson.title} » (${lesson.type})`);

    switch (lesson.type) {
      case 'video':
        await generateVideoScript({ courseId, lessonId });
        break;
      case 'article':
        await generateArticle({ courseId, lessonId });
        break;
      case 'quiz':
        await generateQuiz({ courseId, lessonId });
        break;
      case 'tp':
        await generateTp({ courseId, lessonId });
        break;
      default:
        throw new Error(`aucun générateur enregistré pour le type de leçon « ${lesson.type} »`);
    }

    // Filet de sécurité : le générateur pose normalement 'ready' lui-même.
    await Lesson.updateOne({ _id: lessonId, status: { $ne: 'ready' } }, { $set: { status: 'ready' } });
    await report(courseId, 100, `Contenu prêt : « ${lesson.title} »`);

    // Dernière leçon prête → marketing + bascule Course.status='ready' (n'échoue jamais la leçon).
    await finalizeCourseIfComplete(courseId);
    return { courseId, lessonId, type: lesson.type };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ courseId, lessonId, err }, 'échec de la génération de contenu');
    await Lesson.updateOne({ _id: lessonId }, { $set: { status: 'failed' } }).catch(() => undefined);
    await report(courseId, 0, `Échec (« ${lesson.title} ») : ${message}`, 'error').catch(() => undefined);
    throw err;
  }
}
