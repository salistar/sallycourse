import { describe, expect, it } from 'vitest';
import type { QueueName } from '@sallycourse/shared';
import {
  computePipelineEstimate,
  computeReadyAt,
  formatReadyAtLabel,
} from './pipeline-estimate';

// Tests purs (P134) : aucun I/O Mongo/Redis — computePipelineEstimate,
// computeReadyAt et formatReadyAtLabel sont des fonctions de calcul isolées.

const ALL_ZERO: Record<QueueName, number> = {
  'outline-generation': 0,
  'content-generation': 0,
  'tts-generation': 0,
  'screenshot-capture': 0,
  'video-render': 0,
  'subtitle-generation': 0,
  packaging: 0,
  deployment: 0,
};

describe('computePipelineEstimate', () => {
  it('additionne outline + packaging (1x) et les steps par leçon (Nx)', () => {
    const durations: Record<QueueName, number> = {
      ...ALL_ZERO,
      'outline-generation': 60_000,
      'content-generation': 30_000,
      'tts-generation': 10_000,
      'screenshot-capture': 5_000,
      'video-render': 20_000,
      'subtitle-generation': 8_000,
      packaging: 15_000,
    };
    const estimate = computePipelineEstimate(10, durations);

    // 1 outline + 1 packaging + 10 × (content+tts+screenshot+video+subtitle)
    const expectedTotal =
      60_000 + 15_000 + 10 * (30_000 + 10_000 + 5_000 + 20_000 + 8_000);
    expect(estimate.totalMs).toBe(expectedTotal);
    expect(estimate.lessonCount).toBe(10);

    const outlineStep = estimate.steps.find((s) => s.queueName === 'outline-generation');
    expect(outlineStep?.occurrences).toBe(1);
    expect(outlineStep?.totalMs).toBe(60_000);

    const contentStep = estimate.steps.find((s) => s.queueName === 'content-generation');
    expect(contentStep?.occurrences).toBe(10);
    expect(contentStep?.totalMs).toBe(300_000);
  });

  it('retourne 0 sans aucun historique', () => {
    const estimate = computePipelineEstimate(24, ALL_ZERO);
    expect(estimate.totalMs).toBe(0);
    expect(estimate.steps.every((s) => s.totalMs === 0)).toBe(true);
  });

  it('clampe un nombre de leçons négatif à 0 occurrence', () => {
    const durations: Record<QueueName, number> = { ...ALL_ZERO, 'content-generation': 10_000 };
    const estimate = computePipelineEstimate(-5, durations);
    const contentStep = estimate.steps.find((s) => s.queueName === 'content-generation');
    expect(contentStep?.occurrences).toBe(0);
    expect(contentStep?.totalMs).toBe(0);
  });

  it('deployment n’est pas comptabilisé (déploiement hors pipeline de génération)', () => {
    const durations: Record<QueueName, number> = { ...ALL_ZERO, deployment: 999_999 };
    const estimate = computePipelineEstimate(5, durations);
    expect(estimate.steps.some((s) => s.queueName === 'deployment')).toBe(false);
    expect(estimate.totalMs).toBe(0);
  });
});

describe('computeReadyAt', () => {
  it('ajoute la durée totale estimée à l’instant courant', () => {
    const now = new Date(2026, 6, 12, 10, 0, 0);
    const ready = computeReadyAt(now, 90 * 60 * 1000); // +90 min
    expect(ready.getHours()).toBe(11);
    expect(ready.getMinutes()).toBe(30);
  });

  it('clampe une durée négative à 0 (pas de retour dans le passé)', () => {
    const now = new Date(2026, 6, 12, 10, 0, 0);
    const ready = computeReadyAt(now, -5000);
    expect(ready.getTime()).toBe(now.getTime());
  });
});

describe('formatReadyAtLabel', () => {
  it('formate en HH:mm avec zéro-padding', () => {
    expect(formatReadyAtLabel(new Date(2026, 6, 12, 9, 5, 0))).toBe('09:05');
    expect(formatReadyAtLabel(new Date(2026, 6, 12, 23, 45, 0))).toBe('23:45');
  });
});
