// Fabrique de queues et de workers BullMQ typés + heartbeat + arrêt propre.
import os from 'node:os';
import { Queue, Worker, type ConnectionOptions, type Job, type Processor } from 'bullmq';
import mongoose from 'mongoose';
import { pino } from 'pino';
import { defaultJobOptions, type QueueJobData, type QueueName } from '../shared.js';
import { closeSharedRedis, getRedisConnection } from './connection.js';
// P75 (monitoring) : compteurs /metrics + alerting ops sur échec définitif.
import { recordJobCompleted, recordJobFailed } from '../lib/metrics-server.js';
import { notifyOps } from '../lib/alerts.js';

/**
 * pnpm installe deux ioredis (worker 5.11.x vs celui embarqué par bullmq 5.10.x) :
 * types nominalement incompatibles mais identiques à l'exécution — cast contrôlé.
 */
function bullConnection(): ConnectionOptions {
  return getRedisConnection() as unknown as ConnectionOptions;
}

/**
 * Chemins caviardés dans les logs (P76 — audit sécurité) : le worker loggue
 * parfois des payloads de job bruts (job.data) qui peuvent contenir des
 * identifiants sensibles (credentials plateforme, clés API, tokens).
 */
const REDACTED_PATHS = [
  'password',
  '*.password',
  'token',
  '*.token',
  '*.data.token',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'apiKey',
  '*.apiKey',
  '*.data.apiKey',
  'secret',
  '*.secret',
  '*.data.secret',
  'clientSecret',
  '*.clientSecret',
  '*.data.clientSecret',
  'webhookSecret',
  '*.webhookSecret',
  'credentials',
  '*.credentials',
  '*.data.credentials',
  'authorization',
  '*.authorization',
  'headers.authorization',
  'headers.cookie',
  // Phase 6 (avatar HeyGen + voice cloning ElevenLabs) : identifiants de voix/config
  // clonée liés à un compte utilisateur — traités comme sensibles par prudence.
  'clonedVoiceId',
  '*.clonedVoiceId',
  'voiceId',
  '*.voiceId',
  '*.data.voiceId',
  'HEYGEN_API_KEY',
  '*.HEYGEN_API_KEY',
  'ELEVENLABS_API_KEY',
  '*.ELEVENLABS_API_KEY',
  'CREDENTIALS_MASTER_KEY',
  '*.CREDENTIALS_MASTER_KEY',
];

export const logger = pino({
  name: 'sallycourse-worker',
  redact: { paths: REDACTED_PATHS, censor: '[caviardé]' },
});

/** Canal Redis sur lequel le worker publie son heartbeat. */
export const WORKER_HEARTBEAT_CHANNEL = 'worker:heartbeat';
const HEARTBEAT_INTERVAL_MS = 10_000;

// Registres : une seule instance de Queue/Worker par nom de queue.
const queueRegistry = new Map<QueueName, Queue>();
const workerRegistry = new Map<QueueName, Worker>();

/** Fabrique typée : retourne la Queue (créée à la demande, réutilisée ensuite). */
export function createQueue<N extends QueueName>(name: N): Queue<QueueJobData[N]> {
  let queue = queueRegistry.get(name);
  if (!queue) {
    queue = new Queue<QueueJobData[N]>(name, {
      connection: bullConnection(),
      defaultJobOptions: { ...defaultJobOptions },
    });
    queue.on('error', (err) => logger.error({ queue: name, err }, 'erreur queue'));
    queueRegistry.set(name, queue);
  }
  return queue as Queue<QueueJobData[N]>;
}

/** Liste des queues enregistrées (P75 — monitoring : scan périodique anti-blocage). */
export function getRegisteredQueues(): ReadonlyArray<Queue> {
  return [...queueRegistry.values()];
}

/**
 * Marque le GenerationJob correspondant comme échoué (best-effort : ne jette
 * jamais, ignoré si Mongo n'est pas connecté). Le modèle vivra dans @sallycourse/db ;
 * on passe par la collection pour ne pas coupler le worker à sa définition.
 */
async function markGenerationJobFailed(
  queueName: QueueName,
  job: Job | undefined,
  err: Error,
): Promise<void> {
  const courseId = (job?.data as { courseId?: string } | undefined)?.courseId;
  if (!job || !courseId || mongoose.connection.readyState !== 1) return;
  try {
    await mongoose.connection.collection('generationjobs').updateOne(
      { courseId, step: queueName },
      {
        $set: {
          status: 'failed',
          error: err.message,
          jobId: job.id ?? null,
          attemptsMade: job.attemptsMade,
          failedAt: new Date(),
        },
      },
      { upsert: true },
    );
  } catch (dbErr) {
    logger.warn({ queue: queueName, jobId: job.id, courseId, err: dbErr }, 'marquage GenerationJob en échec impossible');
  }
}

export interface RegisterWorkerOptions {
  concurrency?: number;
}

/**
 * Enregistre un Worker BullMQ typé pour une queue, avec gestion d'erreur
 * structurée : log pino (jobId/courseId) à chaque échec, marquage du
 * GenerationJob en échec définitif une fois les tentatives épuisées.
 */
export function registerWorker<N extends QueueName>(
  name: N,
  processor: Processor<QueueJobData[N]>,
  { concurrency = 1 }: RegisterWorkerOptions = {},
): Worker<QueueJobData[N]> {
  if (workerRegistry.has(name)) {
    throw new Error(`Worker déjà enregistré pour la queue "${name}"`);
  }

  const worker = new Worker<QueueJobData[N]>(name, processor, {
    connection: bullConnection(),
    concurrency,
  });

  worker.on('failed', (job, err) => {
    const courseId = (job?.data as { courseId?: string } | undefined)?.courseId;
    const attempts = job?.opts.attempts ?? 1;
    const attemptsMade = job?.attemptsMade ?? 0;
    const definitive = attemptsMade >= attempts;
    logger.error(
      { queue: name, jobId: job?.id, courseId, attemptsMade, definitive, err },
      `job en échec${definitive ? ' définitif' : ' (retentative planifiée)'}`,
    );
    recordJobFailed(name);
    // Alerte ops dès la 3ᵉ tentative (échec répété), pas seulement à l'échec
    // définitif : permet d'agir avant que attempts (souvent 3) soit épuisé.
    if (attemptsMade >= 3) {
      void notifyOps(
        `job "${name}" en échec répété (tentative ${attemptsMade}${definitive ? ', définitif' : ''}) — cours ${courseId ?? 'inconnu'} : ${err.message}`,
        'critical',
      );
    }
    if (definitive) void markGenerationJobFailed(name, job, err);
  });
  worker.on('error', (err) => logger.error({ queue: name, err }, 'erreur worker'));
  worker.on('completed', (job) => {
    const courseId = (job.data as { courseId?: string } | undefined)?.courseId;
    logger.info({ queue: name, jobId: job.id, courseId }, 'job terminé');
    const durationMs = job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : 0;
    recordJobCompleted(name, durationMs);
  });

  workerRegistry.set(name, worker as Worker);
  logger.info({ queue: name, concurrency }, 'worker enregistré');
  return worker;
}

// ── Heartbeat ───────────────────────────────────────────────────
let heartbeatTimer: NodeJS.Timeout | null = null;

/** Publie périodiquement worker:heartbeat dans Redis (pub/sub + clé TTL). */
export function startHeartbeat(intervalMs = HEARTBEAT_INTERVAL_MS): void {
  if (heartbeatTimer) return;
  const redis = getRedisConnection();
  const identity = `${os.hostname()}:${process.pid}`;

  const beat = async (): Promise<void> => {
    const payload = JSON.stringify({
      worker: identity,
      queues: [...workerRegistry.keys()],
      ts: Date.now(),
    });
    try {
      await redis.publish(WORKER_HEARTBEAT_CHANNEL, payload);
      // Clé à TTL pour savoir "qui est vivant" sans être abonné au canal.
      await redis.set(`${WORKER_HEARTBEAT_CHANNEL}:${identity}`, payload, 'PX', intervalMs * 3);
    } catch (err) {
      logger.warn({ err }, 'heartbeat non publié');
    }
  };

  heartbeatTimer = setInterval(() => void beat(), intervalMs);
  heartbeatTimer.unref();
  void beat();
  logger.info({ intervalMs }, 'heartbeat démarré');
}

export function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ── Arrêt propre ────────────────────────────────────────────────
/** Ferme workers, queues puis connexion Redis (ordre important). */
export async function closeAll(): Promise<void> {
  stopHeartbeat();
  await Promise.allSettled([...workerRegistry.values()].map((w) => w.close()));
  await Promise.allSettled([...queueRegistry.values()].map((q) => q.close()));
  workerRegistry.clear();
  queueRegistry.clear();
  await closeSharedRedis();
}
