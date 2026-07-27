// Queue + worker dédiés de la réparation audio (Lot 2, plan 2026-07-20). Même
// patron que le rendu de capture uploadée (voice/screencast-render-worker.ts) :
// une queue BullMQ HORS du registre typé du pipeline de génération (QUEUES),
// car cette réparation n'est pas une étape de génération mais une action à la
// DEMANDE sur une leçon DÉJÀ prête. La mise en file vit côté web
// (apps/web/src/lib/queues.ts) ; ce module ne fait que CONSOMMER les jobs.
import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import { getRedisConnection } from '../queues/connection.js';
import { logger } from '../queues/index.js';
import { AUDIO_REPAIR_QUEUE, processAudioRepair, type AudioRepairJobData } from '../processors/audio-repair.js';

let audioRepairWorker: Worker<AudioRepairJobData> | null = null;

function bullConnection(): ConnectionOptions {
  return getRedisConnection() as unknown as ConnectionOptions;
}

/**
 * Démarre le worker de réparation audio. Idempotent. Concurrency 1 par défaut
 * (ffmpeg + TTS CPU/GPU-bound), surchargeable par WORKER_AUDIO_REPAIR_CONCURRENCY.
 * lockDuration élevé : le mode 'resynth' peut ré-appeler un provider TTS payant
 * (Modal/ElevenLabs) sur plusieurs slides — mêmes garde-fous anti-« stalled »
 * que le rendu vidéo/screencast.
 */
export function startAudioRepairWorker(): void {
  if (audioRepairWorker) return;

  const raw = process.env.WORKER_AUDIO_REPAIR_CONCURRENCY;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  const concurrency = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;

  audioRepairWorker = new Worker<AudioRepairJobData>(AUDIO_REPAIR_QUEUE, processAudioRepair, {
    connection: bullConnection(),
    concurrency,
    lockDuration: 10 * 60_000,
    stalledInterval: 60_000,
    maxStalledCount: 3,
  });
  audioRepairWorker.on('failed', (job: Job<AudioRepairJobData> | undefined, err: Error) =>
    logger.error({ queue: AUDIO_REPAIR_QUEUE, jobId: job?.id, err }, 'audio-repair : job en échec'),
  );
  audioRepairWorker.on('error', (err: Error) =>
    logger.error({ queue: AUDIO_REPAIR_QUEUE, err }, 'erreur worker audio-repair'),
  );

  logger.info({ concurrency }, 'worker de réparation audio (Lot 2) démarré');
}

/** Arrête proprement le worker. */
export async function stopAudioRepairWorker(): Promise<void> {
  await audioRepairWorker?.close().catch(() => undefined);
  audioRepairWorker = null;
}
