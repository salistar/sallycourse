// Queue + worker dédiés du filigrane paresseux (Prompt 206). Même patron que le
// scheduler blog (lib/blog.ts) / feedback (deploy/feedback-loop.ts) : une queue
// BullMQ dédiée HORS du registre typé du pipeline de génération (QUEUES), car le
// filigrane n'est pas une étape de génération mais une action à la DEMANDE,
// déclenchée par la 1re lecture d'un étudiant. La mise en file vit côté web
// (apps/web/src/lib/queues.ts::getWatermarkQueue) ; ce module ne fait que
// CONSOMMER les jobs et déléguer à renderWatermarkedLesson.
import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import { getRedisConnection } from '../queues/connection.js';
import { logger } from '../queues/index.js';
import { renderWatermarkedLesson } from './watermark.js';

/** Nom de la queue dédiée (miroir côté web). */
export const WATERMARK_QUEUE = 'watermark-render';
/** Nom du job de rendu filigrané d'une leçon pour un étudiant. */
export const WATERMARK_JOB = 'watermark-lesson';

export interface WatermarkJobData {
  courseId: string;
  lessonId: string;
  studentId: string;
  /** Email affiché en filigrane (identifie la source d'une fuite). */
  studentEmail: string;
}

/** jobId déterministe par (leçon × étudiant) : déduplique les rendus concurrents. */
export function watermarkJobId(lessonId: string, studentId: string): string {
  return `${WATERMARK_JOB}_${lessonId}_${studentId}`;
}

let watermarkWorker: Worker<WatermarkJobData> | null = null;

function bullConnection(): ConnectionOptions {
  return getRedisConnection() as unknown as ConnectionOptions;
}

/**
 * Démarre le worker de filigrane. Idempotent. Options ffmpeg-friendly (bail de
 * lock long : un re-encode 1080p peut affamer la boucle d'événements comme le
 * rendu vidéo — cf. queues/index.ts::registerWorker). Concurrency 1 par défaut
 * (CPU-bound), surchargeable par WORKER_WATERMARK_CONCURRENCY.
 */
export function startWatermarkWorker(): void {
  if (watermarkWorker) return;

  const raw = process.env.WORKER_WATERMARK_CONCURRENCY;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  const concurrency = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;

  watermarkWorker = new Worker<WatermarkJobData>(
    WATERMARK_QUEUE,
    async (job: Job<WatermarkJobData>) => {
      const { courseId, lessonId, studentId, studentEmail } = job.data;
      const result = await renderWatermarkedLesson({ courseId, lessonId, studentId, studentEmail });
      return result;
    },
    {
      connection: bullConnection(),
      concurrency,
      // Re-encode ffmpeg : mêmes garde-fous anti-« stalled » que le rendu vidéo.
      lockDuration: 10 * 60_000,
      stalledInterval: 60_000,
      maxStalledCount: 3,
    },
  );
  watermarkWorker.on('failed', (job, err) =>
    logger.error({ queue: WATERMARK_QUEUE, jobId: job?.id, err }, 'watermark : job en échec'),
  );
  watermarkWorker.on('error', (err) => logger.error({ queue: WATERMARK_QUEUE, err }, 'erreur worker watermark'));

  logger.info({ concurrency }, 'worker de filigrane (P206) démarré');
}

/** Arrête proprement le worker. */
export async function stopWatermarkWorker(): Promise<void> {
  await watermarkWorker?.close().catch(() => undefined);
  watermarkWorker = null;
}
