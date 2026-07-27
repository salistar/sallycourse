// Queue + worker dédiés de la régénération d'image de slide (Lot 3, plan
// 2026-07-20). Même patron que la réparation audio (voice/audio-repair-worker.ts)
// et le rendu de capture uploadée : une queue BullMQ HORS du registre typé du
// pipeline de génération (QUEUES), car cette régénération est une action à la
// DEMANDE sur une slide d'une leçon DÉJÀ générée. La mise en file vit côté web
// (apps/web/src/lib/queues.ts) ; ce module ne fait que CONSOMMER les jobs.
import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import { getRedisConnection } from '../queues/connection.js';
import { logger } from '../queues/index.js';
import { SLIDE_IMAGE_QUEUE, processSlideImage, type SlideImageJobData } from '../processors/slide-image.js';

let slideImageWorker: Worker<SlideImageJobData> | null = null;

function bullConnection(): ConnectionOptions {
  return getRedisConnection() as unknown as ConnectionOptions;
}

/**
 * Démarre le worker de régénération d'image de slide. Idempotent. Concurrency
 * 2 par défaut (appel Modal GPU, pas de CPU local lourd), surchargeable par
 * WORKER_SLIDE_IMAGE_CONCURRENCY. lockDuration aligné sur le cold-start Modal
 * (jusqu'à quelques minutes, cf. providers/modal-image-provider.ts).
 */
export function startSlideImageWorker(): void {
  if (slideImageWorker) return;

  const raw = process.env.WORKER_SLIDE_IMAGE_CONCURRENCY;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  const concurrency = Number.isFinite(parsed) && parsed > 0 ? parsed : 2;

  slideImageWorker = new Worker<SlideImageJobData>(SLIDE_IMAGE_QUEUE, processSlideImage, {
    connection: bullConnection(),
    concurrency,
    lockDuration: 5 * 60_000,
    stalledInterval: 60_000,
    maxStalledCount: 3,
  });
  slideImageWorker.on('failed', (job: Job<SlideImageJobData> | undefined, err: Error) =>
    logger.error({ queue: SLIDE_IMAGE_QUEUE, jobId: job?.id, err }, 'slide-image : job en échec'),
  );
  slideImageWorker.on('error', (err: Error) =>
    logger.error({ queue: SLIDE_IMAGE_QUEUE, err }, 'erreur worker slide-image'),
  );

  logger.info({ concurrency }, 'worker de régénération d’image de slide (Lot 3) démarré');
}

/** Arrête proprement le worker. */
export async function stopSlideImageWorker(): Promise<void> {
  await slideImageWorker?.close().catch(() => undefined);
  slideImageWorker = null;
}
