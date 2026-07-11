// Alerting ops (P75 — monitoring production). Deux déclencheurs :
//   1. échec répété d'un job (>= tentatives max, voir worker.on('failed') dans
//      ../queues/index.ts) ;
//   2. queue bloquée (âge du job le plus ancien en attente > seuil).
// notifyOps() logue TOUJOURS (pino) puis, si OPS_WEBHOOK_URL est configuré,
// POST un message JSON simple (compatible Telegram bot API "sendMessage" via
// un relais, ou tout webhook générique {text}). Sans variable d'env : no-op
// silencieux (pas d'erreur, pas de bruit) — comportement volontaire pour ne
// pas bloquer le worker en dev/local sans webhook.
import { logger } from '../queues/index.js';

export type AlertSeverity = 'info' | 'warning' | 'critical';

/** Timeout de la requête webhook — jamais bloquant pour l'appelant. */
const WEBHOOK_TIMEOUT_MS = 5_000;

/**
 * Envoie une alerte ops : log structuré + webhook optionnel (OPS_WEBHOOK_URL).
 * Ne jette jamais — un échec d'alerte ne doit pas faire échouer le job appelant.
 */
export async function notifyOps(message: string, severity: AlertSeverity = 'warning'): Promise<void> {
  const logPayload = { severity, message };
  if (severity === 'critical') logger.error(logPayload, 'alerte ops');
  else if (severity === 'warning') logger.warn(logPayload, 'alerte ops');
  else logger.info(logPayload, 'alerte ops');

  const webhookUrl = process.env.OPS_WEBHOOK_URL;
  if (!webhookUrl) return; // pas de webhook configuré : no-op silencieux

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: `[SallyCourse:${severity}] ${message}`,
        severity,
        message,
        ts: new Date().toISOString(),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    logger.warn({ err, webhookUrl }, 'alerte ops : envoi webhook échoué (best-effort)');
  } finally {
    clearTimeout(timer);
  }
}

/** Un job en attente minimal, tel que retourné par Queue#getJobs BullMQ. */
export interface PendingJobInfo {
  id?: string;
  /** Timestamp epoch ms de création du job (Job.timestamp côté BullMQ). */
  timestamp: number;
}

export interface QueueBlockedCheck {
  blocked: boolean;
  /** Âge du job le plus ancien en ms (0 si aucun job en attente). */
  oldestAgeMs: number;
  oldestJobId?: string;
}

/**
 * Détection pure de blocage de queue : une queue est "bloquée" si son job en
 * attente le plus ancien dépasse `thresholdMs`. Ne dépend pas de BullMQ — les
 * jobs sont passés en paramètre (lus au préalable via Queue#getJobs(['waiting',
 * 'delayed'])) pour rester testable sans Redis.
 */
export function detectQueueBlocked(
  jobs: readonly PendingJobInfo[],
  thresholdMs: number,
  now: number = Date.now(),
): QueueBlockedCheck {
  if (jobs.length === 0) return { blocked: false, oldestAgeMs: 0 };

  let oldest = jobs[0]!;
  for (const job of jobs) {
    if (job.timestamp < oldest.timestamp) oldest = job;
  }

  const oldestAgeMs = Math.max(0, now - oldest.timestamp);
  return { blocked: oldestAgeMs > thresholdMs, oldestAgeMs, oldestJobId: oldest.id };
}

/** Seuil par défaut : 30 min sans traitement du job le plus ancien = alerte. */
export const DEFAULT_QUEUE_BLOCKED_THRESHOLD_MS = 30 * 60 * 1_000;

/**
 * Vérifie une queue BullMQ réelle et notifie ops si elle est bloquée. À
 * appeler périodiquement (ex. dans le heartbeat ou un scheduler dédié).
 */
export async function checkQueueBlockedAndAlert(
  queueName: string,
  getPendingJobs: () => Promise<PendingJobInfo[]>,
  thresholdMs: number = DEFAULT_QUEUE_BLOCKED_THRESHOLD_MS,
): Promise<QueueBlockedCheck> {
  const jobs = await getPendingJobs();
  const result = detectQueueBlocked(jobs, thresholdMs);
  if (result.blocked) {
    await notifyOps(
      `queue "${queueName}" bloquée : job le plus ancien en attente depuis ${Math.round(result.oldestAgeMs / 1000)}s (seuil ${Math.round(thresholdMs / 1000)}s)`,
      'critical',
    );
  }
  return result;
}

// ── Scheduler périodique (branché dans index.ts) ───────────────
let queueBlockedTimer: NodeJS.Timeout | null = null;
const QUEUE_BLOCKED_SCAN_INTERVAL_MS = 5 * 60 * 1_000;

/**
 * Scanne périodiquement toutes les queues enregistrées (BullMQ) à la
 * recherche d'un blocage (job en attente le plus ancien > seuil) et alerte
 * ops le cas échéant. `getQueues` est injecté pour ne pas coupler ce module
 * à ../queues/index.ts (import circulaire) — branché depuis src/index.ts.
 */
/** Sous-ensemble de l'API Queue BullMQ réellement utilisé ici (découplage de typage). */
export interface BlockableQueueLike {
  name: string;
  getJobs: (types: ('waiting' | 'delayed')[]) => Promise<PendingJobInfo[]>;
}

export function startQueueBlockedScheduler(
  getQueues: () => ReadonlyArray<BlockableQueueLike>,
  intervalMs: number = QUEUE_BLOCKED_SCAN_INTERVAL_MS,
): void {
  if (queueBlockedTimer) return;

  const scan = async (): Promise<void> => {
    for (const queue of getQueues()) {
      try {
        await checkQueueBlockedAndAlert(queue.name, () => queue.getJobs(['waiting', 'delayed']));
      } catch (err) {
        logger.warn({ queue: queue.name, err }, 'scan anti-blocage : lecture de la queue impossible');
      }
    }
  };

  queueBlockedTimer = setInterval(() => void scan(), intervalMs);
  queueBlockedTimer.unref();
  void scan();
  logger.info({ intervalMs }, 'scan anti-blocage des queues démarré');
}

export function stopQueueBlockedScheduler(): void {
  if (queueBlockedTimer) {
    clearInterval(queueBlockedTimer);
    queueBlockedTimer = null;
  }
}
