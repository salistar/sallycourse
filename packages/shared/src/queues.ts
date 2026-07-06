// File de jobs BullMQ — noms de queues, payloads typés, options par défaut,
// jobId déterministe et canal de progression Redis pub/sub.
// Ce module est volontairement sans dépendance runtime sur bullmq/ioredis :
// il n'expose que des types structurels compatibles (utilisables côté web et worker).
import { z } from 'zod';

// ── Noms de queues ──────────────────────────────────────────────
export const QUEUES = {
  outline: 'outline-generation',
  content: 'content-generation',
  tts: 'tts-generation',
  screenshot: 'screenshot-capture',
  videoRender: 'video-render',
  subtitle: 'subtitle-generation',
  packaging: 'packaging',
  deployment: 'deployment',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Liste ordonnée des noms de queues (ordre du pipeline de génération). */
export const QUEUE_NAMES = Object.values(QUEUES) as readonly QueueName[];

// ── Payloads de jobs par queue ──────────────────────────────────
export interface OutlineJobData {
  courseId: string;
  /** Instructions supplémentaires de l'utilisateur lors d'une régénération du plan. */
  extraInstructions?: string;
}

export interface ContentJobData {
  courseId: string;
  lessonId: string;
}

export interface TtsJobData {
  courseId: string;
  lessonId: string;
}

export interface ScreenshotJobData {
  courseId: string;
  lessonId: string;
}

export interface VideoRenderJobData {
  courseId: string;
  lessonId: string;
}

export interface SubtitleJobData {
  courseId: string;
  lessonId: string;
}

export interface PackagingJobData {
  courseId: string;
}

export interface DeploymentJobData {
  courseId: string;
  /** Plateforme cible (déploiement Udemy par défaut). */
  platform?: 'udemy' | 'youtube';
}

/** Map queue → type du payload de job. `keyof QueueJobData` couvre exactement QueueName. */
export type QueueJobData = {
  'outline-generation': OutlineJobData;
  'content-generation': ContentJobData;
  'tts-generation': TtsJobData;
  'screenshot-capture': ScreenshotJobData;
  'video-render': VideoRenderJobData;
  'subtitle-generation': SubtitleJobData;
  packaging: PackagingJobData;
  deployment: DeploymentJobData;
};

// ── Options de jobs partagées ───────────────────────────────────
/** Options BullMQ communes : 3 tentatives, backoff exponentiel 5 s, rétention bornée. */
export const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: 100,
  removeOnFail: 500,
} as const;

// ── jobId déterministe ──────────────────────────────────────────
/**
 * jobId déterministe `step:courseId[:extra…]` — permet la déduplication BullMQ
 * (re-poster le même step pour un cours ne crée pas de doublon).
 */
export function makeJobId(
  courseId: string,
  step: QueueName,
  ...extra: readonly (string | number)[]
): string {
  return [step, courseId, ...extra].join(':');
}

// ── Progression : canal Redis pub/sub typé ──────────────────────
/** Nom du canal pub/sub de progression pour un cours donné. */
export function PROGRESS_CHANNEL(courseId: string): string {
  return `sallycourse:progress:${courseId}`;
}

export const progressLevelSchema = z.enum(['info', 'warn', 'error']);
export type ProgressLevel = z.infer<typeof progressLevelSchema>;

export const progressEventSchema = z.object({
  courseId: z.string().min(1),
  step: z.enum(Object.values(QUEUES) as [QueueName, ...QueueName[]]),
  /** Progression 0–100 du step courant. */
  progress: z.number().min(0).max(100),
  message: z.string().optional(),
  level: progressLevelSchema.optional(),
  /** Timestamp epoch en millisecondes. */
  ts: z.number(),
});

export type ProgressEvent = z.infer<typeof progressEventSchema>;

// Interfaces structurelles minimales compatibles ioredis (pas d'import runtime ici).
export interface RedisPublisherLike {
  publish(channel: string, message: string): Promise<number>;
}

export interface RedisSubscriberLike {
  subscribe(...channels: string[]): Promise<unknown>;
  unsubscribe(...channels: string[]): Promise<unknown>;
  on(event: 'message', listener: (channel: string, message: string) => void): unknown;
  off?(event: 'message', listener: (channel: string, message: string) => void): unknown;
}

/** Publie un événement de progression sur le canal du cours. */
export async function publishProgress(
  redis: RedisPublisherLike,
  event: ProgressEvent,
): Promise<number> {
  return redis.publish(PROGRESS_CHANNEL(event.courseId), JSON.stringify(event));
}

/**
 * S'abonne à la progression d'un cours. Le client passé doit être dédié au
 * mode subscribe (ioredis : `redis.duplicate()`). Retourne une fonction de
 * désabonnement asynchrone.
 */
export async function subscribeProgress(
  redis: RedisSubscriberLike,
  courseId: string,
  cb: (event: ProgressEvent) => void,
): Promise<() => Promise<void>> {
  const channel = PROGRESS_CHANNEL(courseId);
  const onMessage = (chan: string, message: string): void => {
    if (chan !== channel) return;
    try {
      const parsed = progressEventSchema.safeParse(JSON.parse(message));
      if (parsed.success) cb(parsed.data);
    } catch {
      // Payload non-JSON : ignoré silencieusement (canal partagé tolérant).
    }
  };
  redis.on('message', onMessage);
  await redis.subscribe(channel);
  return async () => {
    await redis.unsubscribe(channel);
    redis.off?.('message', onMessage);
  };
}
