// Serveur de métriques minimal (P75 — monitoring production). Expose
// GET /metrics au format texte maison (pas de lib prometheus externe) :
// une ligne par mesure, format `nom{labels} valeur` (inspiré du format texte
// Prometheus pour rester grattable par un futur exporter, sans dépendance).
//
// Métriques exposées :
//   - sallycourse_jobs_completed_total{queue="..."}   compteur, depuis le démarrage
//   - sallycourse_jobs_failed_total{queue="..."}      compteur, depuis le démarrage
//   - sallycourse_job_duration_ms_avg{queue="..."}    moyenne glissante (dernières N durées)
//   - sallycourse_step_failure_rate{step="..."}       ratio [0,1] sur GenerationJob
//   - sallycourse_cost_usd_per_course_avg              coût moyen USD par cours (CostRecord)
//
// Le comptage jobs/heure est dérivé de sallycourse_jobs_completed_total par le
// scraper externe (delta / temps écoulé) — on expose aussi directement un taux
// jobs/heure calculé sur une fenêtre glissante pour lecture humaine immédiate.
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { cpus, loadavg, totalmem, freemem, uptime } from 'node:os';
import { statfs } from 'node:fs/promises';
import { logger } from '../queues/index.js';

/** Un échantillon de durée de job, horodaté (fenêtre glissante). */
interface DurationSample {
  ms: number;
  at: number;
}

/** Compteurs et échantillons par queue, tenus en mémoire process. */
interface QueueStats {
  completed: number;
  failed: number;
  durations: DurationSample[];
}

/** Fenêtre de conservation des échantillons de durée (1h) et taille max. */
const DURATION_WINDOW_MS = 60 * 60 * 1_000;
const MAX_SAMPLES_PER_QUEUE = 500;

const statsByQueue = new Map<string, QueueStats>();

function getOrCreateStats(queue: string): QueueStats {
  let stats = statsByQueue.get(queue);
  if (!stats) {
    stats = { completed: 0, failed: 0, durations: [] };
    statsByQueue.set(queue, stats);
  }
  return stats;
}

/** À appeler depuis worker.on('completed') : incrémente le compteur + durée. */
export function recordJobCompleted(queue: string, durationMs: number): void {
  const stats = getOrCreateStats(queue);
  stats.completed += 1;
  stats.durations.push({ ms: durationMs, at: Date.now() });
  if (stats.durations.length > MAX_SAMPLES_PER_QUEUE) stats.durations.shift();
}

/** À appeler depuis worker.on('failed') (échec définitif ou non). */
export function recordJobFailed(queue: string): void {
  getOrCreateStats(queue).failed += 1;
}

/** Purge les échantillons de durée hors fenêtre glissante (best-effort, appelé à la lecture). */
function pruneOldSamples(stats: QueueStats, now: number): void {
  while (stats.durations.length > 0 && now - stats.durations[0]!.at > DURATION_WINDOW_MS) {
    stats.durations.shift();
  }
}

/** Réinitialise tous les compteurs (tests uniquement). */
export function resetMetricsForTests(): void {
  statsByQueue.clear();
}

export interface QueueMetricsSnapshot {
  queue: string;
  completed: number;
  failed: number;
  avgDurationMs: number;
  jobsPerHour: number;
}

/** Calcule un instantané par queue à partir des compteurs en mémoire. */
export function snapshotQueueMetrics(now: number = Date.now()): QueueMetricsSnapshot[] {
  const out: QueueMetricsSnapshot[] = [];
  for (const [queue, stats] of statsByQueue.entries()) {
    pruneOldSamples(stats, now);
    const avgDurationMs =
      stats.durations.length > 0
        ? stats.durations.reduce((sum, s) => sum + s.ms, 0) / stats.durations.length
        : 0;
    // jobs/heure = complétions dans la fenêtre glissante, ramenées à 1h.
    const windowHours = DURATION_WINDOW_MS / (60 * 60 * 1_000);
    const jobsPerHour = stats.durations.length / windowHours;
    out.push({ queue, completed: stats.completed, failed: stats.failed, avgDurationMs, jobsPerHour });
  }
  return out.sort((a, b) => a.queue.localeCompare(b.queue));
}

export interface StepFailureRate {
  step: string;
  total: number;
  failed: number;
  rate: number;
}

export interface CostPerCourse {
  courseCount: number;
  totalUsd: number;
  avgUsd: number;
}

/**
 * Assemble le texte /metrics à partir de données déjà collectées (pur —
 * aucun accès réseau/DB ici, testable sans mock). Les collecteurs (Mongo,
 * BullMQ) vivent dans collectAndRenderMetrics ci-dessous.
 */
export function renderMetricsText(input: {
  queues: QueueMetricsSnapshot[];
  stepFailureRates: StepFailureRate[];
  costPerCourse: CostPerCourse;
  system?: SystemSnapshot;
  generatedAt?: Date | string;
}): string {
  const lines: string[] = [];
  const at = input.generatedAt ? new Date(input.generatedAt) : new Date();
  lines.push(`# SallyCourse worker metrics — format texte maison (pas de lib prometheus)`);
  lines.push(`# generated_at ${at.toISOString()}`);
  lines.push('');

  if (input.system) {
    const s = input.system;
    lines.push('# HELP sallycourse_disk_used_percent Pourcentage d\'espace disque utilisé (racine du conteneur, reflète l\'hôte).');
    lines.push('# TYPE sallycourse_disk_used_percent gauge');
    lines.push(`sallycourse_disk_used_percent ${s.diskUsedPercent.toFixed(2)}`);
    lines.push('# HELP sallycourse_mem_used_percent Pourcentage de RAM utilisée (reflète l\'hôte).');
    lines.push('# TYPE sallycourse_mem_used_percent gauge');
    lines.push(`sallycourse_mem_used_percent ${s.memUsedPercent.toFixed(2)}`);
    lines.push('# HELP sallycourse_load_avg_1m Charge CPU moyenne 1 minute (reflète l\'hôte).');
    lines.push('# TYPE sallycourse_load_avg_1m gauge');
    lines.push(`sallycourse_load_avg_1m ${s.loadAvg1.toFixed(2)}`);
    lines.push('');
  }

  lines.push('# HELP sallycourse_jobs_completed_total Nombre de jobs terminés avec succès depuis le démarrage.');
  lines.push('# TYPE sallycourse_jobs_completed_total counter');
  for (const q of input.queues) {
    lines.push(`sallycourse_jobs_completed_total{queue="${q.queue}"} ${q.completed}`);
  }

  lines.push('# HELP sallycourse_jobs_failed_total Nombre de jobs en échec (toutes tentatives confondues) depuis le démarrage.');
  lines.push('# TYPE sallycourse_jobs_failed_total counter');
  for (const q of input.queues) {
    lines.push(`sallycourse_jobs_failed_total{queue="${q.queue}"} ${q.failed}`);
  }

  lines.push('# HELP sallycourse_jobs_per_hour Débit de complétion sur la dernière heure glissante.');
  lines.push('# TYPE sallycourse_jobs_per_hour gauge');
  for (const q of input.queues) {
    lines.push(`sallycourse_jobs_per_hour{queue="${q.queue}"} ${q.jobsPerHour.toFixed(2)}`);
  }

  lines.push('# HELP sallycourse_job_duration_ms_avg Durée moyenne des jobs (fenêtre glissante 1h).');
  lines.push('# TYPE sallycourse_job_duration_ms_avg gauge');
  for (const q of input.queues) {
    lines.push(`sallycourse_job_duration_ms_avg{queue="${q.queue}"} ${q.avgDurationMs.toFixed(0)}`);
  }

  lines.push('# HELP sallycourse_step_failure_rate Taux d\'échec par étape du pipeline (GenerationJob), 0-1.');
  lines.push('# TYPE sallycourse_step_failure_rate gauge');
  for (const s of input.stepFailureRates) {
    lines.push(`sallycourse_step_failure_rate{step="${s.step}"} ${s.rate.toFixed(4)}`);
  }

  lines.push('# HELP sallycourse_cost_usd_per_course_avg Coût moyen estimé (USD) par cours généré.');
  lines.push('# TYPE sallycourse_cost_usd_per_course_avg gauge');
  lines.push(`sallycourse_cost_usd_per_course_avg ${input.costPerCourse.avgUsd.toFixed(4)}`);

  lines.push('# HELP sallycourse_cost_usd_total Coût total estimé (USD) tous cours confondus.');
  lines.push('# TYPE sallycourse_cost_usd_total gauge');
  lines.push(`sallycourse_cost_usd_total ${input.costPerCourse.totalUsd.toFixed(4)}`);

  return lines.join('\n') + '\n';
}

/** Calcule les taux d'échec par étape depuis les GenerationJob en base (best-effort). */
async function computeStepFailureRates(): Promise<StepFailureRate[]> {
  try {
    // Import paresseux : évite de tirer mongoose dans les tests purs de ce module.
    const { GenerationJob } = await import('../shared.js');
    const rows = await GenerationJob.aggregate<{ _id: string; total: number; failed: number }>([
      {
        $group: {
          _id: '$step',
          total: { $sum: 1 },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        },
      },
    ]);
    return rows
      .map((r) => ({ step: r._id, total: r.total, failed: r.failed, rate: r.total > 0 ? r.failed / r.total : 0 }))
      .sort((a, b) => a.step.localeCompare(b.step));
  } catch (err) {
    logger.warn({ err }, 'metrics: calcul du taux d\'échec par étape impossible');
    return [];
  }
}

/** Calcule le coût moyen/total par cours depuis CostRecord en base (best-effort). */
async function computeCostPerCourse(): Promise<CostPerCourse> {
  try {
    const { CostRecord } = await import('../shared.js');
    const rows = await CostRecord.aggregate<{ _id: null; totalUsd: number; courseIds: string[] }>([
      { $group: { _id: null, totalUsd: { $sum: '$estimatedUsd' }, courseIds: { $addToSet: '$courseId' } } },
    ]);
    const row = rows[0];
    if (!row) return { courseCount: 0, totalUsd: 0, avgUsd: 0 };
    const courseCount = row.courseIds.length;
    return {
      courseCount,
      totalUsd: row.totalUsd,
      avgUsd: courseCount > 0 ? row.totalUsd / courseCount : 0,
    };
  } catch (err) {
    logger.warn({ err }, 'metrics: calcul du coût par cours impossible');
    return { courseCount: 0, totalUsd: 0, avgUsd: 0 };
  }
}

/**
 * Instantané ressources SYSTÈME (dashboard super-admin /admin/ops,
 * 2026-07-29) — disque, RAM, charge CPU. `statfs('/')` et `os.totalmem()`
 * dans un conteneur Docker (sans limite cgroup explicite sur la RAM captée
 * par Node, et sans quota de taille sur l'overlay) reflètent le disque/la RAM
 * de l'HÔTE, pas une valeur isolée au conteneur — c'est la lecture voulue ici
 * (l'exploitant veut savoir si le SERVEUR sature, pas juste ce conteneur).
 * Best-effort : `statfs` peut échouer sur certains systèmes de fichiers
 * exotiques — plutôt que de planter /metrics, on renvoie des zéros et on log.
 */
export interface SystemSnapshot {
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

export async function collectSystemSnapshot(): Promise<SystemSnapshot> {
  let diskTotalBytes = 0;
  let diskFreeBytes = 0;
  try {
    const stat = await statfs('/');
    diskTotalBytes = stat.blocks * stat.bsize;
    diskFreeBytes = stat.bfree * stat.bsize;
  } catch (err) {
    logger.warn({ err }, 'metrics: sonde disque (statfs) impossible');
  }
  const memTotalBytes = totalmem();
  const memFreeBytes = freemem();
  const [loadAvg1, loadAvg5, loadAvg15] = loadavg() as [number, number, number];
  return {
    diskTotalBytes,
    diskFreeBytes,
    diskUsedPercent: diskTotalBytes > 0 ? ((diskTotalBytes - diskFreeBytes) / diskTotalBytes) * 100 : 0,
    memTotalBytes,
    memFreeBytes,
    memUsedPercent: memTotalBytes > 0 ? ((memTotalBytes - memFreeBytes) / memTotalBytes) * 100 : 0,
    loadAvg1,
    loadAvg5,
    loadAvg15,
    cpuCount: cpus().length,
    uptimeSec: uptime(),
  };
}

/** Snapshot structuré complet — base commune du texte Prometheus ET du JSON /metrics.json. */
export interface MetricsSnapshot {
  generatedAt: string;
  system: SystemSnapshot;
  queues: QueueMetricsSnapshot[];
  stepFailureRates: StepFailureRate[];
  costPerCourse: CostPerCourse;
}

/** Assemble l'instantané complet : compteurs mémoire + agrégats Mongo + ressources système. */
export async function collectMetricsSnapshot(): Promise<MetricsSnapshot> {
  const [stepFailureRates, costPerCourse, system] = await Promise.all([
    computeStepFailureRates(),
    computeCostPerCourse(),
    collectSystemSnapshot(),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    system,
    queues: snapshotQueueMetrics(),
    stepFailureRates,
    costPerCourse,
  };
}

/** Assemble le texte /metrics complet : compteurs mémoire + agrégats Mongo. */
export async function collectAndRenderMetrics(): Promise<string> {
  const snapshot = await collectMetricsSnapshot();
  return renderMetricsText(snapshot);
}

let server: Server | null = null;

/** Démarre le serveur HTTP interne exposant GET /metrics (texte brut). */
export function startMetricsServer(port = Number(process.env.METRICS_PORT ?? 9090)): Server {
  if (server) return server;

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    // /metrics.json (dashboard super-admin /admin/ops, 2026-07-29) : même
    // instantané que /metrics, en JSON structuré — consommé par le conteneur
    // web via le réseau interne (voir docker-compose.prod.yml, port 9090
    // restreint à 127.0.0.1 + réseau `internal`, jamais public).
    if (req.url === '/metrics.json') {
      collectMetricsSnapshot()
        .then((snapshot) => {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(snapshot));
        })
        .catch((err) => {
          logger.error({ err }, 'metrics.json: erreur de génération');
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'erreur interne' }));
        });
      return;
    }
    if (req.url !== '/metrics') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found\n');
      return;
    }
    collectAndRenderMetrics()
      .then((text) => {
        res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
        res.end(text);
      })
      .catch((err) => {
        logger.error({ err }, 'metrics: erreur de génération');
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('erreur interne\n');
      });
  };

  server = createServer(handler);
  server.on('error', (err) => logger.warn({ err, port }, 'metrics: serveur HTTP en erreur'));
  server.listen(port, () => logger.info({ port }, 'serveur de métriques démarré (GET /metrics)'));
  return server;
}

/** Arrête le serveur de métriques (arrêt propre du worker). */
export async function stopMetricsServer(): Promise<void> {
  if (!server) return;
  const s = server;
  server = null;
  await new Promise<void>((resolve) => s.close(() => resolve()));
}
