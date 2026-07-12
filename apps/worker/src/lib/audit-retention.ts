// Purge par rétention du journal d'audit (Prompt 149) : conserve 12 mois
// (AUDIT_RETENTION_DAYS, packages/shared/src/audit.ts) puis supprime
// définitivement les entrées plus anciennes. C'est le SEUL endroit qui
// supprime des AuditLog — le modèle lui-même n'expose aucune méthode
// update/delete métier (voir packages/db/src/models/audit-log.ts). Même
// pattern scheduler BullMQ repeatable que lib/retention.ts et
// lib/course-refresh.ts.
import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { AuditLog, selectAuditLogsToPurge } from '../shared.js';
import { getRedisConnection } from '../queues/connection.js';
import { logger } from '../queues/index.js';

/**
 * Purge les entrées AuditLog plus anciennes que la fenêtre de rétention (12
 * mois par défaut). Charge uniquement les champs nécessaires (id + createdAt),
 * délègue la décision à la fonction pure selectAuditLogsToPurge (packages/shared),
 * puis supprime par lot. Retourne le nombre d'entrées purgées.
 */
export async function purgeExpiredAuditLogs(now: Date = new Date()): Promise<number> {
  const entries = await AuditLog.find({}).select('_id createdAt').lean();
  const toPurge = selectAuditLogsToPurge(
    entries.map((e) => ({ id: String(e._id), createdAt: e.createdAt })),
    now,
  );

  if (toPurge.length === 0) return 0;

  const result = await AuditLog.deleteMany({ _id: { $in: toPurge } });
  return result.deletedCount ?? 0;
}

/* ------------------------------------------------------------------ */
/* Scheduler BullMQ repeatable                                         */
/* ------------------------------------------------------------------ */

export const AUDIT_RETENTION_QUEUE = 'audit-retention-purge';
export const AUDIT_RETENTION_JOB = 'audit-retention-purge-daily';
/** Cadence par défaut : tous les jours à 5h (surchargée par AUDIT_RETENTION_CRON). */
const DEFAULT_CRON = '0 5 * * *';

interface AuditRetentionJobData {
  reason?: string;
}

let auditRetentionQueue: Queue<AuditRetentionJobData> | null = null;
let auditRetentionWorker: Worker<AuditRetentionJobData> | null = null;

function bullConnection(): ConnectionOptions {
  return getRedisConnection() as unknown as ConnectionOptions;
}

/**
 * Démarre le scheduler de purge du journal d'audit : crée la queue, planifie
 * le job répétable (cron quotidien) et démarre le worker qui exécute
 * purgeExpiredAuditLogs. Idempotent. À appeler depuis index.ts.
 */
export async function startAuditRetentionScheduler(
  cron: string = process.env.AUDIT_RETENTION_CRON?.trim() || DEFAULT_CRON,
): Promise<void> {
  if (auditRetentionWorker) return;

  auditRetentionQueue = new Queue<AuditRetentionJobData>(AUDIT_RETENTION_QUEUE, { connection: bullConnection() });
  auditRetentionQueue.on('error', (err) =>
    logger.error({ queue: AUDIT_RETENTION_QUEUE, err }, 'erreur queue purge audit'),
  );

  await auditRetentionQueue.add(
    AUDIT_RETENTION_JOB,
    { reason: 'cron' },
    { repeat: { pattern: cron }, jobId: AUDIT_RETENTION_JOB, removeOnComplete: 20, removeOnFail: 50 },
  );

  auditRetentionWorker = new Worker<AuditRetentionJobData>(
    AUDIT_RETENTION_QUEUE,
    async (_job: Job<AuditRetentionJobData>) => {
      const purged = await purgeExpiredAuditLogs();
      return { purged };
    },
    { connection: bullConnection(), concurrency: 1 },
  );
  auditRetentionWorker.on('failed', (job, err) =>
    logger.error({ queue: AUDIT_RETENTION_QUEUE, jobId: job?.id, err }, 'purge audit : job en échec'),
  );
  auditRetentionWorker.on('error', (err) => logger.error({ queue: AUDIT_RETENTION_QUEUE, err }, 'erreur worker purge audit'));

  logger.info({ cron }, 'scheduler purge audit démarré');
}

/** Arrête proprement le scheduler (worker + queue). */
export async function stopAuditRetentionScheduler(): Promise<void> {
  await auditRetentionWorker?.close().catch(() => undefined);
  await auditRetentionQueue?.close().catch(() => undefined);
  auditRetentionWorker = null;
  auditRetentionQueue = null;
}
