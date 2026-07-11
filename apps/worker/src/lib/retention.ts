// Politique de rétention des médias (Prompt 79).
//
//  1) Purge des assets INTERMÉDIAIRES d'une leçon vidéo une fois son rendu
//     final réussi : slides PNG + audio par slide (storageKeys…slide(i) /
//     …audio(i)) ne servent plus qu'au débogage — on les supprime pour ne
//     garder que la vidéo assemblée, les sous-titres (SRT/VTT) et l'audio
//     global éventuel. Une leçon en échec ('failed') garde TOUT (debug).
//  2) Archivage à froid : détecte les cours inactifs depuis 90+ jours,
//     marque Course.archived=true et exclut leurs gros assets des listings
//     actifs (best-effort, best-effort). Régénération sans re-payer le LLM :
//     voir POST /api/courses/[id]/reactivate (ré-enqueue depuis Lesson.script,
//     directement sur la queue TTS).
//  3) Scheduler BullMQ repeatable (queue dédiée, même pattern que
//     lib/analytics/refresh.ts) : exécute l'archivage périodiquement.
import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { Course, Lesson, Section, deleteObject, storageKeys } from '../shared.js';
import { getRedisConnection } from '../queues/connection.js';
import { logger } from '../queues/index.js';

/* ------------------------------------------------------------------ */
/* 1) Détection d'inactivité (pure, dates)                            */
/* ------------------------------------------------------------------ */

/** Seuil par défaut d'inactivité avant archivage à froid (90 jours). */
export const ARCHIVE_INACTIVITY_DAYS = 90;

/**
 * Détermine si un cours est inactif depuis au moins `thresholdDays` jours,
 * par comparaison de `lastActivityAt` (dernière mise à jour connue — updatedAt
 * du cours, ou plus récente activité liée : déploiement, avis, etc. selon
 * l'appelant) à `now`. Fonction pure — aucune I/O, aucun accès Mongo ici.
 */
export function isCourseInactive(
  lastActivityAt: Date,
  now: Date,
  thresholdDays: number = ARCHIVE_INACTIVITY_DAYS,
): boolean {
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  return now.getTime() - lastActivityAt.getTime() >= thresholdMs;
}

/**
 * Filtre une liste de cours (forme minimale) pour ne garder que ceux inactifs
 * depuis `thresholdDays` jours et pas déjà archivés. Pure — l'appelant fournit
 * `now` et la liste (déjà chargée depuis Mongo).
 */
export interface CourseActivityInfo {
  id: string;
  updatedAt: Date;
  archived?: boolean;
}

export function selectCoursesToArchive(
  courses: readonly CourseActivityInfo[],
  now: Date,
  thresholdDays: number = ARCHIVE_INACTIVITY_DAYS,
): string[] {
  return courses
    .filter((c) => !c.archived && isCourseInactive(c.updatedAt, now, thresholdDays))
    .map((c) => c.id);
}

/* ------------------------------------------------------------------ */
/* 2) Purge sélective des assets intermédiaires (leçon vidéo 'ready')  */
/* ------------------------------------------------------------------ */

export interface LessonAssetKeys {
  lessonId: string;
  status: string;
  /** Nombre de slides (script.slides.length) — borne les index à purger. */
  slideCount: number;
}

/**
 * Calcule les clés storage intermédiaires (slides PNG + audio par slide) à
 * supprimer pour une leçon, SANS toucher à la vidéo finale / SRT / VTT.
 * Ne retourne des clés QUE si `status === 'ready'` (rendu final réussi) —
 * une leçon 'failed' (ou tout autre statut) ne perd RIEN, pour permettre le
 * débogage. Fonction pure : ne fait aucun appel storage.
 */
export function intermediateKeysToPurge(
  courseId: string,
  sectionOrder: number,
  lessonOrder: number,
  lesson: LessonAssetKeys,
): string[] {
  if (lesson.status !== 'ready') return [];

  const lessonKeys = storageKeys.course(courseId).lesson(sectionOrder, lessonOrder);
  const keys: string[] = [];
  for (let i = 0; i < lesson.slideCount; i++) {
    keys.push(lessonKeys.slide(i));
    keys.push(lessonKeys.audio(i));
  }
  return keys;
}

export interface PurgeResult {
  lessonId: string;
  purgedKeys: string[];
  skipped: boolean;
}

/**
 * Purge les assets intermédiaires (slides + audio par slide) de TOUTES les
 * leçons vidéo 'ready' d'un cours, une fois son rendu final terminé avec
 * succès. Best-effort par clé (une suppression échouée n'interrompt pas les
 * suivantes). Les leçons non 'ready' (ex. 'failed') sont explicitement
 * ignorées (skipped=true, aucune clé supprimée) pour préserver le débogage.
 */
export async function purgeCourseIntermediateAssets(courseId: string): Promise<PurgeResult[]> {
  const sections = await Section.find({ courseId }).select('_id order').lean();
  const sectionOrder = new Map(sections.map((s) => [String(s._id), s.order]));

  const lessons = await Lesson.find({ courseId, type: 'video' })
    .select('_id sectionId order status script')
    .lean();

  const results: PurgeResult[] = [];

  for (const lesson of lessons) {
    const lessonId = String(lesson._id);
    const order = sectionOrder.get(String(lesson.sectionId));
    if (order === undefined) {
      results.push({ lessonId, purgedKeys: [], skipped: true });
      continue;
    }

    if (lesson.status !== 'ready') {
      results.push({ lessonId, purgedKeys: [], skipped: true });
      continue;
    }

    const script = lesson.script as { slides?: unknown[] } | null | undefined;
    const slideCount = Array.isArray(script?.slides) ? script!.slides!.length : 0;

    const keys = intermediateKeysToPurge(courseId, order, lesson.order, {
      lessonId,
      status: lesson.status,
      slideCount,
    });

    const purged: string[] = [];
    for (const key of keys) {
      try {
        await deleteObject(key);
        purged.push(key);
      } catch (err) {
        logger.warn({ courseId, lessonId, key, err }, 'retention : suppression d\'asset intermédiaire échouée');
      }
    }
    results.push({ lessonId, purgedKeys: purged, skipped: false });
  }

  return results;
}

/* ------------------------------------------------------------------ */
/* 3) Archivage à froid (cron)                                        */
/* ------------------------------------------------------------------ */

/**
 * Archive tous les cours inactifs depuis `thresholdDays` jours : marque
 * Course.archived=true + archivedAt=now. N'échoue jamais globalement (best-
 * effort par cours). Ne supprime aucun asset (l'archivage exclut juste des
 * listings actifs — les assets restent adressables pour une réactivation).
 * Retourne le nombre de cours archivés.
 */
export async function archiveInactiveCourses(
  now: Date = new Date(),
  thresholdDays: number = ARCHIVE_INACTIVITY_DAYS,
): Promise<number> {
  const candidates = await Course.find({ archived: { $ne: true } })
    .select('_id updatedAt archived')
    .lean();

  const toArchive = selectCoursesToArchive(
    candidates.map((c) => ({ id: String(c._id), updatedAt: c.updatedAt, archived: c.archived })),
    now,
    thresholdDays,
  );

  let count = 0;
  for (const courseId of toArchive) {
    try {
      await Course.updateOne(
        { _id: courseId },
        { $set: { archived: true, archivedAt: now } },
      );
      count += 1;
    } catch (err) {
      logger.warn({ courseId, err }, 'retention : archivage du cours échoué');
    }
  }
  return count;
}

/* ------------------------------------------------------------------ */
/* Scheduler BullMQ repeatable (queue dédiée, même pattern qu'analytics) */
/* ------------------------------------------------------------------ */

/** Queue cron dédiée à l'archivage à froid (hors registre typé du pipeline). */
export const RETENTION_QUEUE = 'retention-archive';
/** Identifiant du job répétable (dédupliqué par BullMQ). */
export const RETENTION_JOB = 'retention-archive-daily';
/** Cadence par défaut : tous les jours à 4h (surchargée par RETENTION_ARCHIVE_CRON). */
const DEFAULT_CRON = '0 4 * * *';

interface RetentionJobData {
  reason?: string;
}

let retentionQueue: Queue<RetentionJobData> | null = null;
let retentionWorker: Worker<RetentionJobData> | null = null;

function bullConnection(): ConnectionOptions {
  return getRedisConnection() as unknown as ConnectionOptions;
}

/**
 * Démarre le scheduler de rétention : crée la queue, planifie le job
 * répétable (cron quotidien) et démarre le worker qui exécute
 * archiveInactiveCourses. Idempotent. À appeler depuis index.ts.
 */
export async function startRetentionScheduler(
  cron: string = process.env.RETENTION_ARCHIVE_CRON?.trim() || DEFAULT_CRON,
): Promise<void> {
  if (retentionWorker) return;

  retentionQueue = new Queue<RetentionJobData>(RETENTION_QUEUE, { connection: bullConnection() });
  retentionQueue.on('error', (err) => logger.error({ queue: RETENTION_QUEUE, err }, 'erreur queue rétention'));

  await retentionQueue.add(
    RETENTION_JOB,
    { reason: 'cron' },
    { repeat: { pattern: cron }, jobId: RETENTION_JOB, removeOnComplete: 20, removeOnFail: 50 },
  );

  retentionWorker = new Worker<RetentionJobData>(
    RETENTION_QUEUE,
    async (_job: Job<RetentionJobData>) => {
      const archived = await archiveInactiveCourses();
      return { archived };
    },
    { connection: bullConnection(), concurrency: 1 },
  );
  retentionWorker.on('failed', (job, err) =>
    logger.error({ queue: RETENTION_QUEUE, jobId: job?.id, err }, 'rétention : job en échec'),
  );
  retentionWorker.on('error', (err) => logger.error({ queue: RETENTION_QUEUE, err }, 'erreur worker rétention'));

  logger.info({ cron }, 'scheduler rétention démarré');
}

/** Déclenche un archivage immédiat hors cadence (diagnostic / bouton admin). */
export async function triggerRetentionArchiveNow(): Promise<void> {
  if (!retentionQueue) retentionQueue = new Queue<RetentionJobData>(RETENTION_QUEUE, { connection: bullConnection() });
  await retentionQueue.add(RETENTION_JOB + ':manual', { reason: 'manual' }, { removeOnComplete: true });
}

/** Arrête proprement le scheduler (worker + queue). */
export async function stopRetentionScheduler(): Promise<void> {
  await retentionWorker?.close().catch(() => undefined);
  await retentionQueue?.close().catch(() => undefined);
  retentionWorker = null;
  retentionQueue = null;
}
