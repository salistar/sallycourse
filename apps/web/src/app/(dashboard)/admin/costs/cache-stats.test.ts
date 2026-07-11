import { describe, expect, it } from 'vitest';
import { avgSavedUsd, deriveCacheStat, deriveCacheStats, overallHitRate, totalEstimatedSavingsUsd } from './cache-stats';

describe('deriveCacheStat', () => {
  it('calcule un taux de hit correct', () => {
    const stat = deriveCacheStat({ namespace: 'claude', hits: 3, misses: 1 });
    expect(stat.total).toBe(4);
    expect(stat.hitRate).toBeCloseTo(0.75, 5);
  });

  it('taux de hit à 0 quand il n’y a aucun accès', () => {
    const stat = deriveCacheStat({ namespace: 'tts', hits: 0, misses: 0 });
    expect(stat.hitRate).toBe(0);
    expect(stat.estimatedSavingsUsd).toBe(0);
  });

  it('économie estimée = hits × coût moyen évité', () => {
    const stat = deriveCacheStat({ namespace: 'claude', hits: 10, misses: 0 });
    expect(stat.estimatedSavingsUsd).toBeCloseTo(10 * avgSavedUsd('claude'), 6);
  });

  it('couvre les trois namespaces sans jeter', () => {
    for (const namespace of ['claude', 'tts', 'screenshot'] as const) {
      expect(() => avgSavedUsd(namespace)).not.toThrow();
      expect(avgSavedUsd(namespace)).toBeGreaterThan(0);
    }
  });
});

describe('deriveCacheStats / overallHitRate / totalEstimatedSavingsUsd', () => {
  const counts = [
    { namespace: 'claude' as const, hits: 8, misses: 2 },
    { namespace: 'tts' as const, hits: 5, misses: 5 },
    { namespace: 'screenshot' as const, hits: 0, misses: 0 },
  ];

  it('agrège le taux de hit global (hits totaux / accès totaux)', () => {
    const stats = deriveCacheStats(counts);
    expect(overallHitRate(stats)).toBeCloseTo(13 / 20, 5);
  });

  it('agrège l’économie totale estimée', () => {
    const stats = deriveCacheStats(counts);
    const expected = 8 * avgSavedUsd('claude') + 5 * avgSavedUsd('tts');
    expect(totalEstimatedSavingsUsd(stats)).toBeCloseTo(expected, 4);
  });

  it('taux de hit global à 0 sans aucun accès', () => {
    expect(overallHitRate(deriveCacheStats([{ namespace: 'claude', hits: 0, misses: 0 }]))).toBe(0);
  });
});
