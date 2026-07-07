// Dispatcher BullMQ « content-generation » : route chaque leçon vers son
// générateur selon lesson.type, publie la progression et gère les statuts
// Lesson (generating → ready | failed). Chaque prompt de génération ajoute
// sa branche au switch ci-dessous. Quand la DERNIÈRE leçon passe 'ready',
// le dispatcher génère la landing marketing puis bascule Course.status='ready'.
import type { Job } from 'bullmq';
import {
  Course,
  Lesson,
  QUEUES,
  Section,
  defaultJobOptions,
  makeJobId,
  publishProgress,
  type ContentJobData,
} from '../shared.js';
import { getRedisConnection } from '../queues/connection.js';
import { createQueue, logger } from '../queues/index.js';
import { generateVideoScript } from '../generators/video-script.js';
import { generateArticle } from '../generators/article.js';
import { generateQuiz } from '../generators/quiz.js';
import { generateTp } from '../generators/tp.js';
import { generateCourseMarketing } from '../generators/marketing.js';
import { runCourseQa } from '../lib/qa.js';
import { buildContinuityContext, summarizeLesson } from '../lib/continuity.js';
import { lessonContentHash } from '../deploy/updates.js';

/**
 * Nom de job du flux séquentiel « une leçon enqueue la suivante » (P19). Seuls
 * ces jobs propagent la chaîne : une régénération unitaire ('regenerate-lesson')
 * ne relance pas les leçons voisines.
 */
export const LESSON_CONTENT_JOB = 'lesson-content';

export interface ContentGenerationResult {
  courseId: string;
  lessonId: string;
  type: string;
}

/**
 * Ordre global d'une leçon dans le cours = section.order * ORDER_STRIDE +
 * lesson.order. Le stride borne le nombre de leçons par section ; largement
 * au-delà des plans réels (22 leçons / 5 sections).
 */
const ORDER_STRIDE = 1000;

/**
 * Trouve la leçon suivante du cours dans l'ordre global (section puis position)
 * et enfile son job de contenu (chaînage séquentiel P19). Best-effort : ne jette
 * jamais — une chaîne rompue est rattrapable par une régénération manuelle.
 */
export async function enqueueNextLesson(courseId: string, currentLessonId: string): Promise<string | null> {
  try {
    const current = await Lesson.findById(currentLessonId).select('sectionId order').lean();
    if (!current) return null;

    const sections = await Section.find({ courseId }).select('_id order').lean();
    const sectionOrder = new Map(sections.map((s) => [String(s._id), s.order]));
    const globalOrder = (l: { sectionId: unknown; order: number }): number =>
      (sectionOrder.get(String(l.sectionId)) ?? 0) * ORDER_STRIDE + l.order;

    const currentGlobal = globalOrder(current);
    const lessons = await Lesson.find({ courseId }).select('_id sectionId order').lean();

    // Première leçon strictement après la courante dans l'ordre global.
    const next = lessons
      .map((l) => ({ id: String(l._id), g: globalOrder(l) }))
      .filter((l) => l.g > currentGlobal)
      .sort((a, b) => a.g - b.g)[0];

    if (!next) return null;

    const queue = createQueue(QUEUES.content);
    const jobId = makeJobId(courseId, QUEUES.content, next.id);
    await queue.remove(jobId).catch(() => undefined);
    await queue.add(LESSON_CONTENT_JOB, { courseId, lessonId: next.id }, { ...defaultJobOptions, jobId });
    logger.info({ courseId, nextLessonId: next.id }, 'leçon suivante enfilée (continuité séquentielle)');
    return next.id;
  } catch (err) {
    logger.warn({ courseId, currentLessonId, err }, 'enfilage de la leçon suivante impossible');
    return null;
  }
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
export async function finalizeCourseIfComplete(courseId: string): Promise<void> {
  const remaining = await Lesson.countDocuments({ courseId, status: { $ne: 'ready' } });
  if (remaining > 0) return;

  // Claim atomique : { marketing: null } matche aussi le champ absent.
  const claimed = await Course.findOneAndUpdate(
    { _id: courseId, status: { $nin: ['ready', 'published'] }, marketing: null },
    { $set: { marketing: { status: 'generating', startedAt: new Date() } } },
  );
  if (!claimed) return;

  try {
    // 1) Contrôle qualité (P26) : bloque la publication si un garde-fou échoue.
    await report(courseId, 90, 'Toutes les leçons sont prêtes — contrôle qualité du cours');
    const qa = await runCourseQa(courseId);
    if (!qa.passed) {
      // runCourseQa a déjà posé status='failed' + qaReport. On libère le claim
      // marketing pour permettre une relance après correction.
      const issues = qa.checks.filter((c) => !c.ok).map((c) => c.detail);
      await Course.updateOne({ _id: courseId }, { $set: { marketing: null } }).catch(() => undefined);
      await report(
        courseId,
        0,
        `Contrôle qualité échoué (${issues.length} problème(s)) — publication bloquée : ${issues.join(' ')}`,
        'error',
      );
      logger.warn({ courseId, issues }, 'QA échoué : cours marqué failed, marketing non lancé');
      return;
    }

    // 2) Marketing (P28), puis bascule 'ready' confirmée après marketing.
    await report(courseId, 95, 'Contrôle qualité validé — génération de la landing marketing');
    const marketing = await generateCourseMarketing({ courseId });
    await Course.updateOne({ _id: courseId }, { $set: { status: 'ready' } });
    await report(
      courseId,
      100,
      `Cours prêt : QA validé + marketing (${marketing.titleIdeas} idées de titres, cover + miniature uploadées)`,
    );
    logger.info({ ...marketing }, 'cours finalisé : QA + marketing OK, status=ready');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ courseId, err }, 'échec de la finalisation du cours (QA/marketing)');
    // Libère le claim (une relance pourra retenter) et marque le cours en échec.
    await Course.updateOne(
      { _id: courseId },
      { $set: { status: 'failed', marketing: null } },
    ).catch(() => undefined);
    await report(courseId, 0, `Échec de la finalisation : ${message}`, 'error').catch(() => undefined);
  }
}

/** Processor de la queue content-generation (un job = une leçon). */
/**
 * Ajoute une entrée d'historique de version (P46) si l'empreinte du contenu
 * diffusable a changé depuis la dernière version enregistrée. Idempotent (une
 * régénération identique n'empile pas de doublon). Best-effort : jamais bloquant.
 */
async function recordLessonVersion(lessonId: string, note: string): Promise<void> {
  try {
    const lesson = await Lesson.findById(lessonId);
    if (!lesson) return;
    const hash = lessonContentHash(lesson);
    const versions = lesson.versions ?? [];
    const last = versions[versions.length - 1];
    if (last?.contentHash === hash) return; // pas de changement → pas de doublon
    versions.push({ contentHash: hash, createdAt: new Date(), note });
    lesson.versions = versions;
    await lesson.save();
  } catch (err) {
    logger.warn({ lessonId, err }, 'historique de version de leçon non enregistré');
  }
}

export async function processContentGeneration(job: Job<ContentJobData>): Promise<ContentGenerationResult> {
  const { courseId, lessonId } = job.data;

  const lesson = await Lesson.findById(lessonId);
  if (!lesson) throw new Error(`leçon introuvable : ${lessonId}`);

  try {
    await Lesson.updateOne({ _id: lessonId }, { $set: { status: 'generating' } });
    await report(courseId, 10, `Génération du contenu « ${lesson.title} » (${lesson.type})`);

    // Cohérence inter-leçons (P19) : contexte des leçons déjà générées (résumés),
    // injecté dans le prompt des générateurs pour éviter les répétitions.
    const context = await buildContinuityContext(courseId, lesson);

    switch (lesson.type) {
      case 'video':
        await generateVideoScript({ courseId, lessonId, context });
        break;
      case 'article':
        await generateArticle({ courseId, lessonId, context });
        break;
      case 'quiz':
        await generateQuiz({ courseId, lessonId, context });
        break;
      case 'tp':
        await generateTp({ courseId, lessonId, context });
        break;
      default:
        throw new Error(`aucun générateur enregistré pour le type de leçon « ${lesson.type} »`);
    }

    // Filet de sécurité : le générateur pose normalement 'ready' lui-même.
    await Lesson.updateOne({ _id: lessonId, status: { $ne: 'ready' } }, { $set: { status: 'ready' } });

    // Historique de version (P46) : trace l'empreinte du contenu produit, pour
    // détecter ensuite les leçons à re-déployer. Best-effort (n'échoue jamais).
    await recordLessonVersion(lessonId, job.name === LESSON_CONTENT_JOB ? 'génération' : 'régénération');

    // Résume la leçon générée pour alimenter la continuité des suivantes (P19).
    await summarizeLesson(lessonId);
    await report(courseId, 100, `Contenu prêt : « ${lesson.title} »`);

    // Chaînage séquentiel (P19) : la leçon enfile la suivante du cours, de sorte
    // que chaque génération dispose du contexte des précédentes. Réservé au flux
    // de génération de cours ('lesson-content') ; une régénération unitaire ne
    // relance pas les voisines.
    if (job.name === LESSON_CONTENT_JOB) {
      await enqueueNextLesson(courseId, lessonId);
    }

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
