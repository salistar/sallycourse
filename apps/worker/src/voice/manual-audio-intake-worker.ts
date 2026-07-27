// Queue + worker dédiés de l'intégration audio manuelle par slide (Lot 4,
// plan 2026-07-20). Même patron que la réparation audio (audio-repair-worker)
// et la régénération d'image de slide (slide-image-worker) : une queue BullMQ
// HORS du registre typé du pipeline de génération (QUEUES), car cette
// normalisation est déclenchée à la DEMANDE (upload de l'auteur), pas par le
// pipeline de génération lui-même. La mise en file vit côté web
// (apps/web/src/lib/queues.ts) ; ce module ne fait que CONSOMMER les jobs.
import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import { getRedisConnection } from '../queues/connection.js';
import { logger } from '../queues/index.js';
import {
  MANUAL_AUDIO_INTAKE_QUEUE,
  processManualAudioIntake,
  type ManualAudioIntakeJobData,
} from '../processors/manual-audio-intake.js';

let manualAudioIntakeWorker: Worker<ManualAudioIntakeJobData> | null = null;

function bullConnection(): ConnectionOptions {
  return getRedisConnection() as unknown as ConnectionOptions;
}

/**
 * Démarre le worker d'intégration audio manuelle. Idempotent. Concurrency 2
 * par défaut (ffmpeg CPU, léger), surchargeable par
 * WORKER_MANUAL_AUDIO_CONCURRENCY.
 */
export function startManualAudioIntakeWorker(): void {
  if (manualAudioIntakeWorker) return;

  const raw = process.env.WORKER_MANUAL_AUDIO_CONCURRENCY;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  const concurrency = Number.isFinite(parsed) && parsed > 0 ? parsed : 2;

  manualAudioIntakeWorker = new Worker<ManualAudioIntakeJobData>(MANUAL_AUDIO_INTAKE_QUEUE, processManualAudioIntake, {
    connection: bullConnection(),
    concurrency,
    lockDuration: 2 * 60_000,
    stalledInterval: 60_000,
    maxStalledCount: 3,
  });
  manualAudioIntakeWorker.on('failed', (job: Job<ManualAudioIntakeJobData> | undefined, err: Error) =>
    logger.error({ queue: MANUAL_AUDIO_INTAKE_QUEUE, jobId: job?.id, err }, 'manual-audio-intake : job en échec'),
  );
  manualAudioIntakeWorker.on('error', (err: Error) =>
    logger.error({ queue: MANUAL_AUDIO_INTAKE_QUEUE, err }, 'erreur worker manual-audio-intake'),
  );

  logger.info({ concurrency }, 'worker d’intégration audio manuelle (Lot 4) démarré');
}

/** Arrête proprement le worker. */
export async function stopManualAudioIntakeWorker(): Promise<void> {
  await manualAudioIntakeWorker?.close().catch(() => undefined);
  manualAudioIntakeWorker = null;
}
