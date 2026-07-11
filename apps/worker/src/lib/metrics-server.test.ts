// Tests du format /metrics (texte maison, pur) — P75. Ne couvre pas les
// collecteurs Mongo (computeStepFailureRates/computeCostPerCourse) qui
// nécessitent une connexion réelle — seulement l'assemblage texte + les
// compteurs en mémoire (recordJobCompleted/recordJobFailed/snapshotQueueMetrics).
import { beforeEach, describe, expect, it } from 'vitest';
import {
  recordJobCompleted,
  recordJobFailed,
  resetMetricsForTests,
  snapshotQueueMetrics,
  renderMetricsText,
} from './metrics-server.js';

describe('snapshotQueueMetrics — compteurs en mémoire par queue', () => {
  beforeEach(() => {
    resetMetricsForTests();
  });

  it('retourne une liste vide sans activité enregistrée', () => {
    expect(snapshotQueueMetrics()).toEqual([]);
  });

  it('cumule les complétions et calcule la durée moyenne', () => {
    const now = Date.now();
    recordJobCompleted('outline-generation', 1_000);
    recordJobCompleted('outline-generation', 3_000);

    const snapshot = snapshotQueueMetrics(now);
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]!.queue).toBe('outline-generation');
    expect(snapshot[0]!.completed).toBe(2);
    expect(snapshot[0]!.avgDurationMs).toBe(2_000);
  });

  it('cumule les échecs séparément des complétions', () => {
    recordJobCompleted('tts-generation', 500);
    recordJobFailed('tts-generation');
    recordJobFailed('tts-generation');

    const [stats] = snapshotQueueMetrics();
    expect(stats!.completed).toBe(1);
    expect(stats!.failed).toBe(2);
  });

  it('trie les queues par ordre alphabétique', () => {
    recordJobCompleted('video-render', 100);
    recordJobCompleted('content-generation', 100);

    const snapshot = snapshotQueueMetrics();
    expect(snapshot.map((s) => s.queue)).toEqual(['content-generation', 'video-render']);
  });

  it('ignore les échantillons hors fenêtre glissante (1h) lors du calcul de la moyenne', () => {
    const now = Date.now();
    recordJobCompleted('packaging', 100); // horodaté "maintenant" en interne
    const snapshotNow = snapshotQueueMetrics(now);
    expect(snapshotNow[0]!.avgDurationMs).toBe(100);

    // 2h plus tard : l'échantillon doit être purgé (hors fenêtre 1h).
    const snapshotLater = snapshotQueueMetrics(now + 2 * 60 * 60 * 1_000);
    expect(snapshotLater[0]!.avgDurationMs).toBe(0);
    expect(snapshotLater[0]!.jobsPerHour).toBe(0);
  });
});

describe('renderMetricsText — format texte maison', () => {
  it('inclut une ligne par métrique/queue avec labels et valeurs', () => {
    const text = renderMetricsText({
      queues: [
        { queue: 'outline-generation', completed: 5, failed: 1, avgDurationMs: 1234, jobsPerHour: 2.5 },
      ],
      stepFailureRates: [{ step: 'tts-generation', total: 10, failed: 2, rate: 0.2 }],
      costPerCourse: { courseCount: 4, totalUsd: 8, avgUsd: 2 },
      generatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(text).toContain('sallycourse_jobs_completed_total{queue="outline-generation"} 5');
    expect(text).toContain('sallycourse_jobs_failed_total{queue="outline-generation"} 1');
    expect(text).toContain('sallycourse_jobs_per_hour{queue="outline-generation"} 2.50');
    expect(text).toContain('sallycourse_job_duration_ms_avg{queue="outline-generation"} 1234');
    expect(text).toContain('sallycourse_step_failure_rate{step="tts-generation"} 0.2000');
    expect(text).toContain('sallycourse_cost_usd_per_course_avg 2.0000');
    expect(text).toContain('sallycourse_cost_usd_total 8.0000');
    expect(text).toContain('generated_at 2026-01-01T00:00:00.000Z');
  });

  it('reste un texte valide (sans exception) quand toutes les listes sont vides', () => {
    const text = renderMetricsText({
      queues: [],
      stepFailureRates: [],
      costPerCourse: { courseCount: 0, totalUsd: 0, avgUsd: 0 },
    });
    expect(text).toContain('sallycourse_cost_usd_per_course_avg 0.0000');
    expect(text.endsWith('\n')).toBe(true);
  });
});
