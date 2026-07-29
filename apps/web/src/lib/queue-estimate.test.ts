import { describe, expect, it } from 'vitest';
import { computeAverageDurationMs, computeEstimatedWaitMs } from './queue-estimate';

// Tests purs (P73) : aucun I/O Mongo/Redis — computeAverageDurationMs et
// computeEstimatedWaitMs sont des fonctions de calcul isolées de la couche réseau.

describe('computeAverageDurationMs', () => {
  it('calcule la moyenne des durées valides (updatedAt > createdAt)', () => {
    const ms = computeAverageDurationMs([
      { createdAt: 0, updatedAt: 10_000 },
      { createdAt: 0, updatedAt: 20_000 },
      { createdAt: 0, updatedAt: 30_000 },
    ]);
    expect(ms).toBe(20_000);
  });

  it('retourne 0 sans historique', () => {
    expect(computeAverageDurationMs([])).toBe(0);
  });

  it('ignore les entrées incohérentes (updatedAt <= createdAt)', () => {
    const ms = computeAverageDurationMs([
      { createdAt: 1_000, updatedAt: 1_000 }, // égal → ignoré
      { createdAt: 5_000, updatedAt: 1_000 }, // négatif → ignoré
      { createdAt: 0, updatedAt: 8_000 }, // valide
    ]);
    expect(ms).toBe(8_000);
  });

  it('retourne 0 si toutes les entrées sont incohérentes', () => {
    expect(computeAverageDurationMs([{ createdAt: 100, updatedAt: 100 }])).toBe(0);
  });
});

describe('computeEstimatedWaitMs', () => {
  it('multiplie le nombre de jobs en attente par la durée moyenne', () => {
    expect(computeEstimatedWaitMs(3, 10_000)).toBe(30_000);
  });

  it('retourne 0 si aucun job en attente', () => {
    expect(computeEstimatedWaitMs(0, 10_000)).toBe(0);
  });

  it('retourne 0 sans historique de durée', () => {
    expect(computeEstimatedWaitMs(5, 0)).toBe(0);
  });

  it('retourne 0 pour des entrées négatives (défensif)', () => {
    expect(computeEstimatedWaitMs(-1, 10_000)).toBe(0);
  });

  // Régression (audit qualité 2026-07-29) : la concurrence d'une file divise
  // le temps d'attente — sans ça, bumper la concurrency (Phase D) rendrait
  // l'estimation de plus en plus fausse (toujours "concurrency=1").
  it('divise par la concurrency quand fournie', () => {
    expect(computeEstimatedWaitMs(8, 10_000, 4)).toBe(20_000);
  });

  it('arrondit au plafond (mieux vaut surestimer que sous-estimer)', () => {
    expect(computeEstimatedWaitMs(5, 10_000, 3)).toBe(16_667);
  });

  it('concurrency <= 0 traitée comme 1 (défensif)', () => {
    expect(computeEstimatedWaitMs(3, 10_000, 0)).toBe(30_000);
  });
});
