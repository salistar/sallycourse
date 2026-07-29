import { QUEUES, type QueueName } from '@sallycourse/shared';

/**
 * Concurrence configurée de chaque queue worker — MIROIR en lecture seule de
 * apps/worker/src/entrypoints/register-groups.ts (mêmes noms de variable
 * d'env, mêmes défauts). Les deux fichiers lisent le même .env côté
 * déploiement ; ce mirroir existe parce qu'apps/web ne peut pas importer
 * apps/worker (frontières de package). Si register-groups.ts change un
 * défaut ou une variable d'env, reporter le changement ici.
 *
 * Sert à corriger les estimations de temps (queue-estimate.ts,
 * pipeline-estimate.ts) : une file avec concurrency=N traite N jobs à la
 * fois, donc le temps d'attente/traitement total est divisé par N — sans
 * cette correction, le devis de temps ignorait totalement la parallélisation
 * (P73/P134 supposaient concurrency=1) et est devenu de plus en plus faux à
 * mesure que la concurrence a été augmentée (audit qualité 2026-07-29).
 */
const CONCURRENCY_ENV: Partial<Record<QueueName, { envVar: string; fallback: number }>> = {
  [QUEUES.outline]: { envVar: 'WORKER_API_OUTLINE_CONCURRENCY', fallback: 2 },
  [QUEUES.content]: { envVar: 'WORKER_API_CONTENT_CONCURRENCY', fallback: 3 },
  [QUEUES.tts]: { envVar: 'WORKER_API_TTS_CONCURRENCY', fallback: 2 },
  [QUEUES.subtitle]: { envVar: 'WORKER_API_SUBTITLE_CONCURRENCY', fallback: 1 },
  [QUEUES.videoRender]: { envVar: 'WORKER_CPU_VIDEORENDER_CONCURRENCY', fallback: 1 },
  [QUEUES.packaging]: { envVar: 'WORKER_CPU_PACKAGING_CONCURRENCY', fallback: 1 },
  [QUEUES.screenshot]: { envVar: 'WORKER_CPU_SCREENSHOT_CONCURRENCY', fallback: 1 },
  [QUEUES.deployment]: { envVar: 'WORKER_BROWSER_DEPLOYMENT_CONCURRENCY', fallback: 1 },
};

/** Concurrence configurée d'une queue (≥ 1) — 1 si la queue n'a pas d'entrée (pas de parallélisme connu). */
export function queueConcurrency(queueName: QueueName): number {
  const entry = CONCURRENCY_ENV[queueName];
  if (!entry) return 1;
  const raw = process.env[entry.envVar];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : entry.fallback;
}
