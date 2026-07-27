// Queue + worker de la révision automatique de cours (2026-07-26) — même
// patron que slide-image-worker/audio-repair-worker : queue HORS registre
// typé (action à la demande sur un cours déjà généré), enfilée côté web,
// consommée ici. Concurrency 1 : une révision balaie tout un cours (HeadObject
// par slide) et enfile des réparations — inutile d'en paralléliser plusieurs.
import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import { getRedisConnection } from '../queues/connection.js';
import { logger } from '../queues/index.js';
import { COURSE_REVIEW_QUEUE, processCourseReview, type CourseReviewJobData } from '../processors/course-review.js';

let courseReviewWorker: Worker<CourseReviewJobData> | null = null;

function bullConnection(): ConnectionOptions {
  return getRedisConnection() as unknown as ConnectionOptions;
}

/** Démarre le worker de révision de cours. Idempotent. */
export function startCourseReviewWorker(): void {
  if (courseReviewWorker) return;

  courseReviewWorker = new Worker<CourseReviewJobData>(COURSE_REVIEW_QUEUE, processCourseReview, {
    connection: bullConnection(),
    concurrency: 1,
    lockDuration: 10 * 60_000,
    stalledInterval: 60_000,
    maxStalledCount: 3,
  });
  courseReviewWorker.on('failed', (job: Job<CourseReviewJobData> | undefined, err: Error) =>
    logger.error({ queue: COURSE_REVIEW_QUEUE, jobId: job?.id, err }, 'course-review : job en échec'),
  );
  courseReviewWorker.on('error', (err: Error) =>
    logger.error({ queue: COURSE_REVIEW_QUEUE, err }, 'erreur worker course-review'),
  );

  logger.info('worker de révision de cours démarré');
}

/** Arrête proprement le worker. */
export async function stopCourseReviewWorker(): Promise<void> {
  await courseReviewWorker?.close().catch(() => undefined);
  courseReviewWorker = null;
}
