import { describe, it, expect } from 'vitest';
import {
  aggregateAnalytics,
  mockMetrics,
  seedFromString,
} from './aggregate.js';
import type { PlatformMetrics } from './types.js';

describe('seedFromString', () => {
  it('est déterministe (mêmes entrées → même graine)', () => {
    expect(seedFromString('udemy:abc')).toBe(seedFromString('udemy:abc'));
  });

  it('distingue des entrées différentes', () => {
    expect(seedFromString('udemy:abc')).not.toBe(seedFromString('udemy:abd'));
  });

  it('renvoie un entier non signé 32 bits', () => {
    const s = seedFromString('x');
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('mockMetrics', () => {
  it('est déterministe par (platform, courseId)', () => {
    const a = mockMetrics('udemy', 'course-1');
    const b = mockMetrics('udemy', 'course-1');
    expect(a).toEqual(b);
  });

  it('profil Udemy : inscrits > 0, pas de vues, revenu cohérent', () => {
    const m = mockMetrics('udemy', 'course-1');
    expect(m.platform).toBe('udemy');
    expect(m.enrollments).toBeGreaterThan(0);
    expect(m.views).toBe(0);
    expect(m.rating).toBeGreaterThanOrEqual(3.8);
    expect(m.rating).toBeLessThanOrEqual(5);
    expect(m.revenue).toBeGreaterThan(0);
  });

  it('profil YouTube : vues > 0, pas d’inscrit', () => {
    const m = mockMetrics('youtube', 'course-1');
    expect(m.platform).toBe('youtube');
    expect(m.enrollments).toBe(0);
    expect(m.views).toBeGreaterThan(0);
    expect(m.rating).toBeGreaterThanOrEqual(3.5);
    expect(m.rating).toBeLessThanOrEqual(5);
  });

  it('bornes respectées sur un large échantillon', () => {
    for (let i = 0; i < 500; i++) {
      const u = mockMetrics('udemy', `c${i}`);
      expect(u.enrollments).toBeGreaterThanOrEqual(5);
      expect(u.enrollments).toBeLessThanOrEqual(3_000);
      const y = mockMetrics('youtube', `c${i}`);
      expect(y.views).toBeGreaterThanOrEqual(500);
      expect(y.views).toBeLessThanOrEqual(40_000);
    }
  });
});

describe('aggregateAnalytics', () => {
  it('agrège les totaux multi-plateformes', () => {
    const metrics: PlatformMetrics[] = [
      { platform: 'udemy', enrollments: 100, rating: 4.5, revenue: 1500, views: 0 },
      { platform: 'youtube', enrollments: 0, rating: 4.0, revenue: 50, views: 20_000 },
    ];
    const agg = aggregateAnalytics(metrics);
    expect(agg.totalEnrollments).toBe(100);
    expect(agg.totalViews).toBe(20_000);
    expect(agg.totalRevenue).toBe(1550);
    expect(agg.platformCount).toBe(2);
  });

  it('pondère la note par les inscrits (poids plancher 1 sans inscrit)', () => {
    const metrics: PlatformMetrics[] = [
      { platform: 'udemy', enrollments: 99, rating: 5, revenue: 0, views: 0 },
      { platform: 'youtube', enrollments: 0, rating: 1, revenue: 0, views: 100 },
    ];
    // (5*99 + 1*1) / (99 + 1) = 496/100 = 4.96
    expect(aggregateAnalytics(metrics).averageRating).toBe(4.96);
  });

  it('ignore les plateformes non notées (rating 0) dans la moyenne', () => {
    const metrics: PlatformMetrics[] = [
      { platform: 'udemy', enrollments: 10, rating: 4, revenue: 0, views: 0 },
      { platform: 'youtube', enrollments: 0, rating: 0, revenue: 0, views: 0 },
    ];
    expect(aggregateAnalytics(metrics).averageRating).toBe(4);
  });

  it('renvoie 0 partout pour un ensemble vide', () => {
    const agg = aggregateAnalytics([]);
    expect(agg).toEqual({
      totalEnrollments: 0,
      totalViews: 0,
      totalRevenue: 0,
      averageRating: 0,
      platformCount: 0,
    });
  });

  it('arrondit le revenu total à 2 décimales', () => {
    const metrics: PlatformMetrics[] = [
      { platform: 'udemy', enrollments: 1, rating: 4, revenue: 10.005, views: 0 },
      { platform: 'youtube', enrollments: 0, rating: 4, revenue: 0.004, views: 1 },
    ];
    expect(aggregateAnalytics(metrics).totalRevenue).toBe(10.01);
  });
});
