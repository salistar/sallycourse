// Queue + worker dédiés du rendu de CAPTURE D'ÉCRAN uploadée (Feature B). Même
// patron que le filigrane (media/watermark-worker.ts) et la dictée vocale
// (voice/voice-intake-worker.ts) : une queue BullMQ HORS du registre typé du
// pipeline de génération (QUEUES), car ce rendu n'est pas une étape de génération
// mais une action à la DEMANDE (l'auteur uploade un enregistrement, on le narre
// et on incruste ses légendes). La mise en file vit côté web
// (apps/web/src/lib/queues.ts) ; ce module ne fait que CONSOMMER les jobs.
import { Worker, type ConnectionOptions } from 'bullmq';
import { getRedisConnection } from '../queues/connection.js';
import { logger } from '../queues/index.js';
import {
  SCREENCAST_RENDER_QUEUE,
  processScreencastRender,
  type ScreencastRenderJobData,
} from '../processors/screencast-render.js';

let screencastRenderWorker: Worker<ScreencastRenderJobData> | null = null;

function bullConnection(): ConnectionOptions {
  return getRedisConnection() as unknown as ConnectionOptions;
}

/**
 * Démarre le worker de rendu de capture uploadée. Idempotent. Concurrency 1 par
 * défaut (ffmpeg CPU-bound), surchargeable par WORKER_SCREENCAST_CONCURRENCY.
 * lockDuration élevé : la composition ffmpeg (ré-encodage + drawtext) peut être
 * longue — mêmes garde-fous anti-« stalled » que le rendu vidéo/filigrane.
 */
export function startScreencastRenderWorker(): void {
  if (screencastRenderWorker) return;

  const raw = process.env.WORKER_SCREENCAST_CONCURRENCY;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  const concurrency = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;

  screencastRenderWorker = new Worker<ScreencastRenderJobData>(
    SCREENCAST_RENDER_QUEUE,
    processScreencastRender,
    {
      connection: bullConnection(),
      concurrency,
      lockDuration: 10 * 60_000,
      stalledInterval: 60_000,
      maxStalledCount: 3,
    },
  );
  screencastRenderWorker.on('failed', (job, err) =>
    logger.error({ queue: SCREENCAST_RENDER_QUEUE, jobId: job?.id, err }, 'screencast : job en échec'),
  );
  screencastRenderWorker.on('error', (err) =>
    logger.error({ queue: SCREENCAST_RENDER_QUEUE, err }, 'erreur worker screencast'),
  );

  logger.info({ concurrency }, 'worker de rendu de capture uploadée (Feature B) démarré');
}

/** Arrête proprement le worker. */
export async function stopScreencastRenderWorker(): Promise<void> {
  await screencastRenderWorker?.close().catch(() => undefined);
  screencastRenderWorker = null;
}
