import { Queue, type ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';
import {
  QUEUES,
  getConfig,
  type ContentJobData,
  type DeploymentJobData,
  type OutlineJobData,
  type PackagingJobData,
  type ScreenshotJobData,
  type TtsJobData,
  type VideoRenderJobData,
} from '@sallycourse/shared';

/**
 * File BullMQ côté web — uniquement pour ENQUEUER (les workers consomment
 * ailleurs). Singletons stockés sur globalThis : le hot-reload Next ne doit
 * pas ouvrir une connexion Redis à chaque recompilation.
 */

interface QueueStore {
  redis?: Redis;
  outlineQueue?: Queue<OutlineJobData>;
  contentQueue?: Queue<ContentJobData>;
  packagingQueue?: Queue<PackagingJobData>;
  deploymentQueue?: Queue<DeploymentJobData>;
  feedbackQueue?: Queue<{ courseId: string }>;
  ttsQueue?: Queue<TtsJobData>;
  screenshotQueue?: Queue<ScreenshotJobData>;
  videoRenderQueue?: Queue<VideoRenderJobData>;
  blogQueue?: Queue<BlogJobData>;
  watermarkQueue?: Queue<WatermarkJobData>;
  voiceIntakeQueue?: Queue<VoiceIntakeJobData>;
  screencastRenderQueue?: Queue<ScreencastRenderJobData>;
  audioRepairQueue?: Queue<AudioRepairJobData>;
  slideImageQueue?: Queue<SlideImageJobData>;
  manualAudioIntakeQueue?: Queue<ManualAudioIntakeJobData>;
  courseReviewQueue?: Queue<CourseReviewJobData>;
}

/** Nom de la queue d'analyse de feedback (miroir du worker, hors registre typé). */
export const FEEDBACK_QUEUE = 'review-feedback';
/** Nom de job d'analyse d'un cours (P62). */
export const FEEDBACK_JOB = 'analyze-course-reviews';

/** Queue du blog SEO (P204) — miroir de worker/src/lib/blog.ts. */
export const BLOG_QUEUE = 'blog-seo';
/** Nom du job de (re)génération du blog d'un cours. */
export const BLOG_GENERATE_JOB = 'blog-generate-course';

/** Payload du job blog (miroir du worker : courseId → (re)génération). */
interface BlogJobData {
  courseId?: string;
  reason?: string;
}

/** Queue du filigrane paresseux (P206) — miroir de worker/src/media/watermark-worker.ts. */
export const WATERMARK_QUEUE = 'watermark-render';
/** Nom du job de rendu filigrané d'une leçon pour un étudiant. */
export const WATERMARK_JOB = 'watermark-lesson';

/** Payload du job de filigrane (miroir du worker). */
interface WatermarkJobData {
  courseId: string;
  lessonId: string;
  studentId: string;
  studentEmail: string;
}

/** Queue de dictée vocale (P210) — miroir de worker/src/voice/voice-intake-worker.ts. */
export const VOICE_INTAKE_QUEUE = 'voice-intake';
/** Nom du job d'interprétation d'une dictée. */
export const VOICE_INTAKE_JOB = 'voice-dictation';

/** Payload du job de dictée (miroir du worker : dictationId → transcription + brief). */
interface VoiceIntakeJobData {
  dictationId: string;
}

/** Queue de rendu de capture uploadée (Feature B) — miroir de worker/src/processors/screencast-render.ts. */
export const SCREENCAST_RENDER_QUEUE = 'screencast-render';
/** Nom du job de rendu d'une capture uploadée. */
export const SCREENCAST_RENDER_JOB = 'screencast-render-lesson';

/** Payload du job de rendu de capture (miroir du worker : narration TTS + légendes). */
interface ScreencastRenderJobData {
  courseId: string;
  lessonId: string;
}

/**
 * jobId déterministe par leçon : re-poster ne duplique pas le rendu.
 * Séparateur « _ » OBLIGATOIRE : bullmq ≥5.79 REJETTE les jobId personnalisés
 * contenant « : » (Error: Custom Id cannot contain :) — réservé aux jobs
 * répétables. Vaut pour TOUS les builders de jobId de ce fichier.
 */
export function screencastRenderJobId(lessonId: string): string {
  return `${SCREENCAST_RENDER_JOB}_${lessonId}`;
}

/** Queue de réparation audio (Lot 2, plan 2026-07-20) — miroir de worker/src/processors/audio-repair.ts. */
export const AUDIO_REPAIR_QUEUE = 'audio-repair';
/** Nom du job de réparation audio d'une leçon. */
export const AUDIO_REPAIR_JOB = 'audio-repair-lesson';

/** Payload du job de réparation audio (miroir du worker). */
interface AudioRepairJobData {
  courseId: string;
  lessonId: string;
  mode: 'resynth' | 'denoise' | 'switch-voice';
  /** Moteur cible (mode 'switch-voice' uniquement, audit qualité modèles 2026-07-22, additif). */
  targetEngine?: 'chatterbox' | 'qwen3';
}

/** jobId déterministe par leçon : re-poster ne duplique pas la réparation en cours. */
export function audioRepairJobId(lessonId: string): string {
  return `${AUDIO_REPAIR_JOB}_${lessonId}`;
}

/** Queue de régénération d'image de slide (Lot 3, plan 2026-07-20) — miroir de worker/src/processors/slide-image.ts. */
export const SLIDE_IMAGE_QUEUE = 'slide-image';
/** Nom du job de régénération d'image de slide. */
export const SLIDE_IMAGE_JOB = 'slide-image-regenerate';

/** Payload du job de régénération d'image de slide (miroir du worker). */
interface SlideImageJobData {
  courseId: string;
  lessonId: string;
  index: number;
  prompt?: string;
  /** Moteur cible (bouton « essayer l'autre moteur », audit qualité modèles 2026-07-22, additif). */
  targetEngine?: 'sdxl' | 'zimage';
}

/** jobId déterministe par (leçon × index) : deux slides régénèrent sans collision. */
export function slideImageJobId(lessonId: string, index: number): string {
  return `${SLIDE_IMAGE_JOB}_${lessonId}_${index}`;
}

/** Queue d'intégration audio manuelle (Lot 4, plan 2026-07-20) — miroir de worker/src/processors/manual-audio-intake.ts. */
export const MANUAL_AUDIO_INTAKE_QUEUE = 'manual-audio-intake';
/** Nom du job de normalisation d'un enregistrement manuel. */
export const MANUAL_AUDIO_INTAKE_JOB = 'manual-audio-intake-slide';

/** Payload du job d'intégration audio manuelle (miroir du worker). */
interface ManualAudioIntakeJobData {
  courseId: string;
  lessonId: string;
  index: number;
}

/** jobId déterministe par (leçon × index) : deux slides s'intègrent sans collision. */
export function manualAudioIntakeJobId(lessonId: string, index: number): string {
  return `${MANUAL_AUDIO_INTAKE_JOB}_${lessonId}_${index}`;
}

/** jobId déterministe par (leçon × étudiant) — déduplique les rendus concurrents. */
export function watermarkJobId(lessonId: string, studentId: string): string {
  return `${WATERMARK_JOB}_${lessonId}_${studentId}`;
}

/** Queue de révision automatique de cours (2026-07-26) — miroir de worker/src/processors/course-review.ts. */
export const COURSE_REVIEW_QUEUE = 'course-review';
/** Nom du job de révision d'un cours. */
export const COURSE_REVIEW_JOB = 'course-review-run';

/** Payload du job de révision (miroir du worker). */
interface CourseReviewJobData {
  courseId: string;
}

/** jobId déterministe par cours : re-cliquer ne duplique pas la révision en cours. */
export function courseReviewJobId(courseId: string): string {
  return `${COURSE_REVIEW_JOB}_${courseId}`;
}

const globalWithQueues = globalThis as typeof globalThis & {
  __sallycourseQueues?: QueueStore;
};

const store: QueueStore = (globalWithQueues.__sallycourseQueues ??= {});

/** Connexion Redis partagée (validée par getConfig). */
function getRedis(): Redis {
  if (!store.redis) {
    store.redis = new Redis(getConfig().REDIS_URL, {
      // Recommandé par BullMQ : pas de plafond de retries par commande.
      maxRetriesPerRequest: null,
    });
  }
  return store.redis;
}

/**
 * Connexion vue par BullMQ. pnpm duplique ioredis (5.10 côté bullmq, 5.11
 * côté app) : compatibles à l'exécution mais nominalement incompatibles pour
 * tsc, d'où le cast contrôlé.
 */
function getConnection(): ConnectionOptions {
  return getRedis() as unknown as ConnectionOptions;
}

/** Queue 'outline-generation' — point d'entrée du pipeline de génération. */
export function getOutlineQueue(): Queue<OutlineJobData> {
  if (!store.outlineQueue) {
    store.outlineQueue = new Queue<OutlineJobData>(QUEUES.outline, {
      connection: getConnection(),
    });
  }
  return store.outlineQueue;
}

/** Queue 'content-generation' — (re)génération du contenu d'une leçon. */
export function getContentQueue(): Queue<ContentJobData> {
  if (!store.contentQueue) {
    store.contentQueue = new Queue<ContentJobData>(QUEUES.content, {
      connection: getConnection(),
    });
  }
  return store.contentQueue;
}

/** Queue 'packaging' — construction du pack export ZIP téléchargeable. */
export function getPackagingQueue(): Queue<PackagingJobData> {
  if (!store.packagingQueue) {
    store.packagingQueue = new Queue<PackagingJobData>(QUEUES.packaging, {
      connection: getConnection(),
    });
  }
  return store.packagingQueue;
}

/**
 * Queue 'tts-generation' — (P79) point d'entrée de la réactivation d'un cours
 * archivé : réutilise Lesson.script déjà en base (aucun rappel LLM), reprend
 * directement la synthèse vocale + rendu vidéo + sous-titres.
 */
export function getTtsQueue(): Queue<TtsJobData> {
  if (!store.ttsQueue) {
    store.ttsQueue = new Queue<TtsJobData>(QUEUES.tts, { connection: getConnection() });
  }
  return store.ttsQueue;
}

/**
 * Queue 'video-render' — re-rendu direct des slides + vidéo d'une leçon SANS
 * repasser par le TTS (audio inchangé en storage). Utilisée par le changement
 * de THÈME visuel (catalogue 2026-07-26) : seules les images changent.
 */
export function getVideoRenderQueue(): Queue<VideoRenderJobData> {
  if (!store.videoRenderQueue) {
    store.videoRenderQueue = new Queue<VideoRenderJobData>(QUEUES.videoRender, {
      connection: getConnection(),
    });
  }
  return store.videoRenderQueue;
}

/**
 * Queue 'screenshot-capture' — (P170 afterDraft) reprise du média d'un TP dont
 * le brouillon a été relu (capture d'écran Playwright/Docker + placeholders).
 */
export function getScreenshotQueue(): Queue<ScreenshotJobData> {
  if (!store.screenshotQueue) {
    store.screenshotQueue = new Queue<ScreenshotJobData>(QUEUES.screenshot, { connection: getConnection() });
  }
  return store.screenshotQueue;
}

/** Queue 'deployment' — publication d'un cours sur une plateforme cible. */
export function getDeploymentQueue(): Queue<DeploymentJobData> {
  if (!store.deploymentQueue) {
    store.deploymentQueue = new Queue<DeploymentJobData>(QUEUES.deployment, {
      connection: getConnection(),
    });
  }
  return store.deploymentQueue;
}

/** Queue 'review-feedback' (P62) — analyse à la demande des avis d'un cours. */
export function getFeedbackQueue(): Queue<{ courseId: string }> {
  if (!store.feedbackQueue) {
    store.feedbackQueue = new Queue<{ courseId: string }>(FEEDBACK_QUEUE, {
      connection: getConnection(),
    });
  }
  return store.feedbackQueue;
}

/** Queue 'blog-seo' (P204) — (re)génération à la demande du blog d'un cours. */
export function getBlogQueue(): Queue<BlogJobData> {
  if (!store.blogQueue) {
    store.blogQueue = new Queue<BlogJobData>(BLOG_QUEUE, { connection: getConnection() });
  }
  return store.blogQueue;
}

/**
 * Queue 'watermark-render' (P206) — rendu paresseux de la copie filigranée
 * d'une leçon pour un étudiant, enfilé à la 1re lecture (route /watch).
 */
export function getWatermarkQueue(): Queue<WatermarkJobData> {
  if (!store.watermarkQueue) {
    store.watermarkQueue = new Queue<WatermarkJobData>(WATERMARK_QUEUE, { connection: getConnection() });
  }
  return store.watermarkQueue;
}

/**
 * Queue 'voice-intake' (P210) — transcription + interprétation asynchrone d'une
 * dictée vocale, enfilée par POST /api/voice/dictation (le client polle ensuite).
 */
export function getVoiceIntakeQueue(): Queue<VoiceIntakeJobData> {
  if (!store.voiceIntakeQueue) {
    store.voiceIntakeQueue = new Queue<VoiceIntakeJobData>(VOICE_INTAKE_QUEUE, { connection: getConnection() });
  }
  return store.voiceIntakeQueue;
}

/**
 * Queue 'screencast-render' (Feature B) — rendu asynchrone d'une capture d'écran
 * uploadée par l'auteur (narration TTS + légendes incrustées), enfilé par
 * POST /api/courses/[id]/lessons/[lessonId]/screencast (le client polle ensuite).
 */
export function getScreencastRenderQueue(): Queue<ScreencastRenderJobData> {
  if (!store.screencastRenderQueue) {
    store.screencastRenderQueue = new Queue<ScreencastRenderJobData>(SCREENCAST_RENDER_QUEUE, {
      connection: getConnection(),
    });
  }
  return store.screencastRenderQueue;
}

/**
 * Queue 'audio-repair' (Lot 2, plan 2026-07-20) — bouton « Réparer l'audio »
 * d'une leçon vidéo déjà générée (resynthèse ciblée des slides fautives ou
 * débruitage rapide), enfilé par POST /api/courses/[id]/lessons/[lessonId]/audio-repair
 * (le client polle ensuite).
 */
export function getAudioRepairQueue(): Queue<AudioRepairJobData> {
  if (!store.audioRepairQueue) {
    store.audioRepairQueue = new Queue<AudioRepairJobData>(AUDIO_REPAIR_QUEUE, {
      connection: getConnection(),
    });
  }
  return store.audioRepairQueue;
}

/**
 * Queue 'slide-image' (Lot 3, plan 2026-07-20) — régénération SDXL à la
 * demande de l'illustration d'UNE slide, enfilée par
 * POST /api/courses/[id]/lessons/[lessonId]/slides/[index]/image
 * (le client polle ensuite).
 */
export function getSlideImageQueue(): Queue<SlideImageJobData> {
  if (!store.slideImageQueue) {
    store.slideImageQueue = new Queue<SlideImageJobData>(SLIDE_IMAGE_QUEUE, {
      connection: getConnection(),
    });
  }
  return store.slideImageQueue;
}

/**
 * Queue 'manual-audio-intake' (Lot 4, plan 2026-07-20) — normalisation
 * (loudnorm + ffprobe) d'un enregistrement/upload manuel pour UNE slide,
 * enfilée par POST /api/courses/[id]/lessons/[lessonId]/slides/[index]/audio
 * (le client polle ensuite).
 */
/** Queue 'course-review' — révision automatique d'un cours (2026-07-26). */
export function getCourseReviewQueue(): Queue<CourseReviewJobData> {
  if (!store.courseReviewQueue) {
    store.courseReviewQueue = new Queue<CourseReviewJobData>(COURSE_REVIEW_QUEUE, {
      connection: getConnection(),
    });
  }
  return store.courseReviewQueue;
}

export function getManualAudioIntakeQueue(): Queue<ManualAudioIntakeJobData> {
  if (!store.manualAudioIntakeQueue) {
    store.manualAudioIntakeQueue = new Queue<ManualAudioIntakeJobData>(MANUAL_AUDIO_INTAKE_QUEUE, {
      connection: getConnection(),
    });
  }
  return store.manualAudioIntakeQueue;
}

/**
 * Déclenche MANUELLEMENT un cron worker depuis la console admin (P57).
 *
 * Ces queues (retention-archive, analytics-refresh, …) n'ont pas de getter
 * singleton dédié — elles sont pilotées par un scheduler worker et l'admin ne
 * les enfile qu'occasionnellement. On ouvre donc une `Queue` transitoire sur la
 * connexion Redis partagée, on enfile un job `${job}:manual` (les workers de ces
 * queues traitent tout job, exactement comme les `triggerXxxNow()` du worker),
 * puis on la referme (sans fermer la connexion partagée).
 */
export async function triggerAdminCron(queueName: string, jobName: string): Promise<void> {
  const queue = new Queue(queueName, { connection: getConnection() });
  try {
    await queue.add(
      `${jobName}:manual`,
      { reason: 'manual' },
      { removeOnComplete: true, removeOnFail: 100 },
    );
  } finally {
    // Ne ferme QUE la Queue (pas la connexion Redis partagée, réutilisée ailleurs).
    await queue.close();
  }
}
