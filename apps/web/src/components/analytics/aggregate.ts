// Agrégation PURE multi-plateformes côté web (P61) — testable, sans I/O.
// Miroir de la logique worker (apps/worker/src/lib/analytics/aggregate.ts) :
// le web n'importe pas le worker (rootDir distinct), on garde une copie testée.

import type { PlatformRow } from './types';

export interface AggregatedAnalytics {
  totalEnrollments: number;
  totalViews: number;
  totalRevenue: number;
  /** Note moyenne pondérée par les inscrits (poids plancher 1 si notée). */
  averageRating: number;
  platformCount: number;
}

/** Arrondi à 2 décimales robuste aux erreurs flottantes. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Agrège les métriques de plusieurs plateformes. La note moyenne est pondérée
 * par les inscrits (poids plancher 1 pour une plateforme notée sans inscrit,
 * ex. YouTube) afin de rester représentative sans exclure les petites sources.
 */
export function aggregateAnalytics(rows: readonly PlatformRow[]): AggregatedAnalytics {
  let totalEnrollments = 0;
  let totalViews = 0;
  let totalRevenue = 0;
  let ratingWeightedSum = 0;
  let ratingWeight = 0;

  for (const r of rows) {
    totalEnrollments += r.enrollments;
    totalViews += r.views;
    totalRevenue += r.revenue;
    if (r.rating > 0) {
      const weight = r.enrollments > 0 ? r.enrollments : 1;
      ratingWeightedSum += r.rating * weight;
      ratingWeight += weight;
    }
  }

  return {
    totalEnrollments,
    totalViews,
    totalRevenue: round2(totalRevenue),
    averageRating: ratingWeight > 0 ? round2(ratingWeightedSum / ratingWeight) : 0,
    platformCount: rows.length,
  };
}
