import { Queue, type ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUES, getConfig, type ContentJobData, type OutlineJobData } from '@sallycourse/shared';

/**
 * File BullMQ côté web — uniquement pour ENQUEUER (les workers consomment
 * ailleurs). Singletons stockés sur globalThis : le hot-reload Next ne doit
 * pas ouvrir une connexion Redis à chaque recompilation.
 */

interface QueueStore {
  redis?: Redis;
  outlineQueue?: Queue<OutlineJobData>;
  contentQueue?: Queue<ContentJobData>;
}

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
