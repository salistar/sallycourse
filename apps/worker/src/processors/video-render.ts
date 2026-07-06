// Processor BullMQ « video-render » (Prompt 24) : consomme { courseId, lessonId },
// assemble le MP4 de la leçon (media/video-render : slides PNG + audio mp3 →
// H.264/AAC 1920×1080 vérifié), persiste Lesson.assets.videoUrl + durationMin réel
// + status 'ready', puis enfile subtitle-generation. Quand TOUTES les leçons du
// cours sont 'ready', déclenche l'étape marketing/QA en réutilisant la bascule
// finalizeCourseIfComplete du dispatcher de contenu. Enregistré concurrency 1 (CPU).
import type { Job } from 'bullmq';
import {
  QUEUES,
  makeJobId,
  publishProgress,
  type VideoRenderJobData,
} from '../shared.js';
import { getRedisConnection } from '../queues/connection.js';
import { createQueue, logger } from '../queues/index.js';
import { renderLessonVideo } from '../media/video-render.js';
import { finalizeCourseIfComplete } from './content-generation.js';

export interface VideoRenderResult {
  courseId: string;
  lessonId: string;
  videoKey: string;
  durationSec: number;
  segments: number;
}

/** Publie la progression du step video-render (best-effort). */
async function report(
  courseId: string,
  progress: number,
  message: string,
  level: 'info' | 'warn' | 'error' = 'info',
): Promise<void> {
  try {
    await publishProgress(getRedisConnection(), {
      courseId,
      step: QUEUES.videoRender,
      progress,
      message,
      level,
      ts: Date.now(),
    });
  } catch (err) {
    logger.warn({ courseId, err }, 'publication de progression impossible');
  }
}

/** Processor de la queue video-render (un job = une leçon vidéo). */
export async function processVideoRender(job: Job<VideoRenderJobData>): Promise<VideoRenderResult> {
  const { courseId, lessonId } = job.data;

  try {
    await report(courseId, 10, 'Assemblage de la vidéo (slides + audio → MP4)');
    const rendered = await renderLessonVideo(courseId, lessonId);
    await report(
      courseId,
      80,
      `Vidéo assemblée : ${rendered.segments} segment(s), ${Math.round(rendered.durationSec)} s`,
    );

    // Sous-titres de la leçon (jobId déterministe = déduplication).
    await createQueue(QUEUES.subtitle).add(
      QUEUES.subtitle,
      { courseId, lessonId },
      { jobId: makeJobId(courseId, QUEUES.subtitle, lessonId) },
    );
    await report(courseId, 90, 'Sous-titrage enfilé');

    // Toutes les leçons prêtes → marketing/QA (bascule partagée, ne jette jamais).
    await finalizeCourseIfComplete(courseId);

    await report(courseId, 100, 'Rendu vidéo terminé');
    logger.info({ ...rendered }, 'video-render terminé, subtitle-generation enfilé');
    return rendered;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ courseId, lessonId, err }, 'échec du rendu vidéo');
    await report(courseId, 0, `Échec du rendu vidéo : ${message}`, 'error').catch(() => undefined);
    throw err;
  }
}
