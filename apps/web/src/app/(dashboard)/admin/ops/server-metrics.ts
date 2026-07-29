// Lecture des métriques serveur (dashboard super-admin /admin/ops, 2026-07-29)
// depuis le worker — GET http://worker:9090/metrics.json (réseau Docker
// interne, jamais exposé publiquement, voir docker-compose.prod.yml). Le
// worker mesure disque/RAM/CPU de l'HÔTE (statfs('/') + os.totalmem() dans un
// conteneur sans limite cgroup dédiée les reflètent), pas juste son propre
// conteneur — c'est la lecture voulue pour un dashboard d'exploitation.
//
// Best-effort strict : worker injoignable (redéploiement en cours, réseau
// coupé) → null, jamais une page en erreur 500.
import { getConfig } from '@sallycourse/shared';
import { logger } from '@/lib/logger';

export interface WorkerSystemSnapshot {
  diskTotalBytes: number;
  diskFreeBytes: number;
  diskUsedPercent: number;
  memTotalBytes: number;
  memFreeBytes: number;
  memUsedPercent: number;
  loadAvg1: number;
  loadAvg5: number;
  loadAvg15: number;
  cpuCount: number;
  uptimeSec: number;
}

export interface WorkerQueueMetric {
  queue: string;
  completed: number;
  failed: number;
  avgDurationMs: number;
  jobsPerHour: number;
}

export interface WorkerStepFailureRate {
  step: string;
  total: number;
  failed: number;
  rate: number;
}

export interface WorkerMetricsSnapshot {
  generatedAt: string;
  system: WorkerSystemSnapshot;
  queues: WorkerQueueMetric[];
  stepFailureRates: WorkerStepFailureRate[];
  costPerCourse: { courseCount: number; totalUsd: number; avgUsd: number };
}

const FETCH_TIMEOUT_MS = 4000;

/** Récupère l'instantané complet du worker (best-effort, null si injoignable). */
export async function fetchWorkerMetrics(): Promise<WorkerMetricsSnapshot | null> {
  const base = getConfig().WORKER_METRICS_URL;
  try {
    const res = await fetch(`${base}/metrics.json`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'ops admin : /metrics.json worker en erreur');
      return null;
    }
    return (await res.json()) as WorkerMetricsSnapshot;
  } catch (err) {
    logger.warn({ err }, 'ops admin : worker /metrics.json injoignable');
    return null;
  }
}

/** Seuils d'alerte (dashboard : badge rouge/orange). */
export const DISK_WARN_PERCENT = 70;
export const DISK_CRIT_PERCENT = 85;
export const MEM_WARN_PERCENT = 75;
export const MEM_CRIT_PERCENT = 90;

export type ResourceSeverity = 'ok' | 'warning' | 'critical';

/** Sévérité d'une mesure en pourcentage contre une paire de seuils (pure, testable). */
export function severityForPercent(value: number, warnAt: number, critAt: number): ResourceSeverity {
  if (value >= critAt) return 'critical';
  if (value >= warnAt) return 'warning';
  return 'ok';
}

/** Formate un nombre d'octets en unité lisible (Ko/Mo/Go/To). */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 o';
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  const exp = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exp;
  return `${exp === 0 ? value : value.toFixed(1)} ${units[exp]}`;
}
