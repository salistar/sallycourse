// Processor BullMQ « video-render » (Prompt 24) : consomme { courseId, lessonId },
// assemble le MP4 de la leçon (media/video-render : slides PNG + audio mp3 →
// H.264/AAC 1920×1080 vérifié), persiste Lesson.assets.videoUrl + durationMin réel
// + status 'ready', puis enfile subtitle-generation. Quand TOUTES les leçons du
// cours sont 'ready', déclenche l'étape marketing/QA en réutilisant la bascule
// finalizeCourseIfComplete du dispatcher de contenu. Enregistré concurrency 1 (CPU).
import type { Job } from 'bullmq';
import {
  Lesson,
  QUEUES,
  makeJobId,
  nextVideoQualityStatus,
  presetForMode,
  publishProgress,
  type VideoRenderJobData,
} from '../shared.js';
import { getRedisConnection } from '../queues/connection.js';
import { createQueue, logger } from '../queues/index.js';
import { priorityForPlan } from '../queues/priority.js';
import { planForCourse } from '../queues/plan-lookup.js';
import { renderLessonVideo } from '../media/video-render.js';
import { renderLessonSlides } from '../media/slide-renderer.js';
import { CourseCancelledError } from '../lib/cancellation.js';
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
  const { courseId, lessonId, mode } = job.data;

  try {
    // Aperçu rapide (P133) : mode 'quick-preview' → preset ffmpeg 'draft'
    // (veryfast/CRF21, cf. PRESET_CONFIG) — 5x plus rapide, qualité brouillon.
    // Mode absent/'final' → comportement historique (DEFAULT_PRESET 'final').
    const preset = presetForMode(mode ?? 'final');

    // Slides PNG (P20) : rendues ICI, juste avant l'assemblage — le script de la
    // leçon est figé à ce stade (TTS déjà passé) et le rendu ffmpeg exige les
    // PNG dans le storage. Toujours re-rendues (idempotent, écrase les clés) :
    // un script édité entre deux rendus produit ainsi des slides à jour.
    await report(courseId, 5, 'Rendu des slides de la leçon (HTML → PNG 1920×1080)');
    await renderLessonSlides(courseId, lessonId);

    await report(
      courseId,
      10,
      preset === 'draft'
        ? 'Assemblage de l\'aperçu rapide (slides + audio → MP4 brouillon)'
        : 'Assemblage de la vidéo (slides + audio → MP4)',
    );
    const rendered = await renderLessonVideo(courseId, lessonId, { preset });
    await report(
      courseId,
      80,
      `Vidéo assemblée : ${rendered.segments} segment(s), ${Math.round(rendered.durationSec)} s`,
    );

    // Statut du cycle brouillon→final (P133) : posé UNIQUEMENT quand le job
    // précise un mode explicite — un rendu historique (mode absent, hors flow
    // aperçu) laisse videoQualityStatus inchangé ('none' par défaut). Calcul
    // PUR (nextVideoQualityStatus) puis lecture-écriture simple (pas de volume
    // suffisant pour justifier un pipeline d'agrégation atomique ici).
    if (mode) {
      const event = mode === 'quick-preview' ? 'draft-rendered' : 'final-rendered';
      const current = await Lesson.findById(lessonId).select('videoQualityStatus').lean();
      const next = nextVideoQualityStatus(current?.videoQualityStatus ?? 'none', event);
      await Lesson.updateOne({ _id: lessonId }, { $set: { videoQualityStatus: next } }).catch((err) =>
        logger.warn({ courseId, lessonId, err }, 'mise à jour videoQualityStatus échouée'),
      );
    }

    // Sous-titres de la leçon (jobId déterministe = déduplication).
    // Priorité (P73) selon le plan du propriétaire du cours.
    const subtitlePriority = priorityForPlan(await planForCourse(courseId));
    await createQueue(QUEUES.subtitle).add(
      QUEUES.subtitle,
      { courseId, lessonId },
      { jobId: makeJobId(courseId, QUEUES.subtitle, lessonId), priority: subtitlePriority },
    );
    await report(courseId, 90, 'Sous-titrage enfilé');

    // Toutes les leçons prêtes → marketing/QA (bascule partagée, ne jette jamais).
    await finalizeCourseIfComplete(courseId);

    await report(courseId, 100, 'Rendu vidéo terminé');
    logger.info({ ...rendered }, 'video-render terminé, subtitle-generation enfilé');
    return rendered;
  } catch (err) {
    // Annulation utilisateur (P73) : arrêt propre, PAS de retry BullMQ.
    if (err instanceof CourseCancelledError) {
      logger.info({ courseId, lessonId }, 'rendu vidéo interrompu (cours annulé)');
      await report(courseId, 0, 'Génération annulée par l\'utilisateur.', 'warn').catch(() => undefined);
      return { courseId, lessonId, videoKey: '', durationSec: 0, segments: 0 };
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ courseId, lessonId, err }, 'échec du rendu vidéo');
    await report(courseId, 0, `Échec du rendu vidéo : ${message}`, 'error').catch(() => undefined);
    throw err;
  }
}
