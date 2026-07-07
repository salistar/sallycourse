import { Queue, type ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';
import {
  QUEUES,
  getConfig,
  type ContentJobData,
  type DeploymentJobData,
  type OutlineJobData,
  type PackagingJobData,
} from '@sallycourse/shared';

/**
 * File BullMQ côté web — uniquement pour ENQUEUER (les workers consomment
 * ailleurs). Singletons stockés sur globalThis : le hot-reload Next ne doit
 * pas ouvrir une connexion Redis à chaque recompilation.
 */

interface QueueStore {
  redis?: Redis;
  outlineQueue?: Queue<OutlineJobData>;
  contentQueue?: Queue<ContentJobData>;
  packagingQueue?: Queue<PackagingJobData>;
  deploymentQueue?: Queue<DeploymentJobData>;
  feedbackQueue?: Queue<{ courseId: string }>;
}

/** Nom de la queue d'analyse de feedback (miroir du worker, hors registre typé). */
export const FEEDBACK_QUEUE = 'review-feedback';
/** Nom de job d'analyse d'un cours (P62). */
export const FEEDBACK_JOB = 'analyze-course-reviews';

const globalWithQueues = globalThis as typeof globalThis & {
  __sallycourseQueues?: QueueStore;
};

const store: QueueStore = (globalWithQueues.__sallycourseQueues ??= {});

/** Connexion Redis partagée (validée par getConfig). */
function getRedis(): Redis {
  if (!store.redis) {
    store.redis = new Redis(getConfig().REDIS_URL, {
      // Recommandé par BullMQ : pas de plafond de retries par commande.
      maxRetriesPerRequest: null,
    });
  }
  return store.redis;
}

/**
 * Connexion vue par BullMQ. pnpm duplique ioredis (5.10 côté bullmq, 5.11
 * côté app) : compatibles à l'exécution mais nominalement incompatibles pour
 * tsc, d'où le cast contrôlé.
 */
function getConnection(): ConnectionOptions {
  return getRedis() as unknown as ConnectionOptions;
}

/** Queue 'outline-generation' — point d'entrée du pipeline de génération. */
export function getOutlineQueue(): Queue<OutlineJobData> {
  if (!store.outlineQueue) {
    store.outlineQueue = new Queue<OutlineJobData>(QUEUES.outline, {
      connection: getConnection(),
    });
  }
  return store.outlineQueue;
}

/** Queue 'content-generation' — (re)génération du contenu d'une leçon. */
export function getContentQueue(): Queue<ContentJobData> {
  if (!store.contentQueue) {
    store.contentQueue = new Queue<ContentJobData>(QUEUES.content, {
      connection: getConnection(),
    });
  }
  return store.contentQueue;
}

/** Queue 'packaging' — construction du pack export ZIP téléchargeable. */
export function getPackagingQueue(): Queue<PackagingJobData> {
  if (!store.packagingQueue) {
    store.packagingQueue = new Queue<PackagingJobData>(QUEUES.packaging, {
      connection: getConnection(),
    });
  }
  return store.packagingQueue;
}

/** Queue 'deployment' — publication d'un cours sur une plateforme cible. */
export function getDeploymentQueue(): Queue<DeploymentJobData> {
  if (!store.deploymentQueue) {
    store.deploymentQueue = new Queue<DeploymentJobData>(QUEUES.deployment, {
      connection: getConnection(),
    });
  }
  return store.deploymentQueue;
}

/** Queue 'review-feedback' (P62) — analyse à la demande des avis d'un cours. */
export function getFeedbackQueue(): Queue<{ courseId: string }> {
  if (!store.feedbackQueue) {
    store.feedbackQueue = new Queue<{ courseId: string }>(FEEDBACK_QUEUE, {
      connection: getConnection(),
    });
  }
  return store.feedbackQueue;
}
