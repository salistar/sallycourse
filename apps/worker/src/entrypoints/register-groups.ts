// Groupes de queues par type de charge (P71 — scaling par entrypoint).
// Chaque registerXQueues() instancie les Queue BullMQ + Worker du groupe
// concerné et retourne la liste des noms enregistrés (pour les tests).
// Réutilisé par index.ts (tout-en-un, comportement historique inchangé)
// et par les entrypoints dédiés worker-cpu/worker-api/worker-browser.
import { QUEUES, type QueueName } from '../shared.js';
import { createQueue, registerWorker } from '../queues/index.js';
import { processOutlineGeneration } from '../processors/outline-generation.js';
import { processContentGeneration } from '../processors/content-generation.js';
import { processTtsGeneration } from '../processors/tts-generation.js';
import { processSubtitleGeneration } from '../processors/subtitle-generation.js';
import { processScreenshotCapture } from '../processors/screenshot-capture.js';
import { processVideoRender } from '../processors/video-render.js';
import { processPackaging } from '../processors/packaging.js';
import { processDeployment } from '../processors/deployment.js';

/** Lit une concurrence entière depuis l'env, avec valeur par défaut si absente/invalide. */
function envConcurrency(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// ── Groupe CPU : ffmpeg / rendu / archive (charge CPU-bound) ────
/** Concurrences par défaut du groupe CPU, surchargeables via WORKER_CPU_*. */
export const CPU_CONCURRENCY = {
  videoRender: envConcurrency('WORKER_CPU_VIDEORENDER_CONCURRENCY', 1),
  packaging: envConcurrency('WORKER_CPU_PACKAGING_CONCURRENCY', 1),
  screenshot: envConcurrency('WORKER_CPU_SCREENSHOT_CONCURRENCY', 1),
} as const;

/** Enregistre les queues du groupe CPU : videoRender + packaging + screenshot. */
export function registerCpuQueues(): readonly QueueName[] {
  const names: QueueName[] = [QUEUES.videoRender, QUEUES.packaging, QUEUES.screenshot];
  for (const name of names) createQueue(name);
  registerWorker(QUEUES.videoRender, processVideoRender, { concurrency: CPU_CONCURRENCY.videoRender });
  registerWorker(QUEUES.packaging, processPackaging, { concurrency: CPU_CONCURRENCY.packaging });
  registerWorker(QUEUES.screenshot, processScreenshotCapture, { concurrency: CPU_CONCURRENCY.screenshot });
  return names;
}

// ── Groupe API : appels Claude / TTS (charge réseau/API-bound) ──
/** Concurrences par défaut du groupe API, surchargeables via WORKER_API_*. */
export const API_CONCURRENCY = {
  outline: envConcurrency('WORKER_API_OUTLINE_CONCURRENCY', 2),
  content: envConcurrency('WORKER_API_CONTENT_CONCURRENCY', 3),
  tts: envConcurrency('WORKER_API_TTS_CONCURRENCY', 2),
  subtitle: envConcurrency('WORKER_API_SUBTITLE_CONCURRENCY', 1),
} as const;

/** Enregistre les queues du groupe API : outline + content + tts + subtitle. */
export function registerApiQueues(): readonly QueueName[] {
  const names: QueueName[] = [QUEUES.outline, QUEUES.content, QUEUES.tts, QUEUES.subtitle];
  for (const name of names) createQueue(name);
  registerWorker(QUEUES.outline, processOutlineGeneration, { concurrency: API_CONCURRENCY.outline });
  registerWorker(QUEUES.content, processContentGeneration, { concurrency: API_CONCURRENCY.content });
  registerWorker(QUEUES.tts, processTtsGeneration, { concurrency: API_CONCURRENCY.tts });
  registerWorker(QUEUES.subtitle, processSubtitleGeneration, { concurrency: API_CONCURRENCY.subtitle });
  return names;
}

// ── Groupe Browser : Playwright / déploiement (1 session par compte) ──
/** Concurrence par défaut du groupe Browser, surchargeable via WORKER_BROWSER_*. */
export const BROWSER_CONCURRENCY = {
  // Playwright pilote un navigateur par credential de plateforme : garder une
  // concurrency basse par défaut (1 session à la fois) pour éviter les
  // conflits de sessions/cookies sur un même compte.
  deployment: envConcurrency('WORKER_BROWSER_DEPLOYMENT_CONCURRENCY', 1),
} as const;

/** Enregistre les queues du groupe Browser : deployment (Playwright). */
export function registerBrowserQueues(): readonly QueueName[] {
  const names: QueueName[] = [QUEUES.deployment];
  for (const name of names) createQueue(name);
  registerWorker(QUEUES.deployment, processDeployment, { concurrency: BROWSER_CONCURRENCY.deployment });
  return names;
}
