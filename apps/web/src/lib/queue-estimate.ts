import { Queue, type ConnectionOptions } from 'bullmq';
import Redis from 'ioredis';
import { connectDb, GenerationJob } from '@sallycourse/db';
import { getConfig, type QueueName } from '@sallycourse/shared';

/**
 * Estimation du temps d'attente d'une file (P73) — affichée sur l'écran de
 * génération pour donner une idée du délai avant traitement, à partir de :
 *   1. le nombre de jobs actuellement EN ATTENTE dans la queue BullMQ ;
 *   2. la durée MOYENNE historique de ce step, calculée sur les GenerationJob
 *      passés (dernier événement 'complete' à progress=100, approximé ici par
 *      l'écart createdAt→updatedAt des jobs terminés — voir averageStepDurationMs).
 * estimate = position_dans_la_file × durée_moyenne. Best-effort : Redis/Mongo
 * indisponibles → renvoie une estimation nulle plutôt que de faire échouer
 * l'écran de génération (l'estimation est un bonus UX, pas un garde-fou).
 */

export interface QueueWaitEstimate {
  queueName: QueueName;
  /** Nombre de jobs en attente devant le prochain à traiter. */
  waitingCount: number;
  /** Durée moyenne historique du step, en millisecondes (0 si aucun historique). */
  averageDurationMs: number;
  /** Estimation du temps d'attente avant traitement, en millisecondes. */
  estimatedWaitMs: number;
}

// ── Connexion BullMQ partagée (globalThis : survit au HMR en dev) ──
const globalForEstimate = globalThis as unknown as {
  __estimateBullConnection?: Redis;
  __estimateBullQueues?: Map<QueueName, Queue>;
};

function getBullConnection(): Redis {
  if (!globalForEstimate.__estimateBullConnection) {
    globalForEstimate.__estimateBullConnection = new Redis(getConfig().REDIS_URL, {
      maxRetriesPerRequest: null,
    });
    globalForEstimate.__estimateBullConnection.on('error', () => {});
  }
  return globalForEstimate.__estimateBullConnection;
}

function getQueueByName(name: QueueName): Queue {
  globalForEstimate.__estimateBullQueues ??= new Map();
  let queue = globalForEstimate.__estimateBullQueues.get(name);
  if (!queue) {
    // Cast : pnpm résout deux versions d'ioredis (celle du web vs celle
    // embarquée par bullmq) — types structurellement identiques à l'exécution.
    queue = new Queue(name, { connection: getBullConnection() as unknown as ConnectionOptions });
    globalForEstimate.__estimateBullQueues.set(name, queue);
  }
  return queue;
}

/** Nombre maximal de jobs récents pris en compte pour la moyenne (borne la requête). */
const HISTORY_SAMPLE_SIZE = 50;

/**
 * Durée moyenne historique (ms) du step `queueName`, calculée sur les
 * GenerationJob les plus récents ayant abouti (progress=100, sans erreur).
 * Approximation : updatedAt - createdAt du document (le document est upserté
 * au démarrage du step et mis à jour à progress=100 quand il aboutit — l'écart
 * couvre donc sensiblement la durée réelle de traitement). Retourne 0 si
 * aucun historique n'est disponible (pas encore assez de données).
 */
export async function averageStepDurationMs(queueName: QueueName): Promise<number> {
  await connectDb();
  const recent = await GenerationJob.find({ step: queueName, progress: 100 })
    .sort({ updatedAt: -1 })
    .limit(HISTORY_SAMPLE_SIZE)
    .select('createdAt updatedAt')
    .lean();

  return computeAverageDurationMs(
    recent.map((doc) => ({
      createdAt: new Date(doc.createdAt).getTime(),
      updatedAt: new Date(doc.updatedAt).getTime(),
    })),
  );
}

/**
 * Calcul PUR de la durée moyenne (ms) à partir de paires createdAt/updatedAt —
 * séparé de la requête Mongo pour être testable sans DB. Ignore les entrées
 * incohérentes (updatedAt <= createdAt, horloge ou upsert immédiat sans travail réel).
 */
export function computeAverageDurationMs(
  samples: readonly { createdAt: number; updatedAt: number }[],
): number {
  const durations = samples
    .map((s) => s.updatedAt - s.createdAt)
    .filter((ms) => ms > 0);
  if (durations.length === 0) return 0;
  const total = durations.reduce((acc, ms) => acc + ms, 0);
  return Math.round(total / durations.length);
}

/**
 * Combine le nombre de jobs en attente et la durée moyenne en une estimation
 * du délai avant traitement — calcul PUR, testable indépendamment de BullMQ/Mongo.
 */
export function computeEstimatedWaitMs(waitingCount: number, averageDurationMs: number): number {
  if (waitingCount <= 0 || averageDurationMs <= 0) return 0;
  return waitingCount * averageDurationMs;
}

/**
 * Estimation du temps d'attente de la file `queueName` : jobs en attente ×
 * durée moyenne historique du step. Best-effort — ne jette jamais, une
 * indisponibilité Redis/Mongo renvoie une estimation à zéro (l'UI masque
 * alors l'estimation plutôt que d'afficher une valeur fausse).
 */
export async function estimateWaitTime(queueName: QueueName): Promise<QueueWaitEstimate> {
  let waitingCount = 0;
  try {
    waitingCount = await getQueueByName(queueName).getWaitingCount();
  } catch {
    waitingCount = 0;
  }

  let averageDurationMs = 0;
  try {
    averageDurationMs = await averageStepDurationMs(queueName);
  } catch {
    averageDurationMs = 0;
  }

  return {
    queueName,
    waitingCount,
    averageDurationMs,
    estimatedWaitMs: computeEstimatedWaitMs(waitingCount, averageDurationMs),
  };
}
