// Rafraîchissement des métriques analytics (Prompt 61).
//
//  1) refreshCourseAnalytics : pour un cours, interroge chaque provider des
//     plateformes où le cours est PUBLIÉ, et upsert un instantané CourseAnalytics
//     par (cours, plateforme). Idempotent.
//  2) refreshAllAnalytics : balaie tous les déploiements publiés et rafraîchit
//     chaque cours concerné.
//  3) Scheduler BullMQ repeatable (queue dédiée) : rafraîchissement périodique.

import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { Deployment, CourseAnalytics } from '../../shared.js';
import { getRedisConnection } from '../../queues/connection.js';
import { logger } from '../../queues/index.js';
import { getAnalyticsProvider } from './index.js';
import type { PlatformMetrics } from './types.js';

/**
 * Rafraîchit les métriques d'UN cours : pour chaque déploiement publié dont la
 * plateforme dispose d'un provider, récupère les métriques et upsert le snapshot.
 * Retourne les métriques collectées (utile aux tests/diagnostic).
 */
export async function refreshCourseAnalytics(courseId: string): Promise<PlatformMetrics[]> {
  // Déploiements publiés du cours (un par plateforme retenu, le plus récent).
  const deployments = await Deployment.find({ courseId, status: 'published' })
    .sort({ updatedAt: -1 })
    .lean();

  const collected: PlatformMetrics[] = [];
  const seen = new Set<string>();

  for (const dep of deployments) {
    if (seen.has(dep.platform)) continue;
    const provider = getAnalyticsProvider(dep.platform);
    if (!provider) continue;
    seen.add(dep.platform);

    try {
      const metrics = await provider.fetchMetrics({
        courseId,
        externalId: dep.externalId,
        externalUrl: dep.externalUrl,
      });
      collected.push(metrics);

      await CourseAnalytics.updateOne(
        { courseId, platform: dep.platform },
        {
          $set: {
            userId: dep.userId,
            enrollments: metrics.enrollments,
            rating: metrics.rating,
            revenue: metrics.revenue,
            views: metrics.views,
            fetchedAt: new Date(),
          },
        },
        { upsert: true },
      );
    } catch (err) {
      logger.warn({ courseId, platform: dep.platform, err }, 'analytics : récupération échouée');
    }
  }

  return collected;
}

/**
 * Rafraîchit tous les cours ayant au moins un déploiement publié. Retourne le
 * nombre de cours traités.
 */
export async function refreshAllAnalytics(): Promise<number> {
  const courseIds: unknown[] = await Deployment.distinct('courseId', { status: 'published' });
  let count = 0;
  for (const id of courseIds) {
    try {
      await refreshCourseAnalytics(String(id));
      count += 1;
    } catch (err) {
      logger.warn({ courseId: String(id), err }, 'analytics : rafraîchissement cours échoué');
    }
  }
  return count;
}

/* ------------------------------------------------------------------ */
/* Scheduler BullMQ repeatable (queue dédiée hors registre typé)       */
/* ------------------------------------------------------------------ */

/** Queue cron dédiée au rafraîchissement analytics (hors QUEUES du pipeline). */
export const ANALYTICS_QUEUE = 'analytics-refresh';
/** Identifiant du job répétable (dédupliqué par BullMQ). */
export const ANALYTICS_JOB = 'analytics-refresh-daily';
/** Cadence par défaut : tous les jours à 5h (surchargée par ANALYTICS_REFRESH_CRON). */
const DEFAULT_CRON = '0 5 * * *';

interface AnalyticsJobData {
  reason?: string;
}

let analyticsQueue: Queue<AnalyticsJobData> | null = null;
let analyticsWorker: Worker<AnalyticsJobData> | null = null;

function bullConnection(): ConnectionOptions {
  return getRedisConnection() as unknown as ConnectionOptions;
}

/**
 * Démarre le scheduler analytics : crée la queue, planifie le job répétable
 * (cron quotidien) et démarre le worker qui exécute refreshAllAnalytics.
 * Idempotent. À appeler depuis index.ts.
 */
export async function startAnalyticsScheduler(
  cron: string = process.env.ANALYTICS_REFRESH_CRON?.trim() || DEFAULT_CRON,
): Promise<void> {
  if (analyticsWorker) return;

  analyticsQueue = new Queue<AnalyticsJobData>(ANALYTICS_QUEUE, { connection: bullConnection() });
  analyticsQueue.on('error', (err) => logger.error({ queue: ANALYTICS_QUEUE, err }, 'erreur queue analytics'));

  await analyticsQueue.add(
    ANALYTICS_JOB,
    { reason: 'cron' },
    { repeat: { pattern: cron }, jobId: ANALYTICS_JOB, removeOnComplete: 20, removeOnFail: 50 },
  );

  analyticsWorker = new Worker<AnalyticsJobData>(
    ANALYTICS_QUEUE,
    async (_job: Job<AnalyticsJobData>) => {
      const refreshed = await refreshAllAnalytics();
      return { refreshed };
    },
    { connection: bullConnection(), concurrency: 1 },
  );
  analyticsWorker.on('failed', (job, err) =>
    logger.error({ queue: ANALYTICS_QUEUE, jobId: job?.id, err }, 'analytics : job en échec'),
  );
  analyticsWorker.on('error', (err) => logger.error({ queue: ANALYTICS_QUEUE, err }, 'erreur worker analytics'));

  logger.info({ cron }, 'scheduler analytics démarré');
}

/** Déclenche un rafraîchissement immédiat hors cadence (diagnostic / bouton). */
export async function triggerAnalyticsRefreshNow(): Promise<void> {
  if (!analyticsQueue) analyticsQueue = new Queue<AnalyticsJobData>(ANALYTICS_QUEUE, { connection: bullConnection() });
  await analyticsQueue.add(ANALYTICS_JOB + ':manual', { reason: 'manual' }, { removeOnComplete: true });
}

/** Arrête proprement le scheduler (worker + queue). */
export async function stopAnalyticsScheduler(): Promise<void> {
  await analyticsWorker?.close().catch(() => undefined);
  await analyticsQueue?.close().catch(() => undefined);
  analyticsWorker = null;
  analyticsQueue = null;
}
