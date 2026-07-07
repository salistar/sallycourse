import { describe, it, expect } from 'vitest';
import { aggregateAnalytics } from './aggregate';
import type { PlatformRow } from './types';

function row(p: Partial<PlatformRow> & { platform: string }): PlatformRow {
  return {
    label: p.platform,
    enrollments: 0,
    rating: 0,
    revenue: 0,
    views: 0,
    fetchedAt: null,
    ...p,
  };
}

describe('aggregateAnalytics (web)', () => {
  it('agrège les totaux multi-plateformes', () => {
    const agg = aggregateAnalytics([
      row({ platform: 'udemy', enrollments: 200, rating: 4.6, revenue: 3000 }),
      row({ platform: 'youtube', rating: 4.2, revenue: 120, views: 55_000 }),
    ]);
    expect(agg.totalEnrollments).toBe(200);
    expect(agg.totalViews).toBe(55_000);
    expect(agg.totalRevenue).toBe(3120);
    expect(agg.platformCount).toBe(2);
  });

  it('pondère la note par les inscrits (poids plancher 1 sans inscrit)', () => {
    const agg = aggregateAnalytics([
      row({ platform: 'udemy', enrollments: 99, rating: 5 }),
      row({ platform: 'youtube', rating: 1, views: 100 }),
    ]);
    // (5*99 + 1*1) / 100 = 4.96
    expect(agg.averageRating).toBe(4.96);
  });

  it('ignore les plateformes non notées', () => {
    const agg = aggregateAnalytics([
      row({ platform: 'udemy', enrollments: 10, rating: 4 }),
      row({ platform: 'youtube', rating: 0, views: 5 }),
    ]);
    expect(agg.averageRating).toBe(4);
  });

  it('ensemble vide → tout à zéro', () => {
    expect(aggregateAnalytics([])).toEqual({
      totalEnrollments: 0,
      totalViews: 0,
      totalRevenue: 0,
      averageRating: 0,
      platformCount: 0,
    });
  });
});
